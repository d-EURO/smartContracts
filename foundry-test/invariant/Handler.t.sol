// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {console} from "forge-std/Test.sol";
import {Position} from "../../contracts/MintingHubV2/Position.sol";
import {DecentralizedEURO} from "../../contracts/DecentralizedEURO.sol";
import {MintingHub} from "../../contracts/MintingHubV2/MintingHub.sol";
import {TestToken} from "../../contracts/test/TestToken.sol";
import {PositionFactory} from "../../contracts/MintingHubV2/PositionFactory.sol";
import {SavingsGateway} from "../../contracts/gateway/SavingsGateway.sol";
import {DEPSWrapper} from "../../contracts/utils/DEPSWrapper.sol";
import {FrontendGateway} from "../../contracts/gateway/FrontendGateway.sol";
import {MintingHubGateway} from "../../contracts/gateway/MintingHubGateway.sol";
import {PositionRoller} from "../../contracts/MintingHubV2/PositionRoller.sol";
import {IPosition} from "../../contracts/MintingHubV2/interface/IPosition.sol";
import {Equity} from "../../contracts/Equity.sol";
import {TestHelper} from "../TestHelper.sol";
import {StatsCollector} from "./StatsCollector.sol";

contract Handler is TestHelper {
    /// @dev Contract deployer
    address internal s_deployer;

    /// @dev Challenger address
    address internal s_challenger;

    /// @dev Bidder address
    address internal s_bidder;

    /// @dev DecentralizedEURO
    DecentralizedEURO internal s_deuro;

    /// @dev TestToken
    TestToken internal s_collateralToken;

    /// @dev MintingHubGateway
    MintingHubGateway internal s_mintingHubGateway;

    /// @dev Positions
    Position[] internal s_positions;

    /// @dev mintTo() stats
    uint256 internal s_mintToCalls;
    uint256 internal s_mintToReverts;

    /// @dev repay() stats
    uint256 internal s_repayCalls;
    uint256 internal s_repayReverts;

    /// @dev addCollateral() stats
    uint256 internal s_addCollateralCalls;
    uint256 internal s_addCollateralReverts;

    /// @dev withdrawCollateral() stats
    uint256 internal s_withdrawCollateralCalls;
    uint256 internal s_withdrawCollateralReverts;

    /// @dev adjustPrice() stats
    uint256 internal s_adjustPriceCalls;
    uint256 internal s_adjustPriceReverts;
    uint256 internal s_adjustPriceUnchanged;

    /// @dev challengePosition() stats
    uint256 internal s_challengePositionCalls;
    uint256 internal s_challengePositionReverts;
    uint256 internal s_openedChallenges;

    /// @dev bidChallenge() stats
    uint256 internal s_bidChallengeCalls;
    uint256 internal s_bidChallengeReverts;

    /// @dev buyExpiredCollateral() stats
    uint256 internal s_buyExpiredCollateralCalls;
    uint256 internal s_buyExpiredCollateralReverts;

    /// @dev passCooldown() stats
    uint256 internal s_passCooldownCalls;

    /// @dev expirePosition() stats
    uint256 internal s_expirePositionCalls;

    /// @dev warpTime() stats
    uint256 internal s_warpTimeCalls;

    /// @dev Stats collector for variable distributions
    StatsCollector internal s_statsCollector;

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

        // Create challenger and bidder addresses
        s_challenger = vm.addr(10); // REVIEW: Allow it to be Alice (pick from pool of addresses)
        vm.label(s_challenger, "Challenger");
        s_bidder = vm.addr(9);
        vm.label(s_bidder, "Bidder");
        
        // Initialize stats collector
        s_statsCollector = new StatsCollector();
        
        // Initialize statistics for tracking important variables
        s_statsCollector.initStatistics("position.price");
        s_statsCollector.initStatistics("position.principal");
        s_statsCollector.initStatistics("position.collateral");
        s_statsCollector.initStatistics("position.interest");
        
        // Additional ratio statistics that provide meaningful insights
        s_statsCollector.initStatistics("position.collateralToPrincipalRatio"); // collateral / principal
        s_statsCollector.initStatistics("position.collateralUtilization"); // principal / max_principal
        s_statsCollector.initStatistics("position.bufferAboveMin"); // how much above min collateral
    }

    /// @dev mintTo
    function mintTo(uint256 positionIdx, uint256 amount) public {
        // Get the position
        Position position = s_positions[positionIdx % s_positions.length];

        // Record variable values before operation
        _recordPositionState(position);

        // Check for conditions that would cause mint to fail and skip the iteration
        bool isCooldown = position.cooldown() > block.timestamp;
        bool isChallenged = position.challengedAmount() > 0;
        bool isExpired = block.timestamp >= position.expiration();
        bool isClosed = position.isClosed();
        bool hasCollateral = s_collateralToken.balanceOf(address(position)) > 0;
        if (isCooldown || isChallenged || isExpired || isClosed || (amount > 0 && !hasCollateral)) {
            return;
        }

        s_mintToCalls++;

        // Bound newPrincipal
        uint256 _maxPrincipal = maxPrincipal(position);
        amount = bound(amount, 0, _maxPrincipal - position.principal());

        // Set up event recorder before the call
        vm.recordLogs();

        // TODO: Pick from a pool of addresses to mint to
        vm.startPrank(position.owner());
        try position.mint(position.owner(), amount) {
            // success
        } catch {
            s_mintToReverts++;
        }
        vm.stopPrank();
        
        // Record variable values after operation
        _recordPositionState(position);
    }

    /// @dev repay
    function repay(uint256 positionIdx, uint256 amount) public {
        // Skip with 70% chance
        if (skipActionWithOdds(70, positionIdx)) return;
        
        s_repayCalls++;

        // Get the position
        Position position = s_positions[positionIdx % s_positions.length];
        
        // Record position state before operation
        _recordPositionState(position);

        // Bound amount
        amount = bound(amount, 0, position.getDebt());

        vm.startPrank(position.owner());
        try position.repay(amount) {
            // success
        } catch {
            s_repayReverts++;
        }
        vm.stopPrank();
        
        // Record position state after operation
        _recordPositionState(position);
    }

    /// @dev addCollateral
    function addCollateral(uint256 positionIdx, uint256 amount) public {
        s_addCollateralCalls++;

        // Get the position
        Position position = s_positions[positionIdx % s_positions.length];
        
        // Record position state before operation
        _recordPositionState(position);

        // Bound amount
        amount = bound(amount, 0, s_collateralToken.balanceOf(position.owner()));

        vm.startPrank(position.owner());
        try s_collateralToken.transfer(address(position), amount) {
            // success
        } catch {
            s_addCollateralReverts++;
        }
        vm.stopPrank();
        
        // Record position state after operation
        _recordPositionState(position);
    }

    /// @dev withdrawCollateral
    function withdrawCollateral(uint256 positionIdx, uint256 amount) public {
        s_withdrawCollateralCalls++;

        // Get the position
        Position position = s_positions[positionIdx % s_positions.length];
        
        // Record position state before operation
        _recordPositionState(position);

        // Check for conditions that would cause mint to fail and skip the iteration
        bool isChallenged = position.challengedAmount() > 0;
        bool isCooldown = position.cooldown() > block.timestamp;
        if (isChallenged || isCooldown) {
            return;
        }

        // Bound amount
        uint256 _requiredCollateral = requiredCollateral(position);
        uint256 collateralReserve = s_collateralToken.balanceOf(address(position));
        uint256 maxWithdraw = collateralReserve > _requiredCollateral ? collateralReserve - _requiredCollateral : 0;
        amount = bound(amount, 0, maxWithdraw);

        vm.startPrank(position.owner());
        try position.withdrawCollateral(position.owner(), amount) {
            // success
        } catch {
            s_withdrawCollateralReverts++;
        }
        vm.stopPrank();
        
        // Record position state after operation
        _recordPositionState(position);
    }

    /// @dev adjustPrice
    /// REVIEW: Price starts at 5k and shrinks considerably in most runs. Why is that?
    function adjustPrice(uint256 positionIdx, uint256 newPrice) public {
        // Get the position
        Position position = s_positions[positionIdx % s_positions.length];
        uint256 currentPrice = position.price();
        
        // Record position state before operation
        _recordPositionState(position);

        // Skip with 70% chance
        if(skipActionWithOdds(70, newPrice)) return;

        // Check for conditions that would cause adjustPrice to fail and skip the iteration
        bool isCooldown = position.cooldown() > block.timestamp;
        bool isChallenged = position.challengedAmount() > 0;
        bool isExpired = block.timestamp >= position.expiration();
        bool isClosed = position.isClosed();
        if (isCooldown || isChallenged || isExpired || isClosed) {
            return;
        }

        s_adjustPriceCalls++;

        // Bound newPrice
        (uint256 minPrice, uint256 maxPrice) = priceRange(position);
        newPrice = bound(newPrice, minPrice, maxPrice);
        if (newPrice == currentPrice) s_adjustPriceUnchanged++;

        vm.startPrank(position.owner());
        try position.adjustPrice(newPrice) {
            // success
        } catch {
            s_adjustPriceReverts++;
            // console.log("========================================");
            // console.log("           adjustPrice reverted:");
            // console.log("========================================");
            // console.log("Position index: %s", positionIdx % s_positions.length);
            // console.log("Current price:  %s", currentPrice);
            // console.log("New price:      %s", newPrice);
            // console.log("Min price:      %s", minPrice);
            // console.log("Max price:      %s", maxPrice);
        }
        vm.stopPrank();
        
        // Record position state after operation
        _recordPositionState(position);
    }

    // In your Handler contract

    /// @dev Initiates a challenge on one of the positions managed by the handler.
    function challengePosition(uint256 positionIdx, uint256 collateralAmount, uint256 minPrice) public {
        s_challengePositionCalls++;

        // Select a position from the positions array.
        Position position = s_positions[positionIdx % s_positions.length];

        // Bound collateralAmount
        uint256 minimumCollateral = position.minimumCollateral();
        uint256 collateralReserve = s_collateralToken.balanceOf(address(position));
        uint256 minColAmount = min(minimumCollateral, collateralReserve);
        uint256 maxColAmount = (5 * collateralReserve) / 4; // 1.25 x collateralReserve
        collateralAmount = bound(collateralAmount, minColAmount, maxColAmount);

        // Bound minPrice
        uint256 currentVirtualPrice = position.virtualPrice();
        minPrice = bound(minPrice, 0, currentVirtualPrice);

        // adjusts the position collateral
        vm.prank(s_challenger);
        try s_mintingHubGateway.challenge(address(position), collateralAmount, minPrice) {
            // success
            s_openedChallenges++;

            // console.log("========================================");
            // console.log("Challenge initiated:");
            // console.log("  Position index:    %s", address(position));
            // console.log("  Collateral amount: %s", collateralAmount);
            // console.log("  Minimum price:     %s", minPrice);
            // console.log("========================================");
        } catch {
            s_challengePositionReverts++;
        }
    }

    /// @dev Posts a bid on an existing challenge.
    function bidChallenge(uint256 challengeIndex, uint256 bidSize, bool postpone) public {
        s_bidChallengeCalls++;

        // Bound challengeIndex
        MintingHub.Challenge memory challenge;
        for (uint256 i = 0; i < s_openedChallenges; i++) {
            (address challenger, uint40 start, IPosition position, uint256 size) = s_mintingHubGateway.challenges(
                (challengeIndex + i) % s_openedChallenges
            );
            if (position != IPosition(address(0))) {
                challenge = MintingHub.Challenge(challenger, start, position, size);
                break;
            }
        }

        // Bound bidSize
        bidSize = bidSize % challenge.size;

        // (Optional) Simulate a bidder by using vm.prank(bidderAddress) if desired.
        vm.prank(s_bidder);
        try s_mintingHubGateway.bid(uint32(challengeIndex), bidSize, postpone) {
            // success
            // console.log("========================================");
            // console.log("Bid placed:");
            // console.log("  Challenge index: %s", challengeIndex);
            // console.log("  Bid size:        %s", formatUint256(bidSize, 18));
            // console.log("  Postpone flag:   %s", postpone);
            // console.log("========================================");
        } catch {
            s_bidChallengeReverts++;
        }
    }

    /// @dev Buys collateral from an expired position.
    function buyExpiredCollateral(uint256 positionIdx, uint256 upToAmount) public {
        s_buyExpiredCollateralCalls++;

        // Select a position from the positions array.
        Position position = s_positions[positionIdx % s_positions.length];

        // Bound upToAmount
        uint256 forceSalePrice = s_mintingHubGateway.expiredPurchasePrice(position);
        uint256 maxAmount = s_collateralToken.balanceOf(address(position));
        uint256 dustAmount = (s_mintingHubGateway.OPENING_FEE() * 1e18) / forceSalePrice;
        upToAmount = bound(upToAmount, 0, maxAmount);
        // leave no dust behind
        if (upToAmount < maxAmount && maxAmount - upToAmount < dustAmount) {
            upToAmount = maxAmount - dustAmount;
        }

        // adjusts the position collateral
        vm.prank(s_bidder);
        try s_mintingHubGateway.buyExpiredCollateral(position, upToAmount) {
            // success
        } catch {
            s_buyExpiredCollateralReverts++;

            // console.log("========================================");
            // console.log("buyExpiredCollateral:");
            // console.log("  Position index:      %s", address(position));
            // console.log("  Position expired:    %s", block.timestamp >= position.expiration());
            // console.log("  Position collateral: %s", formatUint256(maxAmount, 18));
            // console.log("  Amount:              %s", formatUint256(upToAmount, 18));
            // console.log("  Remaining:           %s", formatUint256(maxAmount - upToAmount, 18));
            // console.log("  Dust amount:         %s", formatUint256(dustAmount, 18));
            // console.log("  Forced sale price:   %s", formatUint256(forceSalePrice, 18));
            // console.log("========================================");
        }
    }

    /// @dev Expire a position
    function expirePosition(uint256 positionIdx) external {
        Position position = s_positions[positionIdx % s_positions.length];

        // Skip with 99% chance
        if (skipActionWithOdds(99, positionIdx)) return;

        bool isExpired = block.timestamp >= position.expiration();
        if (isExpired) return;

        s_expirePositionCalls++;

        uint40 expiration = position.expiration();
        increaseTime(expiration - block.timestamp);
    }

    /// @dev Pass the cooldown period of a position
    function passCooldown(uint256 positionIdx) external {
        Position position = s_positions[positionIdx % s_positions.length];

        // Only proceed if there's actually a cooldown to pass
        if (position.cooldown() <= block.timestamp) return;

        s_passCooldownCalls++;
        
        uint40 cooldown = position.cooldown();
        uint256 timeToAdvance = cooldown - block.timestamp + 1; // Add 1 second to ensure we're past cooldown
        increaseTime(timeToAdvance);
    }

    /// @dev Warp time by 2 days
    function warpTime(uint256 daysToWarp) external {
        // Skip with 95% chance
        if (skipActionWithOdds(95, daysToWarp)) return;

        s_warpTimeCalls++;

        increaseTime(2 days);
    }

    /// @dev Prints a call summary of calls and reverts to certain actions
    function callSummary() external view {
        console.log("========================================");
        console.log("           ACTIONS SUMMARY");
        console.log("========================================");

        console.log(">> mintTo():");
        console.log("   Calls:     %s", s_mintToCalls);
        console.log("   Reverts:   %s", s_mintToReverts);
        console.log("");

        console.log(">> repay():");
        console.log("   Calls:     %s", s_repayCalls);
        console.log("   Reverts:   %s", s_repayReverts);
        console.log("");

        console.log(">> addCollateral():");
        console.log("   Calls:     %s", s_addCollateralCalls);
        console.log("   Reverts:   %s", s_addCollateralReverts);
        console.log("");

        console.log(">> withdrawCollateral():");
        console.log("   Calls:     %s", s_withdrawCollateralCalls);
        console.log("   Reverts:   %s", s_withdrawCollateralReverts);
        console.log("");

        console.log(">> adjustPrice():");
        console.log("   Calls:     %s", s_adjustPriceCalls);
        console.log("   Reverts:   %s", s_adjustPriceReverts);
        console.log("   Unchanged: %s", s_adjustPriceUnchanged);
        console.log("");

        console.log(">> challengePosition():");
        console.log("   Calls:     %s", s_challengePositionCalls);
        console.log("   Reverts:   %s", s_challengePositionReverts);
        console.log("   Opened:    %s", s_openedChallenges);
        console.log("");

        console.log(">> bidChallenge():");
        console.log("   Calls:     %s", s_bidChallengeCalls);
        console.log("   Reverts:   %s", s_bidChallengeReverts);
        console.log("");

        console.log(">> buyExpiredCollateral():");
        console.log("   Calls:     %s", s_buyExpiredCollateralCalls);
        console.log("   Reverts:   %s", s_buyExpiredCollateralReverts);
        console.log("");

        console.log(">> passCooldown():");
        console.log("   Calls:     %s", s_passCooldownCalls);
        console.log("");

        console.log(">> expirePosition():");
        console.log("   Calls:     %s", s_expirePositionCalls);
        console.log("");

        console.log(">> warpTime():");
        console.log("   Calls:     %s", s_warpTimeCalls);
    }

    // Helper functions

    // Internal

    /// @dev Max supported principal for a given position
    function maxPrincipal(Position position) internal view returns (uint256) {
        uint256 currentPrincipal = position.principal();
        uint256 minimumCollateral = position.minimumCollateral();
        uint256 collateralReserve = s_collateralToken.balanceOf(address(position));
        uint256 relevantCollateral = collateralReserve < minimumCollateral ? 0 : collateralReserve;
        uint256 _maxPrincipal = (relevantCollateral * position.price()) / 1e18;
        uint256 availableForMinting = currentPrincipal + position.availableForMinting();
        return _maxPrincipal > availableForMinting ? availableForMinting : _maxPrincipal;
    }

    /// @dev Required collateral for a given position
    function requiredCollateral(Position position) internal view returns (uint256) {
        uint256 basePrice = position.price();
        uint256 debt = position.getDebt();
        uint256 _requiredCollateral = (debt * 1e18) / basePrice;
        uint256 minimumCollateral = position.minimumCollateral();
        return _requiredCollateral < minimumCollateral ? minimumCollateral : _requiredCollateral;
    }

    /// @dev Allowed price range for a given position
    function priceRange(Position position) internal view returns (uint256, uint256) {
        // lower bound
        uint256 debt = position.getDebt();
        uint256 minimumCollateral = position.minimumCollateral();
        uint256 collateralReserve = s_collateralToken.balanceOf(address(position));
        uint256 relevantCollateral = collateralReserve < minimumCollateral ? 0 : collateralReserve;
        uint256 minPrice = (debt * 1e18) / relevantCollateral;
        // upper bound
        uint256 principal = position.principal();
        uint256 availableForMinting = position.availableForMinting();
        uint256 maxMintable = principal + availableForMinting;
        uint256 maxPrice = (maxMintable * 1e18) / collateralReserve;
        uint256 currentPrice = position.price();
        maxPrice = maxPrice > 2 * currentPrice ? 2 * currentPrice : maxPrice;
        return (minPrice, maxPrice);
    }

    /// @dev Return whether to skip an action based on a skip percent and a seed
    function skipActionWithOdds(uint256 skipPercent, uint256 seed) internal view returns (bool) {
        return uint256(keccak256(abi.encodePacked(block.timestamp, seed))) % 100 > 100 - skipPercent;
    }

    /// @dev Helper function to record position state statistics
    function _recordPositionState(Position position) public {
        // Get basic values
        uint256 price = position.price();
        uint256 principal = position.principal();
        uint256 collateral = s_collateralToken.balanceOf(address(position));
        uint256 interest = position.getInterest();
        uint256 minCollateral = position.minimumCollateral();
        
        // Record basic metrics
        s_statsCollector.recordValue("position.price", price);
        s_statsCollector.recordValue("position.principal", principal);
        s_statsCollector.recordValue("position.collateral", collateral);
        s_statsCollector.recordValue("position.interest", interest);
        
        // Record derived metrics (ratios and utilization)
        if (principal > 0) {
            // Collateral to principal ratio (higher is safer)
            uint256 collateralToPrincipalRatio = (collateral * price) / principal;
            s_statsCollector.recordValue("position.collateralToPrincipalRatio", collateralToPrincipalRatio);
        }
        
        // Calculate max principal possible with current collateral
        uint256 maxPossiblePrincipal = collateral == 0 ? 0 : (collateral * price) / 1e18;
        if (maxPossiblePrincipal > 0) {
            // How much of the possible principal is being used (0-100%)
            uint256 utilization = (principal * 100) / maxPossiblePrincipal;
            s_statsCollector.recordValue("position.collateralUtilization", utilization);
        }
        
        // How much buffer above minimum collateral requirement
        if (collateral > minCollateral) {
            uint256 buffer = collateral - minCollateral;
            s_statsCollector.recordValue("position.bufferAboveMin", buffer);
        }
    }
    
    /// @dev Print variable distribution statistics
    function printVariableDistributions() external view {
        // Calculate various metrics to evaluate how well the fuzzing is testing different state spaces
        
        // Calculate success ratios for each operation
        uint256 mintToSuccessRatio = s_mintToCalls > 0 ? 100 * (s_mintToCalls - s_mintToReverts) / s_mintToCalls : 0;
        uint256 repaySuccessRatio = s_repayCalls > 0 ? 100 * (s_repayCalls - s_repayReverts) / s_repayCalls : 0;
        uint256 addCollateralSuccessRatio = s_addCollateralCalls > 0 ? 100 * (s_addCollateralCalls - s_addCollateralReverts) / s_addCollateralCalls : 0;
        uint256 withdrawCollateralSuccessRatio = s_withdrawCollateralCalls > 0 ? 100 * (s_withdrawCollateralCalls - s_withdrawCollateralReverts) / s_withdrawCollateralCalls : 0;
        uint256 adjustPriceSuccessRatio = s_adjustPriceCalls > 0 ? 100 * (s_adjustPriceCalls - s_adjustPriceReverts) / s_adjustPriceCalls : 0;
        
        console.log("========================================");
        console.log("         FUZZING COVERAGE METRICS       ");
        console.log("========================================");
        console.log("Operation Success Rates:");
        console.log("  mintTo:             %s%%", mintToSuccessRatio);
        console.log("  repay:              %s%%", repaySuccessRatio);
        console.log("  addCollateral:      %s%%", addCollateralSuccessRatio);
        console.log("  withdrawCollateral: %s%%", withdrawCollateralSuccessRatio);
        console.log("  adjustPrice:        %s%%", adjustPriceSuccessRatio);
        console.log("");
        
        // Print basic statistics
        s_statsCollector.printStatistics("position.price");
        s_statsCollector.printStatistics("position.principal");
        s_statsCollector.printStatistics("position.collateral");
        s_statsCollector.printStatistics("position.interest");
        
        // Print derived metrics statistics
        s_statsCollector.printStatistics("position.collateralToPrincipalRatio");
        s_statsCollector.printStatistics("position.collateralUtilization");
        s_statsCollector.printStatistics("position.bufferAboveMin");
    }

    // External

    /// @dev Get positions
    function getPositions() external view returns (Position[] memory) {
        return s_positions;
    }
    
    /// @dev Get stats collector
    function getStatsCollector() external view returns (StatsCollector) {
        return s_statsCollector;
    }
}
