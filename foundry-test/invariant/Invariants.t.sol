// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {TestHelper} from "../TestHelper.sol";
import {Handler} from "./Handler.t.sol";
import {Environment} from "./Environment.t.sol";
import {Position} from "../../contracts/MintingHubV2/Position.sol";
import {JuiceDollar} from "../../contracts/JuiceDollar.sol";
import {console} from "forge-std/Test.sol";

contract Invariants is TestHelper {
    Environment internal s_env;
    Handler internal s_handler;

    /// @notice Set up JUSD environment
    function setUp() public {
        // Create environment and handler
        s_env = new Environment();
        s_handler = new Handler(address(s_env));

        // create the handler selectors to the fuzzings targets
        bytes4[] memory selectors = new bytes4[](11);
        /// Position
        selectors[0] = Handler.mintTo.selector;
        selectors[1] = Handler.repay.selector;
        selectors[2] = Handler.addCollateral.selector;
        selectors[3] = Handler.withdrawCollateral.selector;
        selectors[4] = Handler.adjustPrice.selector;
        /// Network specific
        selectors[5] = Handler.passCooldown.selector;
        selectors[6] = Handler.warpTime.selector;
        selectors[7] = Handler.expirePosition.selector;
        /// MintingHub
        selectors[8] = Handler.challengePosition.selector;
        selectors[9] = Handler.bidChallenge.selector;
        selectors[10] = Handler.buyExpiredCollateral.selector;

        targetSelector(FuzzSelector({addr: address(s_handler), selectors: selectors}));
        targetContract(address(s_handler));
    }

    /// @dev check that positions has no trapped JUSD
    function invariant_positionHasNoTrappedJUSD() public view {
        Position[] memory positions = s_env.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            Position pos = positions[i];
            uint256 trapped = s_env.jusd().balanceOf(address(pos));
            assertEq(trapped, 0, "Position has trapped JUSD");
        }
    }

    /// @dev check that position is sufficiently collateralized
    function invariant_positionIsSufficientlyCollateralized() public view {
        Position[] memory positions = s_env.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            Position pos = positions[i];
            if (pos.virtualPrice() < pos.price()) {
                uint256 collateral = pos.collateral().balanceOf(address(pos));
                uint256 requiredCollateralValue = pos.getCollateralRequirement();
                uint256 collateralValue = collateral * pos.price();
                assertGe(collateralValue, requiredCollateralValue * 1e18, "Position is undercollateralized");
            }
        }
    }

    /// @dev check that interest is non-zero implies principal is non-zero
    function invariant_nonZeroInterestImpliesNonZeroPrincipal() public view {
        Position[] memory positions = s_env.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            Position pos = positions[i];
            if (pos.getInterest() > 0) {
                assertGt(pos.principal(), 0, "Interest is non-zero but principal is zero");
            }
        }
    }

    /// @dev check that zero principal implies zero interest
    function invariant_zeroPrincipalImpliesZeroInterest() public view {
        Position[] memory positions = s_env.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            Position pos = positions[i];
            if (pos.principal() == 0) {
                assertEq(pos.getInterest(), 0, "Nonzero interest with zero principal");
            }
        }
    }

    /// @dev check that active positions have minimum collateral
    function invariant_activePositionHasMinimumCollateral() public view {
        Position[] memory positions = s_env.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            Position pos = positions[i];
            if (!pos.isClosed() && block.timestamp < pos.expiration()) {
                uint256 minCollateral = pos.minimumCollateral();
                uint256 collateral = pos.collateral().balanceOf(address(pos));
                assertGe(collateral, minCollateral, "Active position below minimum collateral");
            }
        }
    }

    /// @dev verify debt equals principal plus interest
    function invariant_debtEqualsPrincipalPlusInterest() public view {
        Position[] memory positions = s_env.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            Position pos = positions[i];
            uint256 debt = pos.getDebt();
            uint256 principal = pos.principal();
            uint256 interest = pos.getInterest();
            assertEq(debt, principal + interest, "Debt does not equal principal plus interest");
        }
    }

    /// @dev check that minting limit is not exceeded
    function invariant_mintingLimitNotExceeded() public view {
        Position[] memory positions = s_env.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            Position pos = positions[i];
            uint256 principal = pos.principal();
            uint256 available = pos.availableForMinting();
            uint256 limit = pos.limit();
            assertLe(principal + available, limit, "Minted principal plus available mint exceeds limit");
        }
    }

    /// @dev check that minterReserve in JUSD equals the sum of all positions' reserved amounts
    function invariant_minterReserveConsistency() public view {
        Position[] memory positions = s_env.getPositions();
        uint256 totalReserved = 0;
        
        for (uint256 i = 0; i < positions.length; i++) {
            Position pos = positions[i];
            uint256 principal = pos.principal();
            uint32 reservePPM = pos.reserveContribution();
            totalReserved += (principal * reservePPM) / 1000000;
        }
        
        // Allow small rounding differences
        assertApproxEqAbs(
            s_env.jusd().minterReserve(),
            totalReserved, 
            1e18, 
            "Minter reserve inconsistent with positions' reserved amounts"
        );
    }

    /// @dev check that virtual price is always >= actual price when position has debt/principal
    function invariant_virtualPriceConsistency() public view {
        Position[] memory positions = s_env.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            Position pos = positions[i];
            if (pos.principal() > 0) { 
                assertGe(pos.virtualPrice(), pos.price(), "Virtual price below actual price for position with debt");
            }
        }
    }

    /// @dev verify that total JUSD supply is consistent with expected accounting
    function invariant_totalSupplyConsistency() public view {
        JuiceDollar jusd = s_env.jusd();
        uint256 totalSupply = jusd.totalSupply();
        uint256 totalBalances = 0;
        totalBalances += jusd.balanceOf(address(jusd.reserve()));
        totalBalances += jusd.balanceOf(address(s_env.savingsGateway()));
        for (uint256 i = 0; i < 5; i++) totalBalances += jusd.balanceOf(s_env.eoas(i));
        
        assertEq(totalBalances, totalSupply, "Total JUSD balances inconsistent with total supply");
    }

    /// @dev verify fixed annual rate is always at least the risk premium
    function invariant_fixedRateAboveRiskPremium() public view {
        Position[] memory positions = s_env.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            Position pos = positions[i];
            assertGe(pos.fixedAnnualRatePPM(), pos.riskPremiumPPM(), "Fixed rate below risk premium");
        }
    }

    function invariant_summary() public view {
        if (!s_handler.STATS_LOGGING()) return;

        try this.userSummary(s_env.eoas(0)) {} catch {
            console.log("Error printing user summary");
        }

        console.log("");

        try s_handler.printStatistics() {} catch {
            console.log("Error printing variable distributions");
        }
    }

    // Make external to use try/catch
    function userSummary(address user) external view {
        uint256 positionCount = 0;
        Position[] memory positions = s_env.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            positionCount += positions[i].owner() == user ? 1 : 0;
        }

        console.log("> USERS");
        logHorizontalDivider();
        logRow3("User", ["# Positions", "COL balance", "JUSD balance"]);
        logHorizontalDivider();

        logRow3(
            vm.getLabel(user),
            [
                uint256ToString(positionCount),
                formatUint256(s_env.collateralToken().balanceOf(user), 18),
                formatUint256(s_env.jusd().balanceOf(user), 18)
            ]
        );
    }
}
