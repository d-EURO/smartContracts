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
import {StatsCollector} from "../StatsCollector.sol";

contract Handler is StatsCollector {
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

    /// @dev Opened challenges
    uint256 internal s_openedChallenges;

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

        recordAction("mintTo");

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
            recordRevert("mintTo");
        }
        vm.stopPrank();

        // Record position state
        recordPositionState(position);
    }

    /// @dev repay
    function repay(uint256 positionIdx, uint256 amount) public {
        // Skip with 70% chance
        if (skipActionWithOdds(70, positionIdx)) return;

        recordAction("repay");

        // Get the position
        Position position = s_positions[positionIdx % s_positions.length];

        // Bound amount
        amount = bound(amount, 0, position.getDebt());

        vm.startPrank(position.owner());
        try position.repay(amount) {
            // success
        } catch {
            recordRevert("repay");
        }
        vm.stopPrank();

        // Record position state
        recordPositionState(position);
    }

    /// @dev addCollateral
    function addCollateral(uint256 positionIdx, uint256 amount) public {
        recordAction("addCollateral");

        // Get the position
        Position position = s_positions[positionIdx % s_positions.length];

        // Bound amount
        amount = bound(amount, 0, s_collateralToken.balanceOf(position.owner()));

        vm.startPrank(position.owner());
        try s_collateralToken.transfer(address(position), amount) {
            // success
        } catch {
            recordRevert("addCollateral");
        }
        vm.stopPrank();

        // Record position state
        recordPositionState(position);
    }

    /// @dev withdrawCollateral
    function withdrawCollateral(uint256 positionIdx, uint256 amount) public {
        recordAction("withdrawCollateral");

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
            recordRevert("withdrawCollateral");
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
        if (skipActionWithOdds(70, newPrice)) return;

        // Check for conditions that would cause adjustPrice to fail and skip the iteration
        bool isCooldown = position.cooldown() > block.timestamp;
        bool isChallenged = position.challengedAmount() > 0;
        bool isExpired = block.timestamp >= position.expiration();
        bool isClosed = position.isClosed();
        if (isCooldown || isChallenged || isExpired || isClosed) {
            return;
        }

        recordAction("adjustPrice");

        // Bound newPrice
        (uint256 minPrice, uint256 maxPrice) = priceRange(position);
        newPrice = bound(newPrice, minPrice, maxPrice);

        vm.startPrank(position.owner());
        try position.adjustPrice(newPrice) {
            // success
        } catch {
            recordRevert("adjustPrice");
        }
        vm.stopPrank();

        // Record position state
        recordPositionState(position);
    }

    // In your Handler contract

    /// @dev Initiates a challenge on one of the positions managed by the handler.
    function challengePosition(uint256 positionIdx, uint256 collateralAmount, uint256 minPrice) public {
        recordAction("challengePosition");

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
            recordRevert("challengePosition");
        }
    }

    /// @dev Posts a bid on an existing challenge.
    function bidChallenge(uint256 challengeIndex, uint256 bidSize, bool postpone) public {
        recordAction("bidChallenge");

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
            recordRevert("bidChallenge");
        }
    }

    /// @dev Buys collateral from an expired position.
    function buyExpiredCollateral(uint256 positionIdx, uint256 upToAmount) public {
        recordAction("buyExpiredCollateral");

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
            recordRevert("buyExpiredCollateral");
        }
    }

    /// @dev Expire a position
    function expirePosition(uint256 positionIdx) external {
        Position position = s_positions[positionIdx % s_positions.length];

        // Skip with 99% chance
        if (skipActionWithOdds(99, positionIdx)) return;

        bool isExpired = block.timestamp >= position.expiration();
        if (isExpired) return;

        recordAction("expirePosition");

        uint40 expiration = position.expiration();
        increaseTime(expiration - block.timestamp);
    }

    /// @dev Pass the cooldown period of a position
    function passCooldown(uint256 positionIdx) external {
        Position position = s_positions[positionIdx % s_positions.length];

        // Only proceed if there's actually a cooldown to pass
        if (position.cooldown() <= block.timestamp) return;

        recordAction("passCooldown");

        uint40 cooldown = position.cooldown();
        uint256 timeToAdvance = cooldown - block.timestamp + 1; // Add 1 second to ensure we're past cooldown
        increaseTime(timeToAdvance);
    }

    /// @dev Warp time by 2 days
    function warpTime(uint256 daysToWarp) external {
        // Skip with 95% chance
        if (skipActionWithOdds(95, daysToWarp)) return;

        recordAction("warpTime");

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

    /// @dev Helper function to record position state statistics
    function recordPositionState(Position position) public {
        uint256 price = position.price();
        uint256 principal = position.principal();
        uint256 collateral = s_collateralToken.balanceOf(address(position));
        uint256 interest = position.getInterest();

        // Record statistics
        recordValue("position.price", price);
        recordValue("position.principal", principal);
        recordValue("position.collateral", collateral);
        recordValue("position.interest", interest);

        uint256 maxPossiblePrincipal = collateral == 0 ? 0 : (collateral * price) / 1e18;
        if (maxPossiblePrincipal > 0) {
            uint256 utilization = (principal * 100) / maxPossiblePrincipal; // 0-100%
            recordValue("collateralUtilization", utilization);
        }
    }

    /// @dev Get positions
    function getPositions() external view returns (Position[] memory) {
        return s_positions;
    }
}
