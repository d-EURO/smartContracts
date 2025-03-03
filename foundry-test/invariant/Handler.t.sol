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
        
        // Initialize statistics
        s_statsCollector = new StatsCollector();
        s_statsCollector.initStatistics("position.price");
        s_statsCollector.initStatistics("position.principal");
        s_statsCollector.initStatistics("position.collateral");
        s_statsCollector.initStatistics("position.interest");
        s_statsCollector.initStatistics("position.collateralUtilization"); // principal / max_principal
    }

    /// @dev mintTo
    function mintTo(uint256 positionIdx, uint256 amount) public {
        // Get the position
        Position position = s_positions[positionIdx % s_positions.length];

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
        
        // Record position state
        recordPositionState(position);
    }

    /// @dev repay
    function repay(uint256 positionIdx, uint256 amount) public {
        // Skip with 70% chance
        if (skipActionWithOdds(70, positionIdx)) return;
        
        s_repayCalls++;

        // Get the position
        Position position = s_positions[positionIdx % s_positions.length];

        // Bound amount
        amount = bound(amount, 0, position.getDebt());

        vm.startPrank(position.owner());
        try position.repay(amount) {
            // success
        } catch {
            s_repayReverts++;
        }
        vm.stopPrank();
        
        // Record position state
        recordPositionState(position);
    }

    /// @dev addCollateral
    function addCollateral(uint256 positionIdx, uint256 amount) public {
        s_addCollateralCalls++;

        // Get the position
        Position position = s_positions[positionIdx % s_positions.length];

        // Bound amount
        amount = bound(amount, 0, s_collateralToken.balanceOf(position.owner()));

        vm.startPrank(position.owner());
        try s_collateralToken.transfer(address(position), amount) {
            // success
        } catch {
            s_addCollateralReverts++;
        }
        vm.stopPrank();
        
        // Record position state
        recordPositionState(position);
    }

    /// @dev withdrawCollateral
    function withdrawCollateral(uint256 positionIdx, uint256 amount) public {
        s_withdrawCollateralCalls++;

        // Get the position
        Position position = s_positions[positionIdx % s_positions.length];

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
        
        // Record position state
        recordPositionState(position);
    }

    /// @dev adjustPrice
    /// REVIEW: Price starts at 5k and shrinks considerably in most runs. Why is that?
    function adjustPrice(uint256 positionIdx, uint256 newPrice) public {
        // Get the position
        Position position = s_positions[positionIdx % s_positions.length];

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

        vm.startPrank(position.owner());
        try position.adjustPrice(newPrice) {
            // success
        } catch {
            s_adjustPriceReverts++;
        }
        vm.stopPrank();
        
        // Record position state
        recordPositionState(position);
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

    // External

    /// @dev Helper function to record position state statistics
    function recordPositionState(Position position) public {
        uint256 price = position.price();
        uint256 principal = position.principal();
        uint256 collateral = s_collateralToken.balanceOf(address(position));
        uint256 interest = position.getInterest();
        
        // Record statistics
        s_statsCollector.recordValue("position.price", price);
        s_statsCollector.recordValue("position.principal", principal);
        s_statsCollector.recordValue("position.collateral", collateral);
        s_statsCollector.recordValue("position.interest", interest);

        uint256 maxPossiblePrincipal = collateral == 0 ? 0 : (collateral * price) / 1e18;
        if (maxPossiblePrincipal > 0) {
            uint256 utilization = (principal * 100) / maxPossiblePrincipal; // 0-100%
            s_statsCollector.recordValue("position.collateralUtilization", utilization);
        }
    }
    
    /// @dev Print variable distribution statistics to evaluate fuzzing coverage
    function printVariableDistributions() external view {    
        uint256 mintToSuccessRatio = s_mintToCalls > 0 ? 100 * (s_mintToCalls - s_mintToReverts) / s_mintToCalls : 0;
        uint256 repaySuccessRatio = s_repayCalls > 0 ? 100 * (s_repayCalls - s_repayReverts) / s_repayCalls : 0;
        uint256 addCollateralSuccessRatio = s_addCollateralCalls > 0 ? 100 * (s_addCollateralCalls - s_addCollateralReverts) / s_addCollateralCalls : 0;
        uint256 withdrawCollateralSuccessRatio = s_withdrawCollateralCalls > 0 ? 100 * (s_withdrawCollateralCalls - s_withdrawCollateralReverts) / s_withdrawCollateralCalls : 0;
        uint256 adjustPriceSuccessRatio = s_adjustPriceCalls > 0 ? 100 * (s_adjustPriceCalls - s_adjustPriceReverts) / s_adjustPriceCalls : 0;
        uint256 challengPositionSuccessRatio = s_challengePositionCalls > 0 ? 100 * (s_challengePositionCalls - s_challengePositionReverts) / s_challengePositionCalls : 0;
        uint256 bidChallengeSuccessRatio = s_bidChallengeCalls > 0 ? 100 * (s_bidChallengeCalls - s_bidChallengeReverts) / s_bidChallengeCalls : 0;
        uint256 buyExpiredCollateralSuccessRatio = s_buyExpiredCollateralCalls > 0 ? 100 * (s_buyExpiredCollateralCalls - s_buyExpiredCollateralReverts) / s_buyExpiredCollateralCalls : 0;
        
        console.log("========================================");
        console.log("    FUZZING ACTIONS & SUCCESS RATES     ");
        console.log("========================================");
        console.log("  mintTo:                  %s (%s%%)", s_mintToCalls, mintToSuccessRatio);
        console.log("  repay:                   %s (%s%%)", s_repayCalls, repaySuccessRatio);
        console.log("  addCollateral:           %s (%s%%)", s_addCollateralCalls, addCollateralSuccessRatio);
        console.log("  withdrawCollateral:      %s (%s%%)", s_withdrawCollateralCalls, withdrawCollateralSuccessRatio);
        console.log("  adjustPrice:             %s (%s%%)", s_adjustPriceCalls, adjustPriceSuccessRatio);
        console.log("  challengePosition:       %s (%s%%)", s_challengePositionCalls, challengPositionSuccessRatio);
        console.log("  bidChallenge:            %s (%s%%)", s_bidChallengeCalls, bidChallengeSuccessRatio);
        console.log("  buyExpiredCollateral:    %s (%s%%)", s_buyExpiredCollateralCalls, buyExpiredCollateralSuccessRatio);
        console.log("  passCooldown:            %s", s_passCooldownCalls);
        console.log("  expirePosition:          %s", s_expirePositionCalls);
        console.log("  warpTime:                %s", s_warpTimeCalls);
        console.log("");
        
        // Print basic statistics
        console.log("========================================");
        console.log("         FUZZING COVERAGE METRICS       ");
        console.log("========================================");
        s_statsCollector.printStatistics("position.price", 18);
        s_statsCollector.printStatistics("position.principal", 18);
        s_statsCollector.printStatistics("position.collateral", 18);
        s_statsCollector.printStatistics("position.interest", 18);
        s_statsCollector.printStatistics("position.collateralUtilization", 0);
    }

    /// @dev Get positions
    function getPositions() external view returns (Position[] memory) {
        return s_positions;
    }
}
