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


contract Invariants is TestHelper {
    Handler internal s_handler;

    /// @dev DecentralizedEURO
    DecentralizedEURO internal s_deuro;

    /// @dev TestToken
    TestToken internal s_collateralToken;

    /// @dev MintingHubGateway
    MintingHubGateway internal s_mintingHubGateway;

    /// @dev Alice address
    address internal s_alice;

    /// @dev Alice's positions
    Position[] internal s_positionsAlice;
        
    /// @notice deploy the contracts required for testing
    function setUp() public {
        uint8 collateralDecimals = 18;
        s_deuro = new DecentralizedEURO(3 * 84600); // 3 days
        s_collateralToken = new TestToken("Collateral", "COL", collateralDecimals); // 18 decimals
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
        s_collateralToken.transfer(s_alice, 1_000_000e18);

        // Create positions for Alice
        createPosition(
            s_alice, // owner
            1e18, // minCollateral
            110e18, // initialCollateral
            550_000e18, // initialLimit
            3 days, // initPeriod
            60 days, // duration
            3 days, // challengePeriod
            5000 * 10**collateralDecimals, // liqPrice
            100000, // reservePPM
            bytes32("0x"), // frontendCode
            10000 // riskPremiumPPM
        );

        increaseTime(5 days);

        // create the handler
        s_handler = new Handler(s_deuro, s_collateralToken, s_mintingHubGateway, s_alice, s_positionsAlice, address(this));

        // create the handler selectors to the fuzzings targets
        bytes4[] memory selectors = new bytes4[](1);
        /// IPosition
        selectors[0] = Handler.adjustMint.selector;
        /// IMintingHubGateway
        // selectors[1] = Handler.createPosition.selector;
        /// Network specific
        // selectors[2] = Handler.warpTime.selector;

        targetSelector(FuzzSelector({addr: address(s_handler), selectors: selectors}));
        targetContract(address(s_handler));
    }

    /// @dev check that positions has no trapped dEURO
    function invariant_positionHasNoTrappeddEURO() public view {
        Position[] memory positions = s_handler.getPositionsAlice();
        for (uint256 i = 0; i < positions.length; i++) {
            uint256 trapped = s_deuro.balanceOf(address(positions[i]));
            assertEq(trapped, 0, "Position has trapped dEURO");
        }
    }
    
    /// @dev check that position is sufficiently collateralized
    function invariant_positionIsSufficientlyCollateralized() public view {
        Position[] memory positions = s_handler.getPositionsAlice();
        for (uint256 i = 0; i < positions.length; i++) {
            uint256 collateral = s_collateralToken.balanceOf(address(positions[i]));
            uint256 debt = positions[i].principal(); // + positions[i].interest(); // REVIEW
            uint256 collateralValue = collateral * positions[i].price() / 1e18;
            assertGe(collateralValue, debt, "Position is undercollateralized");
        }
    }

    /// @dev helper function to return detailed information about the invariant runs
    function invariant_summary() public view {
        s_handler.callSummary();
        positionSummary();
    }

    /// Helper functions
    function createPosition(
        address owner,
        uint256 minCollateral,
        uint256 initialCollateral,
        uint256 initialLimit,
        uint40 initPeriod,
        uint40 duration,
        uint40 challengePeriod,
        uint256 liqPrice,
        uint24 reservePPM,
        bytes32 frontendCode,
        uint24 riskPremiumPPM
    ) public {
        // Alice creates a new position
        vm.prank(owner);
        s_collateralToken.approve(address(s_mintingHubGateway), 2**256 - 1);

        vm.prank(owner);
        address position = s_mintingHubGateway.openPosition(
            address(s_collateralToken),            
            minCollateral,  
            initialCollateral,
            initialLimit,
            initPeriod,    
            duration,      
            challengePeriod,
            riskPremiumPPM,
            liqPrice,  
            reservePPM,
            frontendCode
        );

        // Approve the position to spend max dEURO
        vm.prank(owner);
        s_deuro.approve(position, 2**256 - 1);
        
        s_positionsAlice.push(Position(position));
        // increaseTime(initPeriod); 
    }

    /// @dev adjustMint
    function positionSummary() public view {
        console.log("Number of Alice's positions: %s", s_positionsAlice.length);
        console.log("Alice collateral balance: %s", s_collateralToken.balanceOf(s_alice));
        console.log("Alice dEURO balance: %s", s_deuro.balanceOf(s_alice));
        for (uint256 i = 0; i < s_positionsAlice.length; i++) {
            console.log("------------------------------------");
            console.log("Position %s", i);
            console.log("Principal: %s", s_positionsAlice[i].principal());
            console.log("Collateral: %s", s_collateralToken.balanceOf(address(s_positionsAlice[i])));
            console.log("Price: %s", s_positionsAlice[i].price());
        }
    }
}

// bound inputs of createPosition
// minCollateral = bound(minCollateral, 1e18, 1e20);
// initialCollateral = bound(initialCollateral, minCollateral, 1e22);
// liqPrice = bound(liqPrice, 5000e36 / minCollateral, 1e24); // minCollateral * liqPrice >= 5000 dEURO
// initialLimit = bound(initialLimit, 1e27, 1e30);
// initPeriod = uint40(bound(initPeriod, 3 days, 10 days)); // min 3 days
// duration = uint40(bound(duration, 1 days, 30 days));
// challengePeriod = uint40(bound(challengePeriod, 1 days, 3 days));
// reservePPM = uint24(bound(reservePPM, 0, 500_000));
// riskPremiumPPM = uint24(bound(riskPremiumPPM, 0, 500_000));