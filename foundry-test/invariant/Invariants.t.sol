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

contract Invariants is TestHelper {
    Handler internal s_handler;

    DecentralizedEURO internal s_deuro;
    TestToken internal s_collateralToken;
        
    /// @notice deploy the contracts required for testing
    function setUp() public {
        s_deuro = new DecentralizedEURO(3 * 84600); // 3 days
        s_collateralToken = new TestToken("Collateral", "COL", 18); // 18 decimals
        PositionRoller positionRoller = new PositionRoller(address(s_deuro));
        PositionFactory positionFactory = new PositionFactory();
        DEPSWrapper depsWrapper = new DEPSWrapper(Equity(address(s_deuro.reserve())));
        FrontendGateway frontendGateway = new FrontendGateway(address(s_deuro), address(depsWrapper));
        SavingsGateway savingsGateway = new SavingsGateway(s_deuro, 5, address(frontendGateway)); // 5% intial interest rate
        MintingHubGateway mintingHubGateway = new MintingHubGateway(
            address(s_deuro), 
            address(savingsGateway), 
            address(positionRoller), 
            address(positionFactory), 
            address(frontendGateway)
        );

        // initilize FrontendGateway
        frontendGateway.init(address(savingsGateway), address(mintingHubGateway));
        
        // initialize minters and wait 1 block
        s_deuro.initialize(address(mintingHubGateway), "Minting Hub");
        s_deuro.initialize(address(this), "Fuzzing Test Contract");
        increaseBlock(1);

        // create the handler
        s_handler = new Handler(s_deuro, s_collateralToken, mintingHubGateway, address(this));

        // create the handler selectors to the fuzzings targets
        bytes4[] memory selectors = new bytes4[](2);
        /// IMintingHubGateway
        selectors[0] = Handler.createPosition.selector;
        /// IPosition
        selectors[1] = Handler.adjustMint.selector;

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
    function invariant_callSummary() public view {
        s_handler.callSummary();
    }
}