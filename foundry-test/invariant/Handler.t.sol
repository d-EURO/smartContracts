// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {console} from "forge-std/Test.sol";
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

contract Handler is TestHelper {
    /// @dev Contract deployer
    address internal s_deployer;

    /// @dev DecentralizedEURO
    DecentralizedEURO internal s_deuro;

    /// @dev TestToken
    TestToken internal s_collateralToken;

    /// @dev MintingHubGateway
    MintingHubGateway internal s_mintingHubGateway;

    /// @dev Positions
    Position[] internal s_positions;

    // OUTPUT VARS - used to print a summary of calls and reverts during certain actions
    /// @dev The number of calls to adjustMint
    uint256 internal s_adjustMintCalls;
    /// @dev The number of reverts on calling `adjustMint`
    uint256 internal s_adjustMintReverts;
    /// @dev The number of times the newPrincipal is unchanged
    uint256 internal s_adjustMintUnchanged;

    /// @dev The number of calls to adjustCollateral
    uint256 internal s_adjustCollateralCalls;
    /// @dev The number of reverts on calling `adjustCollateral`
    uint256 internal s_adjustCollateralReverts;
    /// @dev The number of times the newCollateral is unchanged
    uint256 internal s_adjustCollateralUnchanged;

    /// @dev The number of calls to adjustPrice
    uint256 internal s_adjustPriceCalls;
    /// @dev The number of reverts on calling `adjustPrice`
    uint256 internal s_adjustPriceReverts;
    /// @dev The number of times the adjustPrice is unchanged
    uint256 internal s_adjustPriceUnchanged;

    /// @dev The number of calls to warpTime
    uint256 internal s_warpTimeCalls;

    constructor(
        DecentralizedEURO deuro,
        TestToken collateralToken,
        MintingHubGateway mintingHubGateway, 
        Position[] memory positions,
        address deployer
    ) {
        s_deuro = deuro;
        s_collateralToken = collateralToken;
        s_mintingHubGateway = mintingHubGateway;
        s_positions = positions;
        s_deployer = deployer;
    }

    /// @dev adjustMint
    function adjustMint(uint256 positionIdx, uint256 newPrincipal) public {
        s_adjustMintCalls++;

        // Get the position
        positionIdx = positionIdx % s_positions.length;
        Position position = s_positions[positionIdx];
        uint256 currentPrincipal = position.principal();

        // Bound newPrincipal
        uint256 basePrice = position.price();
        uint256 minimumCollateral = position.minimumCollateral();
        uint256 collateralReserve = s_collateralToken.balanceOf(address(position));
        uint256 relevantCollateral = collateralReserve < minimumCollateral ? 0 : collateralReserve;
        uint256 maxEligiblePrincipal = (relevantCollateral * basePrice) / 1e18;
        uint256 availableForMinting = currentPrincipal + position.availableForMinting();
        maxEligiblePrincipal = maxEligiblePrincipal > availableForMinting ? availableForMinting : maxEligiblePrincipal;
        newPrincipal = bound(newPrincipal, 1e17, maxEligiblePrincipal);
        if (newPrincipal < 1e18) newPrincipal = 0;

        vm.prank(position.owner());
        try position.adjust(newPrincipal, collateralReserve, basePrice) {
            // success
            if (newPrincipal == currentPrincipal) s_adjustMintUnchanged++;
            // console.log("------------------------------------");
            // console.log(("maxEligiblePrincipal: %s"), maxEligiblePrincipal);
            // console.log(("newPrincipal: %s"), newPrincipal);
            // console.log("Position principal: %s", position.principal());
            // console.log("Position collateral: %s", s_collateralToken.balanceOf(address(position)));
        } catch {
            s_adjustMintReverts++;
            // console.log("----------------- REVERTED ------------------");
            // console.log("availableForMinting: %s", availableForMinting);
            // console.log("totalMinted: %s", totalMinted);
            // console.log("limit: %s", limit);
            // console.log(("maxEligiblePrincipal: %s"), maxEligiblePrincipal);
            // console.log(("newPrincipal: %s"), newPrincipal);
            // console.log("Position principal: %s", position.principal());
            // console.log("Position collateral: %s", s_collateralToken.balanceOf(address(position)));         
        }
    }

    /// @dev adjustCollateral
    function adjustCollateral(uint256 positionIdx, uint256 newCollateral) public {
        s_adjustCollateralCalls++;

        // Get the position
        Position position = s_positions[positionIdx % s_positions.length];
        uint256 currentCollateral = s_collateralToken.balanceOf(address(position));

        // Bound newCollateral
        // lower bound
        uint256 basePrice = position.price();
        uint256 debt = position.getDebt();
        uint256 minRequiredCollateral = debt * 1e18 / basePrice;
        uint256 minimumCollateral = position.minimumCollateral();
        if (minRequiredCollateral < minimumCollateral) minRequiredCollateral = minimumCollateral;
        // upper bound
        uint256 mintLimit = position.limit();
        uint256 annualInterestRatePPM = position.fixedAnnualRatePPM();
        uint256 annualInterest = (mintLimit * (1e6 + annualInterestRatePPM)) / 1e6;
        uint256 upperBoundDebt = mintLimit + (10 * annualInterest); // 10 years of interest
        uint256 maxRequiredCollateral = (upperBoundDebt * 1e18 )/ basePrice;
        newCollateral = bound(newCollateral, minRequiredCollateral, maxRequiredCollateral);

        // adjusts the position collateral
        uint256 currentPrincipal = position.principal();
        vm.prank(position.owner());
        try position.adjust(currentPrincipal, newCollateral, basePrice) {
            // success
            if (newCollateral == currentCollateral) s_adjustCollateralUnchanged++;
            // console.log("------------------------------------");
            // console.log(("minimumCollateral: %s"), minimumCollateral);
            // console.log(("maxRequiredCollateral: %s"), maxRequiredCollateral);
            // console.log(("newCollateral: %s"), newCollateral);
            // console.log("Position principal: %s", position.principal());
            // console.log("Position collateral: %s", s_collateralToken.balanceOf(address(position)));
        } catch {
            s_adjustCollateralReverts++;
        }
    }

    /// @dev adjustPrice
    function adjustPrice(uint256 positionIdx, uint256 newPrice) public {
        if (skipActionWithOdds(70, newPrice)) return; // 70% chance to skip

        s_adjustPriceCalls++;

        // Get the position
        Position position = s_positions[positionIdx % s_positions.length];
        uint256 currentPrice = position.price();

        // Bound newPrice
        // lower bound
        uint256 debt = position.getDebt();
        uint256 minimumCollateral = position.minimumCollateral();
        uint256 collateralReserve = s_collateralToken.balanceOf(address(position));
        uint256 relevantCollateral = collateralReserve < minimumCollateral ? 0 : collateralReserve;
        uint256 minPrice = (debt * 1e18) / relevantCollateral;

        // upper bound
        uint256 principal = position.principal();
        uint256 availableForMinting = position.availableForMinting();
        uint256 bounds = principal + availableForMinting;
        uint256 maxPrice = (bounds * 1e18) / collateralReserve;

        newPrice = bound(newPrice, minPrice, maxPrice);

        // adjusts the position collateral
        vm.prank(position.owner());
        try position.adjust(principal, collateralReserve, newPrice) {
            // success
            if (newPrice == currentPrice) s_adjustPriceUnchanged++;
        } catch {
            s_adjustPriceReverts++;
        }
    }

    function warpTime(uint256 daysToWarp) external {
        s_warpTimeCalls++;
        uint256 minDays = 1;
        uint256 maxDays = 2;
        daysToWarp = bound(daysToWarp, minDays, maxDays);
        increaseTime(daysToWarp * 1 days);
    }

    /// @dev Prints a call summary of calls and reverts to certain actions
    function callSummary() external view {
        console.log("========================================");
        console.log("           ACTIONS SUMMARY");
        console.log("========================================");

        console.log(">> adjustMint():");
        console.log("   Calls:     %s", s_adjustMintCalls);
        console.log("   Reverts:   %s", s_adjustMintReverts);
        console.log("   Unchanged: %s", s_adjustMintUnchanged);
        console.log("");

        console.log(">> adjustCollateral():");
        console.log("   Calls:     %s", s_adjustCollateralCalls);
        console.log("   Reverts:   %s", s_adjustCollateralReverts);
        console.log("   Unchanged: %s", s_adjustCollateralUnchanged);
        console.log("");

        console.log(">> adjustPrice():");
        console.log("   Calls:     %s", s_adjustPriceCalls);
        console.log("   Reverts:   %s", s_adjustPriceReverts);
        console.log("   Unchanged: %s", s_adjustPriceUnchanged);
        console.log("");

        console.log(">> warpTime():");
        console.log("   Calls:     %s", s_warpTimeCalls);
    }

    // Helper functions 

    // Internal

    /// @dev Return whether to skip an action based on a skip percent and a seed
    function skipActionWithOdds(uint256 skipPercent, uint256 seed) internal view returns (bool) {
        return uint256(keccak256(abi.encodePacked(block.timestamp, seed))) % 100 > 100 - skipPercent;
    }

    // External

    /// @dev Get positions
    function getPositions() external view returns (Position[] memory) {
        return s_positions;
    }
}