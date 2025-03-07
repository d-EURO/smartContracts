// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {Position} from "../../contracts/MintingHubV2/Position.sol";
import {DecentralizedEURO} from "../../contracts/DecentralizedEURO.sol";
import {TestToken} from "../../contracts/test/TestToken.sol";
import {PositionFactory} from "../../contracts/MintingHubV2/PositionFactory.sol";
import {SavingsGateway} from "../../contracts/gateway/SavingsGateway.sol";
import {DEPSWrapper} from "../../contracts/utils/DEPSWrapper.sol";
import {FrontendGateway} from "../../contracts/gateway/FrontendGateway.sol";
import {MintingHubGateway} from "../../contracts/gateway/MintingHubGateway.sol";
import {PositionRoller} from "../../contracts/MintingHubV2/PositionRoller.sol";
import {Equity} from "../../contracts/Equity.sol";
import {TestHelper} from "../TestHelper.sol";
import {Handler} from "./Handler.t.sol";
import {console} from "forge-std/Test.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract Invariants is TestHelper {
    Handler internal s_handler;

    /// @dev DecentralizedEURO
    DecentralizedEURO internal s_deuro;

    /// @dev TestToken
    TestToken internal s_collateralToken;

    /// @dev MintingHubGateway
    MintingHubGateway internal s_mintingHubGateway;

    /// @dev EOAs / users
    address internal s_alice;

    /// @dev Positions
    Position[] internal s_positions;

    /// @notice Set up dEURO environment
    function setUp() public {
        // deploy contracts
        s_deuro = new DecentralizedEURO(3 * 84600); // 3 days
        s_collateralToken = new TestToken("Collateral", "COL", 18); // 18 decimals
        PositionRoller positionRoller = new PositionRoller(address(s_deuro));
        PositionFactory positionFactory = new PositionFactory();
        DEPSWrapper depsWrapper = new DEPSWrapper(Equity(address(s_deuro.reserve())));
        FrontendGateway frontendGateway = new FrontendGateway(address(s_deuro), address(depsWrapper));
        SavingsGateway savingsGateway = new SavingsGateway(s_deuro, 5, address(frontendGateway)); // 5% intial interest rate
        s_mintingHubGateway = new MintingHubGateway(
            address(s_deuro),
            address(savingsGateway),
            address(positionRoller),
            address(positionFactory),
            address(frontendGateway)
        );

        // initilize FrontendGateway
        frontendGateway.init(address(savingsGateway), address(s_mintingHubGateway));

        // initialize minters and wait 1 block
        s_deuro.initialize(address(s_mintingHubGateway), "Minting Hub");
        s_deuro.initialize(address(this), "Fuzzing Test Contract");
        increaseBlock(1);

        // Create Alice
        s_alice = vm.addr(1);
        vm.label(s_alice, "Alice");
        s_deuro.mint(s_alice, 1_000_000e18);
        s_collateralToken.transfer(s_alice, 10_000_000e18);

        // Create positions
        address position1 = createPosition(s_alice);
        s_positions.push(Position(position1));

        increaseTime(5 days); // ≥ initPeriod

        // create the handler
        s_handler = new Handler(s_deuro, s_collateralToken, s_mintingHubGateway, s_positions, address(this));

        // Record initial position state
        s_handler.recordPositionState(Position(position1));

        // create the handler selectors to the fuzzings targets
        bytes4[] memory selectors = new bytes4[](11);
        /// IPosition
        selectors[0] = Handler.mintTo.selector;
        selectors[1] = Handler.repay.selector;
        selectors[2] = Handler.addCollateral.selector;
        selectors[3] = Handler.withdrawCollateral.selector;
        selectors[4] = Handler.adjustPrice.selector;
        /// MintingHub
        selectors[5] = Handler.challengePosition.selector;
        selectors[6] = Handler.bidChallenge.selector;
        selectors[7] = Handler.buyExpiredCollateral.selector;
        /// Network specific
        selectors[8] = Handler.passCooldown.selector;
        selectors[9] = Handler.expirePosition.selector;
        selectors[10] = Handler.warpTime.selector;

        targetSelector(FuzzSelector({addr: address(s_handler), selectors: selectors}));
        targetContract(address(s_handler));
    }

    /// @dev check that positions has no trapped dEURO
    function invariant_positionHasNoTrappeddEURO() public view {
        Position[] memory positions = s_handler.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            uint256 trapped = s_deuro.balanceOf(address(positions[i]));
            assertEq(trapped, 0, "Position has trapped dEURO");
        }
    }

    /// @dev check that position is sufficiently collateralized
    function invariant_positionIsSufficientlyCollateralized() public view {
        Position[] memory positions = s_handler.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            uint256 collateral = s_collateralToken.balanceOf(address(positions[i]));
            uint256 principal = positions[i].principal(); // REVIEW: Make this debt?
            uint256 collateralValue = collateral * positions[i].price();
            assertGe(collateralValue, principal * 1e18, "Position is undercollateralized");
        }
    }

    /// @dev check that interest is non-zero implies principal is non-zero
    function invariant_nonZeroInterestImpliesNonZeroPrincipal() public view {
        Position[] memory positions = s_handler.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            uint256 interest = positions[i].getInterest();
            if (interest > 0) {
                assertGt(positions[i].principal(), 0, "Interest is non-zero but principal is zero");
            }
        }
    }

    /// @dev check that zero principal implies zero interest
    function invariant_zeroPrincipalImpliesZeroInterest() public view {
        Position[] memory positions = s_handler.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].principal() == 0) {
                assertEq(positions[i].getInterest(), 0, "Nonzero interest with zero principal");
            }
        }
    }

    /// @dev check that active positions have minimum collateral
    function invariant_activePositionHasMinimumCollateral() public view {
        Position[] memory positions = s_handler.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            if (!positions[i].isClosed() && block.timestamp < positions[i].expiration()) {
                uint256 collateral = s_collateralToken.balanceOf(address(positions[i]));
                uint256 minCollateral = positions[i].minimumCollateral();
                assertGe(collateral, minCollateral, "Active position below minimum collateral");
            }
        }
    }

    /// @dev verify debt equals principal plus interest
    function invariant_debtEqualsPrincipalPlusInterest() public view {
        Position[] memory positions = s_handler.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            uint256 debt = positions[i].getDebt();
            uint256 principal = positions[i].principal();
            uint256 interest = positions[i].getInterest();
            assertEq(debt, principal + interest, "Debt does not equal principal plus interest");
        }
    }

    /// @dev check that minting limit is not exceeded
    function invariant_mintingLimitNotExceeded() public view {
        Position[] memory positions = s_handler.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            uint256 principal = positions[i].principal();
            uint256 available = positions[i].availableForMinting();
            uint256 limit = positions[i].limit();
            assertLe(principal + available, limit, "Minted principal plus available mint exceeds limit");
        }
    }

    function invariant_summary() public view {
        // Print user summary
        try this.userSummary(s_alice) {} catch {
            console.log("Error printing user summary");
        }

        console.log("");

        // Print statistics
        try s_handler.printStatistics() {} catch {
            console.log("Error printing variable distributions");
        }
    }

    /// Helper functions

    function createPosition(address owner) internal prank(owner) returns (address position) {
        // approve the minting hub to spend max collateral
        s_collateralToken.approve(address(s_mintingHubGateway), 2**256 - 1);
        s_deuro.approve(address(s_mintingHubGateway), s_mintingHubGateway.OPENING_FEE());

        // create new position
        position = s_mintingHubGateway.openPosition(
            address(s_collateralToken),
            1e18, // minCollateral
            110e18, // initialCollateral
            550_000e18, // initialLimit
            3 days, // initPeriod
            365 days, // duration
            3 days, // challengePeriod
            10000, // riskPremiumPPM
            5000 * 10 ** s_collateralToken.decimals(), // liqPrice
            100000, // reservePPM
            bytes32(keccak256(abi.encodePacked(owner))) // frontendCode
        );

        // approve the position to spend max dEURO
        s_deuro.approve(position, 2 ** 256 - 1);

        // approve the position to spend max collateral
        s_collateralToken.approve(position, 2 ** 256 - 1);
    }

    // Make external to use try/catch
    function userSummary(address user) external view {
        uint256 numPositions = 0;
        for (uint256 i = 0; i < s_positions.length; i++) {
            if (s_positions[i].owner() == user) {
                numPositions++;
            }
        }

        console.log("> USERS");
        logHorizontalDivider();
        logRow3("User", ["# Positions", "COL balance", "dEURO balance"]);
        logHorizontalDivider();
        logRow3(
            vm.getLabel(user),
            [
                Strings.toString(numPositions),
                formatUint256(s_collateralToken.balanceOf(user), 18),
                formatUint256(s_deuro.balanceOf(user), 18)
            ]
        );
    }
}
