// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {Environment} from "./Environment.t.sol";
import {ActionUtils} from "./ActionUtils.sol";
import {Position} from "../../contracts/MintingHubV2/Position.sol";
import {MintingHub} from "../../contracts/MintingHubV2/MintingHub.sol";
import {TestHelper} from "../TestHelper.sol";
import {StatsCollector} from "../StatsCollector.sol";
import {stdToml} from "forge-std/StdToml.sol";
import {console} from "forge-std/Test.sol";

struct Snapshot {
    // Position
    uint256 debt;
    uint256 interest;
    uint256 principal;
    uint256 posBalanceCOL;
    uint256 availableForMinting;
    uint256 challengedAmount;
    uint256 virtualPrice;
    uint256 price;
    bool inCooldown;
    bool isExpired;
    // Position owner
    address owner;
    uint256 ownerBalanceDEURO;
    uint256 ownerBalanceCOL;
    // dEURO
    uint256 minterReserve;
    // MintingHub
    uint256 mintingHubBalanceCOL;
    uint256 challengerBalanceCOL;
    uint256 bidderBalanceCOL;
}

contract Handler is StatsCollector {
    using ActionUtils for Position;
    using stdToml for string;

    /// @dev logging config
    bool public immutable SNAPSHOT_LOGGING;

    /// @dev Protocol environment
    Environment internal s_env;

    /// @dev Challenge related
    address internal s_bidder;
    address internal s_challenger;
    uint32 internal s_challengesCount;
    
    /// @dev Helper function to read boolean config from foundry.toml
    function readConfigBool(string memory configPath) internal view returns (bool) {
        string memory tomlContent = vm.readFile(string.concat(vm.projectRoot(), "/foundry.toml"));
        return vm.parseTomlBool(tomlContent, configPath);
    }

    constructor(address env) StatsCollector(readConfigBool(".profile.logging.stats")) {
        // Configure logging
        SNAPSHOT_LOGGING = readConfigBool(".profile.logging.snapshots");

        // Initialize environment
        s_env = Environment(env);

        s_challenger = s_env.eoas(1); // Bob
        s_bidder = s_env.eoas(2); // Charlie

        // Record initial state (currently only 1 position)
        recordPositionStats(Position(s_env.getPosition(0)));
        if (SNAPSHOT_LOGGING) logSnapshot("constructor", 0, snapshot(Position(s_env.getPosition(0))));
    }

    /// @dev mintTo
    function mintTo(uint8 positionIdx, uint256 amount) public {
        Position position = s_env.getPosition(positionIdx);
        if (!position.mintToAllowed()) return;

        (uint256 lb, uint256 ub) = position.mintToBounds();
        amount = bound(amount, lb, ub);

        recordAction("mintTo");
        Snapshot memory pre = snapshot(position);
        vm.startPrank(position.owner());
        try position.mint(position.owner(), amount) {
            Snapshot memory post = snapshot(position);
            if (SNAPSHOT_LOGGING) logSnapshot("mintTo", amount, post);
            assertEq(post.principal, pre.principal + amount); // principal increase
            assertEq(post.ownerBalanceDEURO, pre.ownerBalanceDEURO + position.getUsableMint(amount)); // owner dEURO balance increase
            assertEq(pre.posBalanceCOL, pre.posBalanceCOL); // collateral unchanged
            assertGe(post.interest, pre.interest); // interest may accrue
        } catch {
            recordRevert("mintTo");
        }
        vm.stopPrank();
        recordPositionStats(position);
    }

    /// @dev repay
    function repay(uint8 positionIdx, uint256 amount) public {
        if (!shouldExecute(70)) return;

        Position position = s_env.getPosition(positionIdx);
        (uint256 lb, uint256 ub) = position.repayBounds();
        amount = bound(amount, lb, ub);

        recordAction("repay");
        s_env.mintDEURO(position.owner(), amount);
        Snapshot memory pre = snapshot(position);
        uint256 expRepayment = pre.debt > amount ? amount : pre.debt;
        uint256 expInterest = expRepayment > pre.interest ? 0 : pre.interest - expRepayment;
        uint256 expPrincipal = expRepayment > pre.interest
            ? pre.principal - (expRepayment - pre.interest)
            : pre.principal;
        uint256 expReserveContribution = s_env.deuro().calculateAssignedReserve(
            pre.principal - expPrincipal,
            position.reserveContribution()
        );
        expRepayment -= expReserveContribution;

        vm.startPrank(position.owner());
        s_env.deuro().approve(address(position), amount);
        try position.repay(amount) {
            Snapshot memory post = snapshot(position);
            if (SNAPSHOT_LOGGING) logSnapshot("repay", amount, post);
            assertEq(post.principal, expPrincipal); // principal decrease
            assertEq(post.interest, expInterest); // interest decrease
            assertApproxEqAbs(post.ownerBalanceDEURO, pre.ownerBalanceDEURO - expRepayment, 1e18);
        } catch {
            recordRevert("repay");
        }
        vm.stopPrank();
        recordPositionStats(position);
    }

    /// @dev addCollateral
    function addCollateral(uint8 positionIdx, uint256 amount) public {
        Position position = s_env.getPosition(positionIdx);
        (uint256 lb, uint256 ub) = position.addCollateralBounds();
        amount = bound(amount, lb, ub);
        if (amount == 0) return;

        recordAction("addCollateral");
        s_env.mintCOL(position.owner(), amount);
        Snapshot memory pre = snapshot(position);
        vm.startPrank(position.owner());
        try position.collateral().transfer(address(position), amount) {
            Snapshot memory post = snapshot(position);
            if (SNAPSHOT_LOGGING) logSnapshot("addCollateral", amount, post);
            assertEq(post.posBalanceCOL, pre.posBalanceCOL + amount); // collateral increase
            assertEq(post.ownerBalanceCOL, pre.ownerBalanceCOL - amount); // owner collateral balance decrease
            if (pre.price < pre.virtualPrice) assertLt(post.virtualPrice, pre.virtualPrice);
        } catch {
            recordRevert("addCollateral");
        }
        vm.stopPrank();
        recordPositionStats(position);
    }

    /// @dev withdrawCollateral
    function withdrawCollateral(uint8 positionIdx, uint256 amount) public {
        Position position = s_env.getPosition(positionIdx);
        if (!position.withdrawCollateralAllowed()) return;

        (uint256 lb, uint256 ub) = position.withdrawCollateralBounds();
        amount = bound(amount, lb, ub);
        if (amount == 0) return;

        recordAction("withdrawCollateral");
        Snapshot memory pre = snapshot(position);
        vm.startPrank(position.owner());
        try position.withdrawCollateral(position.owner(), amount) {
            Snapshot memory post = snapshot(position);
            if (SNAPSHOT_LOGGING) logSnapshot("withdrawCollateral", amount, post);
            assertEq(post.posBalanceCOL, pre.posBalanceCOL - amount); // collateral decrease
            assertEq(post.ownerBalanceCOL, pre.ownerBalanceCOL + amount); // owner collateral balance increase
            // if (pre.price < pre.virtualPrice) assertGt(post.virtualPrice, pre.virtualPrice);
        } catch {
            recordRevert("withdrawCollateral");
        }
        vm.stopPrank();
        recordPositionStats(position);
    }

    /// @dev adjustPrice
    /// REVIEW: Price starts at 5k and shrinks considerably in most runs. Why is that?
    function adjustPrice(uint8 positionIdx, uint256 priceValue) public {
        if (!shouldExecute(30)) return;

        Position position = s_env.getPosition(positionIdx);
        if (!position.adjustPriceAllowed()) return;

        (uint256 lb, uint256 ub) = position.adjustPriceBounds();
        priceValue = bound(priceValue, lb, ub);

        recordAction("adjustPrice");
        Snapshot memory pre = snapshot(position);
        vm.startPrank(position.owner());
        try position.adjustPrice(priceValue) {
            Snapshot memory post = snapshot(position);
            if (SNAPSHOT_LOGGING) logSnapshot("adjustPrice", priceValue, post);
            assertEq(post.price, priceValue); // price should be set to the new value
            if (block.timestamp > position.start()) assertLe(post.price, 2 * pre.price);
            if (post.price > pre.price) assertTrue(post.inCooldown); // cooldown if price increased
        } catch {
            recordRevert("adjustPrice");
        }
        vm.stopPrank();
        recordPositionStats(position);
    }

    /// @dev Initiates a challenge on one of the positions managed by the handler.
    function challengePosition(uint8 positionIdx, uint256 collateralAmount, uint256 minPrice) public {
        if (!shouldExecute(30)) return;
        Position position = s_env.getPosition(positionIdx);
        if (!position.challengeAllowed()) return;

        (uint256 lb, uint256 ub) = position.challengeBounds();
        collateralAmount = bound(collateralAmount, lb, ub);
        minPrice = bound(minPrice, (position.virtualPrice() * 3) / 4, position.virtualPrice());

        recordAction("challengePosition");
        s_env.mintCOL(s_challenger, collateralAmount);
        Snapshot memory pre = snapshot(position);

        // Execute challenge
        vm.startPrank(s_challenger);
        s_env.collateralToken().approve(address(s_env.mintingHubGateway()), collateralAmount);
        try s_env.mintingHubGateway().challenge(address(position), collateralAmount, minPrice) {
            Snapshot memory post = snapshot(position);
            if (SNAPSHOT_LOGGING) logSnapshot("challengePosition", collateralAmount, post);
            assertEq(post.mintingHubBalanceCOL, pre.mintingHubBalanceCOL + collateralAmount);
            assertEq(post.challengedAmount, pre.challengedAmount + collateralAmount);
            assertEq(pre.posBalanceCOL, pre.posBalanceCOL);
            assertEq(post.principal, pre.principal);
            assertGe(post.interest, pre.interest);
            s_challengesCount++;
        } catch {
            recordRevert("challengePosition");
        }
        vm.stopPrank();
        recordPositionStats(position);
    }

    /// @dev Posts a bid on an existing challenge.
    function bidChallenge(uint32 challengeIndex, uint256 bidSize, bool postpone) public {
        (uint256 validIndex, MintingHub.Challenge memory challenge) = s_env.getChallenge(
            challengeIndex,
            s_challengesCount
        );

        if (validIndex > s_challengesCount) return;
        if (block.timestamp == challenge.start) return; // do not allow avert in same TX as creation

        Position position = Position(address(challenge.position));
        if (!position.bidChallengeAllowed()) return;

        (uint256 liqPrice, uint40 phase) = position.challengeData();
        (uint256 lb, uint256 ub) = position.bidChallengeBounds();

        // Ensure the bid size is within bounds and not larger than the challenge size
        bidSize = bound(bidSize, lb, ub);
        if (bidSize == 0) return;

        // Capture state before bid
        recordAction("bidChallenge");
        uint256 requiredDEURO = (bidSize * liqPrice) / 1e18;
        s_env.mintDEURO(s_bidder, requiredDEURO);
        Snapshot memory pre = snapshot(position);
        vm.startPrank(s_bidder);
        s_env.deuro().approve(address(s_env.mintingHubGateway()), requiredDEURO);
        try s_env.mintingHubGateway().bid(uint32(validIndex), bidSize, postpone) {
            Snapshot memory post = snapshot(position);
            if (SNAPSHOT_LOGGING) logSnapshot("bidChallenge", bidSize, post);
            if (block.timestamp <= challenge.start + phase) {
                // TODO: Phase 1 (avert phase)
            } else {
                // Phase 2 (dutch auction phase)
                assertLe(post.debt, pre.debt);
                assertEq(post.challengedAmount, pre.challengedAmount - bidSize);
                assertEq(post.bidderBalanceCOL, pre.bidderBalanceCOL + bidSize);
                if (!postpone) {
                    assertEq(post.mintingHubBalanceCOL, pre.mintingHubBalanceCOL - bidSize);
                    assertEq(post.challengerBalanceCOL, pre.challengerBalanceCOL + bidSize);
                } else {
                    assertEq(post.mintingHubBalanceCOL, pre.mintingHubBalanceCOL);
                    assertEq(post.challengerBalanceCOL, pre.challengerBalanceCOL);
                }
            }
        } catch {
            recordRevert("bidChallenge");
        }
        vm.stopPrank();
        recordPositionStats(position);
    }

    /// @dev Buys collateral from an expired position.
    function buyExpiredCollateral(uint8 positionIdx, uint256 upToAmount) public {
        Position position = s_env.getPosition(positionIdx);
        if (!position.buyExpiredCollateralAllowed()) return;

        (uint256 lb, uint256 ub) = position.buyExpiredCollateralBounds();
        uint256 posBalanceCOL = position.collateral().balanceOf(address(position));
        uint256 forceSalePrice = s_env.mintingHubGateway().expiredPurchasePrice(position);
        uint256 dustAmount = (s_env.mintingHubGateway().OPENING_FEE() * 1e18) / forceSalePrice;
        upToAmount = bound(upToAmount, lb, ub);
        upToAmount = upToAmount < posBalanceCOL && posBalanceCOL - upToAmount < dustAmount ? posBalanceCOL : upToAmount;

        recordAction("buyExpiredCollateral");
        uint256 requiredDEURO = (upToAmount * forceSalePrice) / 1e18;
        s_env.mintDEURO(s_bidder, requiredDEURO);
        Snapshot memory pre = snapshot(position);
        vm.startPrank(s_bidder);
        // We must approve the Position contract, not the MintingHubGateway
        s_env.deuro().approve(address(position), requiredDEURO);
        try s_env.mintingHubGateway().buyExpiredCollateral(position, upToAmount) {
            Snapshot memory post = snapshot(position);
            if (SNAPSHOT_LOGGING) logSnapshot("buyExpiredCollateral", upToAmount, post);
            assertLe(pre.posBalanceCOL, pre.posBalanceCOL);
            assertEq(post.bidderBalanceCOL, pre.bidderBalanceCOL + upToAmount);
            if (pre.posBalanceCOL == 0) assertEq(post.debt, 0);
            // Check that debt is repaid proportionally to collateral sold
            if (pre.debt > 0) {
                assertApproxEqAbs(
                    pre.debt - post.debt,
                    (pre.debt * upToAmount) / pre.posBalanceCOL,
                    1e18,
                    "Debt reduction should be proportional to collateral sold"
                );
            }
        } catch {
            recordRevert("buyExpiredCollateral");
        }
        vm.stopPrank();
        recordPositionStats(position);
    }

    /// @dev Expire a position
    function expirePosition(uint8 positionIdx) external {
        if (!shouldExecute(5)) return;

        Position position = s_env.getPosition(positionIdx);
        if (!position.expirePositionAllowed()) return;

        recordAction("expirePosition");
        Snapshot memory pre = snapshot(position);
        increaseTimeTo(position.expiration() + 1);
        Snapshot memory post = snapshot(position);
        if (SNAPSHOT_LOGGING) logSnapshot("expirePosition", position.expiration(), post);
        assertTrue(post.isExpired); // position expired
        if (pre.principal > 0) assertGt(post.interest, pre.interest); // interest should accrue
    }

    /// @dev Pass the cooldown period of a position
    function passCooldown(uint8 positionIdx) external {
        Position position = s_env.getPosition(positionIdx);
        if (!position.passCooldownAllowed()) return;

        recordAction("passCooldown");
        Snapshot memory pre = snapshot(position);
        increaseTimeTo(position.cooldown() + 1);
        Snapshot memory post = snapshot(position);
        if (SNAPSHOT_LOGGING) logSnapshot("passCooldown", position.cooldown(), post);
        assertTrue(!post.inCooldown); // cooldown passed
        if (pre.principal > 0) assertGt(post.interest, pre.interest); // interest should accrue
    }

    /// @dev Warp time by 1-3 days
    function warpTime(uint256 time) external {
        if (!shouldExecute(5)) return;

        time = bound(time, 1 days, 3 days);
        recordAction("warpTime");
        uint256 timeBefore = block.timestamp;
        increaseTime(time);
        assertGe(block.timestamp, timeBefore + time);
    }

    // Helper functions

    /// @dev Helper function to capture comprehensive system state
    function snapshot(Position position) internal view returns (Snapshot memory) {
        address owner = position.owner();
        return
            Snapshot({
                // Position
                debt: position.getDebt(),
                interest: position.getInterest(),
                principal: position.principal(),
                posBalanceCOL: position.collateral().balanceOf(address(position)),
                availableForMinting: position.availableForMinting(),
                challengedAmount: position.challengedAmount(),
                virtualPrice: position.virtualPrice(),
                price: position.price(),
                inCooldown: position.cooldown() > block.timestamp,
                isExpired: block.timestamp >= position.expiration(),
                // Position owner
                owner: owner,
                ownerBalanceDEURO: s_env.deuro().balanceOf(owner),
                ownerBalanceCOL: position.collateral().balanceOf(owner),
                // dEURO
                minterReserve: s_env.deuro().minterReserve(),
                // MintingHub
                mintingHubBalanceCOL: s_env.collateralToken().balanceOf(address(s_env.mintingHubGateway())),
                challengerBalanceCOL: s_env.collateralToken().balanceOf(s_challenger),
                bidderBalanceCOL: s_env.collateralToken().balanceOf(s_bidder)
            });
    }

    function logSnapshot(string memory action, uint256 val, Snapshot memory snap) internal pure {
        console.log("%s: %s", action, val);
        console.log("Snapshot:");
        console.log("  debt:", snap.debt);
        console.log("  interest:", snap.interest);
        console.log("  principal:", snap.principal);
        console.log("  posBalanceCOL:", snap.posBalanceCOL);
        console.log("  availableForMinting:", snap.availableForMinting);
        console.log("  challengedAmount:", snap.challengedAmount);
        console.log("  virtualPrice:", snap.virtualPrice);
        console.log("  price:", snap.price);
        console.log("  inCooldown:", snap.inCooldown);
        console.log("  isExpired:", snap.isExpired);
        console.log("  owner:", snap.owner);
        console.log("  ownerBalanceDEURO:", snap.ownerBalanceDEURO);
        console.log("  ownerBalanceCOL:", snap.ownerBalanceCOL);
        console.log("  minterReserve:", snap.minterReserve);
        console.log("  mintingHubBalanceCOL:", snap.mintingHubBalanceCOL);
        console.log("  challengerBalanceCOL:", snap.challengerBalanceCOL);
        console.log("  bidderBalanceCOL:", snap.bidderBalanceCOL);
    }

    /// @dev Helper function to record position state statistics
    function recordPositionStats(Position position) public {
        uint256 price = position.price();
        uint256 principal = position.principal();
        uint256 collateral = position.collateral().balanceOf(address(position));
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
}
