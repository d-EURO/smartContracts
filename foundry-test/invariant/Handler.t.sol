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

/// @dev Comprehensive state data for a position and its owner
// TODO: Refactor into separate structs
struct SystemState {
    // Position state
    uint256 debt;
    uint256 interest;
    uint256 principal;
    uint256 collateral;
    uint256 price;
    bool isCooldown;
    bool isExpired;
    uint256 availableForMinting;
    uint256 challengedAmount;
    // Owner balances
    uint256 ownerdEuroBalance;
    uint256 ownerCollateralBalance;
    address owner;
    // dEURO balances // TODO: Add assertions for these
    uint256 dEuroBalance;
    uint256 minterReserve;
}

struct MintingHubState {
    uint256 collateral;
    uint256 challengerCollateral;
    uint256 bidderCollateral;
}

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

        // Capture state before
        SystemState memory beforeState = captureSystemState(position);

        // TODO: Pick from a pool of addresses to mint to
        vm.startPrank(position.owner());
        try position.mint(position.owner(), amount) {
            SystemState memory afterState = captureSystemState(position);

            assertEq(afterState.principal, beforeState.principal + amount); // principal increase
            assertEq(afterState.ownerdEuroBalance, beforeState.ownerdEuroBalance + position.getUsableMint(amount)); // owner dEURO balance increase
            assertEq(afterState.collateral, beforeState.collateral); // collateral unchanged
            assertGe(afterState.interest, beforeState.interest); // interest may accrue
        } catch {
            recordRevert("mintTo");
        }
        vm.stopPrank();

        // Record position state
        recordPositionState(position);
    }

    /// @dev repay
    function repay(uint256 positionIdx, uint256 amount) public {
        if (skipActionWithOdds(70, positionIdx)) return; // Skip with 70% chance

        recordAction("repay");

        // Get the position
        Position position = s_positions[positionIdx % s_positions.length];

        // Bound amount
        amount = bound(amount, 0, position.getDebt()); // TODO: Increase limit slightly for edge cases

        // TODO: Ensure user has enough dEURO for repayment

        // Capture state before
        SystemState memory beforeState = captureSystemState(position);
        uint256 interestRepaid = amount > beforeState.interest ? beforeState.interest : amount;
        uint256 remaining = amount - interestRepaid;
        uint256 principalRepaid = remaining > beforeState.principal ? beforeState.principal : remaining;
        principalRepaid -= s_deuro.calculateAssignedReserve(principalRepaid, position.reserveContribution());

        vm.startPrank(position.owner());
        try position.repay(amount) {
            SystemState memory afterState = captureSystemState(position);

            assertEq(beforeState.debt, afterState.debt + amount); // debt decrease
            assertApproxEqAbs(beforeState.ownerdEuroBalance - interestRepaid - principalRepaid, afterState.ownerdEuroBalance, 1e18); // owner dEURO balance decrease
            if (beforeState.interest >= amount) {
                assertEq(afterState.principal, beforeState.principal); // principal unchanged
                assertEq(afterState.interest, beforeState.interest - amount); // interest decrease
            } else {
                assertEq(afterState.interest, 0); // interest repaid
                assertEq(afterState.principal, beforeState.principal - (amount - beforeState.interest)); // principal decrease
            }
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

        // Capture state before
        SystemState memory beforeState = captureSystemState(position);

        vm.startPrank(position.owner());
        try s_collateralToken.transfer(address(position), amount) {
            SystemState memory afterState = captureSystemState(position);

            assertEq(afterState.collateral, beforeState.collateral + amount); // collateral increase
            assertEq(afterState.ownerCollateralBalance, beforeState.ownerCollateralBalance - amount); // owner collateral balance decrease
            assertEq(afterState.principal, beforeState.principal); // principal unchanged
            assertEq(afterState.price, beforeState.price); // price unchanged
            assertGe(afterState.interest, beforeState.interest); // interest may accrue
        } catch {
            recordRevert("addCollateral");
        }
        vm.stopPrank();

        // Record position state
        recordPositionState(position);
    }

    /// @dev withdrawCollateral
    function withdrawCollateral(uint256 positionIdx, uint256 amount) public {
        // Get the position
        Position position = s_positions[positionIdx % s_positions.length];

        // Check for conditions that would cause mint to fail and skip the iteration
        bool isChallenged = position.challengedAmount() > 0;
        bool isCooldown = position.cooldown() > block.timestamp;
        if (isChallenged || isCooldown) return;

        recordAction("withdrawCollateral");

        // Bound amount
        uint256 _requiredCollateral = requiredCollateral(position);
        uint256 collateralReserve = s_collateralToken.balanceOf(address(position));
        uint256 maxWithdraw = collateralReserve > _requiredCollateral ? collateralReserve - _requiredCollateral : 0;
        amount = bound(amount, 0, maxWithdraw);

        // Capture state before
        SystemState memory beforeState = captureSystemState(position);

        vm.startPrank(position.owner());
        try position.withdrawCollateral(position.owner(), amount) {
            SystemState memory afterState = captureSystemState(position);

            assertEq(beforeState.collateral, afterState.collateral + amount); // collateral decrease
            assertEq(afterState.ownerCollateralBalance, beforeState.ownerCollateralBalance + amount); // owner collateral balance increase
            assertEq(afterState.principal, beforeState.principal); // principal unchanged
            assertGe(afterState.interest, beforeState.interest); // interest may accrue
        } catch {
            recordRevert("withdrawCollateral");
        }
        vm.stopPrank();

        // Record position state
        recordPositionState(position);
    }

    /// @dev adjustPrice
    /// REVIEW: Price starts at 5k and shrinks considerably in most runs. Why is that?
    function adjustPrice(uint256 positionIdx, uint256 priceValue) public {
        // Get the position
        Position position = s_positions[positionIdx % s_positions.length];

        // Skip with 70% chance
        if (skipActionWithOdds(70, priceValue)) return;

        // Check for conditions that would cause adjustPrice to fail and skip the iteration
        bool isCooldown = position.cooldown() > block.timestamp;
        bool isChallenged = position.challengedAmount() > 0;
        bool isExpired = block.timestamp >= position.expiration();
        bool isClosed = position.isClosed();
        if (isCooldown || isChallenged || isExpired || isClosed) {
            return;
        }

        recordAction("adjustPrice");

        // Bound new price
        (uint256 minPrice, uint256 maxPrice) = priceRange(position);
        priceValue = bound(priceValue, minPrice, maxPrice);

        // Capture state before
        SystemState memory beforeState = captureSystemState(position);

        vm.startPrank(position.owner());
        try position.adjustPrice(priceValue) {
            SystemState memory afterState = captureSystemState(position);

            assertEq(afterState.price, priceValue); // price should be set to the new value
            assertEq(afterState.collateral, beforeState.collateral); // collateral unchanged
            assertEq(afterState.principal, beforeState.principal); // principal unchanged
            assertGe(afterState.price, minPrice);
            assertLe(afterState.price, maxPrice);
            if (block.timestamp > position.start()) assertLe(afterState.price, 2 * beforeState.price);
            if (afterState.price > beforeState.price) assertTrue(afterState.isCooldown); // cooldown if price increase
        } catch {
            recordRevert("adjustPrice");
        }
        vm.stopPrank();

        // Record position state
        recordPositionState(position);
    }

    /// @dev Initiates a challenge on one of the positions managed by the handler.
    function challengePosition(uint256 positionIdx, uint256 collateralAmount, uint256 minPrice) public {
        // Select a position from the positions array
        Position position = s_positions[positionIdx % s_positions.length];
        
        // Check for conditions that would cause challenge to fail
        bool isExpired = block.timestamp >= position.expiration();
        if (isExpired) return;

        recordAction("challengePosition");

        // Bound collateralAmount
        uint256 minimumCollateral = position.minimumCollateral();
        uint256 collateralReserve = s_collateralToken.balanceOf(address(position));
        uint256 minColAmount = min(minimumCollateral, collateralReserve);
        uint256 maxColAmount = (collateralReserve * 5) / 4; // 1.25 x collateralReserve
        collateralAmount = bound(collateralAmount, minColAmount, maxColAmount);

        // Bound minPrice
        uint256 currentVirtualPrice = position.virtualPrice();
        minPrice = bound(minPrice, 0, currentVirtualPrice);
        
        // Ensure challenger has enough dEURO for challenge
        uint256 requiredDEURO = s_mintingHubGateway.OPENING_FEE();
        if (s_deuro.balanceOf(s_challenger) < requiredDEURO) {
            s_deuro.mint(s_challenger, requiredDEURO); 
        }

        // Ensure challenger has enough collateral for challenge
        if (s_collateralToken.balanceOf(s_challenger) < collateralAmount) {
            s_collateralToken.mint(s_challenger, collateralAmount);
        }
        
        // Capture state before challenge
        SystemState memory beforeState = captureSystemState(position);
        MintingHubState memory minHubStateBefore = captureMinHubState();

        // Execute challenge
        vm.startPrank(s_challenger);
        s_deuro.approve(address(s_mintingHubGateway), requiredDEURO);
        s_collateralToken.approve(address(s_mintingHubGateway), collateralAmount);
        try s_mintingHubGateway.challenge(address(position), collateralAmount, minPrice) {
            SystemState memory afterState = captureSystemState(position);
            MintingHubState memory minHubStateAfter = captureMinHubState();
            
            assertEq(minHubStateAfter.collateral, minHubStateBefore.collateral + collateralAmount);
            assertGt(afterState.challengedAmount, beforeState.challengedAmount + collateralAmount);
            assertEq(afterState.collateral, beforeState.collateral);
            assertEq(afterState.principal, beforeState.principal);
            assertGe(afterState.interest, beforeState.interest);
            
            s_openedChallenges++;
        } catch {
            recordRevert("challengePosition");
        }
        vm.stopPrank();
        
        // Record position state after challenge
        recordPositionState(position);
    }

    /// @dev Posts a bid on an existing challenge.
    function bidChallenge(uint256 challengeIndex, uint256 bidSize, bool postpone) public {
        // Skip if no challenges exist
        if (s_openedChallenges == 0) {
            return;
        }

        // Find a valid challenge
        MintingHub.Challenge memory challenge;
        bool foundChallenge = false;
        uint32 validChallengeIndex = 0;
        
        for (uint256 i = 0; i < s_openedChallenges; i++) {
            uint32 idx = uint32((challengeIndex + i) % s_openedChallenges);
            (address challenger, uint40 start, IPosition pos, uint256 size) = s_mintingHubGateway.challenges(idx);
            if (pos != IPosition(address(0))) {
                challenge = MintingHub.Challenge(challenger, start, pos, size);
                validChallengeIndex = idx;
                foundChallenge = true;
                break;
            }
        }
        
        if (!foundChallenge) return;

        recordAction("bidChallenge");

        // Ensure position is valid
        Position position = Position(address(challenge.position));
        (uint256 liqPrice, uint40 phase) = position.challengeData();
        
        // // Skip if position is expired
        // if (block.timestamp >= position.expiration()) {
        //     recordRevert("bidChallenge");
        //     return;
        // }
        
        // Bound bidSize
        bidSize = bound(bidSize, 1, challenge.size);
        
        // Ensure bidder has enough dEURO - the bidder needs to pay for collateral
        uint256 requiredDEURO = (bidSize * liqPrice) / 1e18;
        if (s_deuro.balanceOf(s_bidder) < requiredDEURO) {
            s_deuro.mint(s_bidder, requiredDEURO); // Give bidder enough dEURO
        }
        
        // Capture state before bid
        SystemState memory beforeState = captureSystemState(position);
        MintingHubState memory minHubStateBefore = captureMinHubState();
        
        // Place bid
        vm.startPrank(s_bidder);
        s_deuro.approve(address(s_mintingHubGateway), type(uint256).max);
        try s_mintingHubGateway.bid(validChallengeIndex, bidSize, postpone) {
            SystemState memory afterState = captureSystemState(position);
            MintingHubState memory minHubStateAfter = captureMinHubState();

            if (block.timestamp <= challenge.start + phase) {
                // TODO: Phase 1 (avert phase) 
            } else {
                // Phase 2 (dutch auction phase)
                assertLe(afterState.debt, beforeState.debt);
                assertEq(afterState.challengedAmount, beforeState.challengedAmount -  bidSize);
                assertEq(minHubStateAfter.bidderCollateral, minHubStateBefore.bidderCollateral + bidSize);
                if (!postpone) {
                    assertEq(minHubStateAfter.collateral, minHubStateBefore.collateral - bidSize);
                    assertEq(minHubStateAfter.challengerCollateral, minHubStateBefore.challengerCollateral + bidSize);

                } else {
                    assertEq(minHubStateAfter.collateral, minHubStateBefore.collateral);
                    assertEq(minHubStateAfter.challengerCollateral, minHubStateBefore.challengerCollateral);
                }
            }
        } catch {
            recordRevert("bidChallenge");
        }
        vm.stopPrank();
        
        // Record position state
        recordPositionState(position);
    }

    /// @dev Buys collateral from an expired position.
    function buyExpiredCollateral(uint256 positionIdx, uint256 upToAmount) public {
        // Select a position from the positions array
        Position position = s_positions[positionIdx % s_positions.length];
        
        // Check position is actually expired
        bool isExpired = block.timestamp >= position.expiration();
        bool hasChallenge = position.challengedAmount() > 0;
        if (!isExpired || hasChallenge) return;

        recordAction("buyExpiredCollateral");
        
        // Bound upToAmount
        uint256 forceSalePrice = s_mintingHubGateway.expiredPurchasePrice(position);
        uint256 maxAmount = s_collateralToken.balanceOf(address(position));
        uint256 dustAmount = (s_mintingHubGateway.OPENING_FEE() * 1e18) / forceSalePrice;
        upToAmount = bound(upToAmount, 1, maxAmount); // Must be at least 1
        
        // Leave no dust behind
        if (upToAmount < maxAmount && maxAmount - upToAmount < dustAmount) {
            upToAmount = maxAmount - dustAmount;
        }
        
        // Ensure bidder has enough dEURO for purchase
        uint256 requiredDEURO = (upToAmount * forceSalePrice) / 1e18;
        if (s_deuro.balanceOf(s_bidder) < requiredDEURO) {
            s_deuro.mint(s_bidder, requiredDEURO * 2);
        }
        
        // Capture state before purchase
        SystemState memory beforeState = captureSystemState(position);
        MintingHubState memory minHubStateBefore = captureMinHubState();
        
        // Execute purchase
        vm.startPrank(s_bidder);
        s_deuro.approve(address(s_mintingHubGateway), type(uint256).max);
        try s_mintingHubGateway.buyExpiredCollateral(position, upToAmount) {
            SystemState memory afterState = captureSystemState(position);
            MintingHubState memory minHubStateAfter = captureMinHubState();
            
            assertLe(afterState.collateral, beforeState.collateral);
            assertEq(minHubStateAfter.bidderCollateral, minHubStateBefore.bidderCollateral + upToAmount);
            if (afterState.collateral == 0) assertEq(afterState.debt, 0);
            // Check that debt is repaid proportionally to collateral sold
            if (beforeState.debt > 0) {
                uint256 debtReduction = beforeState.debt - afterState.debt;
                uint256 expectedDebtReduction = (beforeState.debt * upToAmount) / beforeState.collateral;
                assertApproxEqAbs(debtReduction, expectedDebtReduction, 1e18, "Debt reduction should be proportional to collateral sold");
            }
        } catch {
            recordRevert("buyExpiredCollateral");
        }
        vm.stopPrank();
        
        // Record position state
        recordPositionState(position);
    }

    /// @dev Expire a position
    function expirePosition(uint256 positionIdx) external {
        Position position = s_positions[positionIdx % s_positions.length];

        // Skip with 99% chance
        if (skipActionWithOdds(99, positionIdx)) return;

        bool isExpired = block.timestamp >= position.expiration();
        if (isExpired) return;

        recordAction("expirePosition");

        // Capture state before
        SystemState memory beforeState = captureSystemState(position);

        // Advance time to expire the position
        uint40 expiration = position.expiration();
        increaseTime(expiration - block.timestamp);

        // Capture state after
        SystemState memory afterState = captureSystemState(position);

        assertTrue(afterState.isExpired); // position expired
        assertEq(afterState.principal, beforeState.principal); // principal unchanged
        assertEq(afterState.collateral, beforeState.collateral); // collateral unchanged
        if (beforeState.principal > 0) assertGt(afterState.interest, beforeState.interest); // interest should accrue
    }

    /// @dev Pass the cooldown period of a position
    function passCooldown(uint256 positionIdx) external {
        Position position = s_positions[positionIdx % s_positions.length];

        // Only proceed if there's actually a cooldown to pass
        if (position.cooldown() <= block.timestamp) return;

        recordAction("passCooldown");

        // Capture state before passing cooldown
        SystemState memory beforeState = captureSystemState(position);

        // Advance time past cooldown
        increaseTime(position.cooldown() - block.timestamp + 1);

        // Capture state after passing cooldown
        SystemState memory afterState = captureSystemState(position);

        assertTrue(!afterState.isCooldown); // cooldown passed
        assertEq(afterState.principal, beforeState.principal); // Principal unchanged
        assertEq(afterState.collateral, beforeState.collateral); // Collateral unchanged
        if (beforeState.principal > 0) assertGt(afterState.interest, beforeState.interest); // interest should accrue
    }

    /// @dev Warp time by 2 days
    function warpTime(uint256 daysToWarp) external {
        // Skip with 95% chance
        if (skipActionWithOdds(95, daysToWarp)) return;

        recordAction("warpTime");

        // Capture state before time warp
        uint256 initialTimestamp = block.timestamp;
        SystemState[] memory statesBefore = captureAllSystemStates();

        // Perform time warp
        increaseTime(2 days);

        // Time should have advanced
        assertEq(block.timestamp, initialTimestamp + 2 days);

        // Check each position's state after time warp
        for (uint256 i = 0; i < s_positions.length; i++) {
            Position position = s_positions[i];
            SystemState memory stateBefore = statesBefore[i];
            SystemState memory stateAfter = captureSystemState(position);

            assertEq(stateAfter.principal, stateBefore.principal); // principal unchanged
            assertEq(stateAfter.collateral, stateBefore.collateral); // collateral unchanged
            if (stateBefore.isExpired) assertTrue(stateAfter.isExpired);
            if (stateBefore.principal > 0) assertGt(stateAfter.interest, stateBefore.interest); // interest should accrue
        }
    }

    /// @dev Helper to capture state for all positions
    function captureAllSystemStates() internal view returns (SystemState[] memory) {
        SystemState[] memory states = new SystemState[](s_positions.length);
        for (uint256 i = 0; i < s_positions.length; i++) states[i] = captureSystemState(s_positions[i]);
        return states;
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
        uint256 collateralReserve = s_collateralToken.balanceOf(address(position));
        // uint256 minimumCollateral = position.minimumCollateral();
        // uint256 relevantCollateral = collateralReserve < minimumCollateral ? 0 : collateralReserve;
        uint256 minPrice = (debt * 1e18) / collateralReserve;
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

    /// @dev Helper function to capture comprehensive system state
    function captureSystemState(Position position) internal view returns (SystemState memory) {
        address owner = position.owner();
        return
            SystemState({
                // Position state
                debt: position.getDebt(),
                interest: position.getInterest(),
                principal: position.principal(),
                collateral: s_collateralToken.balanceOf(address(position)),
                price: position.price(),
                isCooldown: position.cooldown() > block.timestamp,
                isExpired: block.timestamp >= position.expiration(),
                availableForMinting: position.availableForMinting(),
                challengedAmount: position.challengedAmount(),
                // Owner balances
                ownerdEuroBalance: s_deuro.balanceOf(owner),
                ownerCollateralBalance: s_collateralToken.balanceOf(owner),
                owner: owner,
                // dEURO balances
                dEuroBalance: s_deuro.balanceOf(address(position)),
                minterReserve: s_deuro.minterReserve()
            });
    }

    function captureMinHubState() internal view returns (MintingHubState memory) {
        return
            MintingHubState({
                collateral: s_collateralToken.balanceOf(address(s_mintingHubGateway)),
                challengerCollateral: s_collateralToken.balanceOf(s_challenger),
                bidderCollateral: s_collateralToken.balanceOf(s_bidder)
            });
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
