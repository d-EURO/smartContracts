// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {TestHelper} from "../TestHelper.sol";
import {Handler} from "./Handler.t.sol";
import {Environment} from "./Environment.t.sol";
import {Position} from "../../contracts/MintingHubV3/Position.sol";
import {MintingHub} from "../../contracts/MintingHubV3/MintingHub.sol";
import {DecentralizedEURO} from "../../contracts/DecentralizedEURO.sol";
import {Equity} from "../../contracts/Equity.sol";
import {Savings} from "../../contracts/Savings.sol";
import {StablecoinBridge} from "../../contracts/StablecoinBridge.sol";
import {console} from "forge-std/Test.sol";

contract Invariants is TestHelper {
    Environment internal s_env;
    Handler internal s_handler;

    uint64 internal s_lastMintingHubTicks;
    uint64 internal s_lastSavingsTicks;

    /// @notice Set up dEURO environment
    function setUp() public {
        // Create environment and handler
        s_env = new Environment();
        s_handler = new Handler(address(s_env));

        // create the handler selectors to the fuzzings targets
        bytes4[] memory selectors = new bytes4[](22);
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
        /// Savings
        selectors[11] = Handler.saveDEURO.selector;
        selectors[12] = Handler.withdrawSavings.selector;
        selectors[13] = Handler.claimSavingsInterest.selector;
        selectors[14] = Handler.refreshSavings.selector;
        /// Equity
        selectors[15] = Handler.investEquity.selector;
        selectors[16] = Handler.redeemEquity.selector;
        /// StablecoinBridge
        selectors[17] = Handler.bridgeMint.selector;
        selectors[18] = Handler.bridgeBurn.selector;
        /// Multi-position
        selectors[19] = Handler.clonePosition.selector;
        /// Governance
        selectors[20] = Handler.proposeLeadrateChange.selector;
        selectors[21] = Handler.applyLeadrateChange.selector;

        targetSelector(FuzzSelector({addr: address(s_handler), selectors: selectors}));
        targetContract(address(s_handler));
    }

    /// @dev check that positions has no trapped dEURO
    function invariant_positionHasNoTrappeddEURO() public view {
        Position[] memory positions = s_env.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            Position pos = positions[i];
            uint256 trapped = s_env.deuro().balanceOf(address(pos));
            assertEq(trapped, 0, "Position has trapped dEURO");
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

    /// @dev check that minterReserve in dEURO equals the sum of all positions' reserved amounts
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
            s_env.deuro().minterReserve(), 
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

    /// @dev verify that total dEURO supply is consistent with expected accounting
    function invariant_totalSupplyConsistency() public view {
        DecentralizedEURO deuro = s_env.deuro();
        uint256 totalSupply = deuro.totalSupply();

        uint256 totalBalances = 0;
        totalBalances += deuro.balanceOf(address(deuro.reserve()));
        totalBalances += deuro.balanceOf(address(s_env.savings()));
        totalBalances += deuro.balanceOf(address(s_env.bridge()));
        totalBalances += deuro.balanceOf(address(s_env.mintingHub()));
        for (uint256 i = 0; i < 5; i++) totalBalances += deuro.balanceOf(s_env.eoas(i));

        // Include all positions (originals + clones)
        Position[] memory positions = s_env.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            totalBalances += deuro.balanceOf(address(positions[i]));
        }

        assertEq(totalBalances, totalSupply, "Total dEURO balances inconsistent with total supply");
    }

    /// @dev verify fixed annual rate is always at least the risk premium
    function invariant_fixedRateAboveRiskPremium() public view {
        Position[] memory positions = s_env.getPositions();
        for (uint256 i = 0; i < positions.length; i++) {
            Position pos = positions[i];
            assertGe(pos.fixedAnnualRatePPM(), pos.riskPremiumPPM(), "Fixed rate below risk premium");
        }
    }

    /// @dev MISS-1: Reserve balance must always cover the minter reserve (system solvency)
    function invariant_reserveSolvency() public view {
        DecentralizedEURO deuro = s_env.deuro();
        uint256 reserveBalance = deuro.balanceOf(address(deuro.reserve()));
        uint256 minterReserve = deuro.minterReserve();
        assertGe(reserveBalance, minterReserve, "MISS-1: Reserve balance below minter reserve (system insolvent)");
    }

    /// @dev MISS-2: Equity accounting identity
    function invariant_equityIdentity() public view {
        DecentralizedEURO deuro = s_env.deuro();
        uint256 reserveBalance = deuro.balanceOf(address(deuro.reserve()));
        uint256 minterReserve = deuro.minterReserve();
        uint256 equity = deuro.equity();

        if (reserveBalance > minterReserve) {
            assertEq(equity, reserveBalance - minterReserve, "MISS-2: Equity identity violated");
        } else {
            assertEq(equity, 0, "MISS-2: Equity should be 0 when reserve depleted");
        }
    }

    /// @dev MISS-5: PositionRoller holds zero dEURO between transactions (flash loan net-to-zero)
    function invariant_rollerNetZero() public view {
        uint256 rollerBalance = s_env.deuro().balanceOf(address(s_env.positionRoller()));
        assertEq(rollerBalance, 0, "MISS-5: PositionRoller holds dEURO (flash loan not repaid)");
    }

    /// @dev MISS-7: nDEPS total supply cannot exceed uint96 max
    function invariant_ndepsSupplyCap() public view {
        Equity equity = Equity(address(s_env.deuro().reserve()));
        assertLe(equity.totalSupply(), type(uint96).max, "MISS-7: nDEPS supply exceeds uint96 max");
    }

    /// @dev Savings solvency: contract holds enough dEURO to cover all saved + claimable interest
    function invariant_savingsSolvency() public view {
        Savings sav = s_env.savings();
        DecentralizedEURO deuro = s_env.deuro();
        uint256 savingsBalance = deuro.balanceOf(address(sav));

        uint256 totalObligations = 0;
        for (uint256 i = 0; i < 5; i++) {
            address actor = s_env.eoas(i);
            (uint192 saved,) = sav.savings(actor);
            uint192 claimable = sav.claimableInterest(actor);
            totalObligations += uint256(saved) + uint256(claimable);
        }

        assertGe(savingsBalance, totalObligations, "Savings insolvent: balance < saved + claimable");
    }

    /// @dev Bridge backing: EUR token balance must cover outstanding minted dEURO
    function invariant_bridgeBacking() public view {
        StablecoinBridge br = s_env.bridge();
        uint256 eurBalance = s_env.eurToken().balanceOf(address(br));
        uint256 minted = br.minted();
        assertGe(eurBalance, minted, "Bridge not fully backed: EUR balance < minted");
    }

    /// @dev Bridge limit: minted must not exceed limit
    function invariant_bridgeLimit() public view {
        StablecoinBridge br = s_env.bridge();
        assertLe(br.minted(), br.limit(), "Bridge minted exceeds limit");
    }

    /// @dev MISS-4: Savings interest calculation is correct and capped by equity.
    ///      Independently recalculates expected interest and cross-checks against
    ///      the contract's accruedInterest(). Catches formula bugs, cap bypass,
    ///      and uint192 truncation issues.
    function invariant_savingsInterestCapped() public view {
        Savings sav = s_env.savings();
        DecentralizedEURO deuro = s_env.deuro();
        uint256 equity = deuro.equity();

        for (uint256 i = 0; i < 5; i++) {
            address actor = s_env.eoas(i);
            uint192 accrued = sav.accruedInterest(actor);

            // Cap check (enforced by calculateInterest, verified independently)
            assertLe(uint256(accrued), equity, "MISS-4: Accrued interest exceeds equity");

            // Independent calculation cross-check
            (uint192 saved, uint64 accountTicks) = sav.savings(actor);
            if (saved > 0 && accountTicks > 0) {
                uint64 curTicks = sav.currentTicks();
                if (curTicks > accountTicks) {
                    uint256 tickDelta = uint256(curTicks - accountTicks);
                    uint256 expectedInterest = (tickDelta * uint256(saved)) / 1_000_000 / 365 days;
                    uint256 cappedExpected = expectedInterest > equity ? equity : expectedInterest;
                    assertEq(
                        uint256(accrued),
                        cappedExpected,
                        "MISS-4: Interest calculation mismatch"
                    );
                }
            }
        }
    }

    /// @dev MISS-6: Leadrate ticks are monotonically non-decreasing
    function invariant_leadrateTicksMonotonic() public {
        MintingHub hub = s_env.mintingHub();
        Savings sav = s_env.savings();

        uint64 hubTicks = hub.currentTicks();
        uint64 savTicks = sav.currentTicks();

        assertGe(hubTicks, s_lastMintingHubTicks, "MISS-6: MintingHub ticks decreased");
        assertGe(savTicks, s_lastSavingsTicks, "MISS-6: Savings ticks decreased");

        s_lastMintingHubTicks = hubTicks;
        s_lastSavingsTicks = savTicks;
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
        logRow3("User", ["# Positions", "COL balance", "dEURO balance"]);
        logHorizontalDivider();

        logRow3(
            vm.getLabel(user),
            [
                uint256ToString(positionCount),
                formatUint256(s_env.collateralToken().balanceOf(user), 18),
                formatUint256(s_env.deuro().balanceOf(user), 18)
            ]
        );
    }
}
