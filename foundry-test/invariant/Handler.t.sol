// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {Environment} from "./Environment.t.sol";
import {ActionUtils} from "./ActionUtils.sol";
import {Position} from "../../contracts/MintingHubV3/Position.sol";
import {MintingHub} from "../../contracts/MintingHubV3/MintingHub.sol";
import {Savings} from "../../contracts/Savings.sol";
import {Equity} from "../../contracts/Equity.sol";
import {StablecoinBridge} from "../../contracts/StablecoinBridge.sol";
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

            // post conditions
            assertEq(post.principal, pre.principal + amount, "mintTo: incorrect principal");
            assertEq(
                post.ownerBalanceDEURO,
                pre.ownerBalanceDEURO + position.getUsableMint(amount),
                "mintTo: incorrect owner balance"
            );
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
        uint256 remaining = amount;
        uint256 expInterestRepayment = pre.interest > remaining ? remaining : pre.interest;
        remaining -= expInterestRepayment;
        uint256 expPrincipalRepayment = pre.principal > remaining ? remaining : pre.principal;
        // There may be discrepancies in the currentReserve commputed here and during the actual TX,
        // therefore we cannot rely on expReserveContribution for the post conditions.
        // uint256 expReserveContribution = s_env.deuro().calculateAssignedReserve(expPrincipalRepayment, position.reserveContribution());
        vm.startPrank(position.owner());
        s_env.deuro().approve(address(position), amount);
        try position.repay(amount) {
            Snapshot memory post = snapshot(position);
            if (SNAPSHOT_LOGGING) logSnapshot("repay", amount, post);

            // post conditions
            assertEq(pre.principal - post.principal, expPrincipalRepayment, "repay: incorrect principal");
            assertEq(pre.interest - post.interest, expInterestRepayment, "repay: incorrect interest");
            assertLe(
                pre.ownerBalanceDEURO - post.ownerBalanceDEURO,
                min(amount, pre.debt),
                "repay: used amount exceeds repay amount"
            );
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

            // post conditions
            assertEq(post.posBalanceCOL, pre.posBalanceCOL + amount, "addCollateral: incorrect collateral balance");
            assertEq(post.ownerBalanceCOL, pre.ownerBalanceCOL - amount, "addCollateral: incorrect owner balance");
            if (pre.price < pre.virtualPrice)
                assertLe(post.virtualPrice, pre.virtualPrice, "addCollateral: incorrect virtual price");
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

            // post conditions
            assertEq(
                post.posBalanceCOL,
                pre.posBalanceCOL - amount,
                "withdrawCollateral: incorrect collateral balance"
            );
            assertEq(post.ownerBalanceCOL, pre.ownerBalanceCOL + amount, "withdrawCollateral: incorrect owner balance");
            if (pre.price < pre.virtualPrice)
                assertGe(post.virtualPrice, pre.virtualPrice, "withdrawCollateral: incorrect virtual price");
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

            // post conditions
            assertEq(post.price, priceValue, "adjustPrice: incorrect price");
            if (block.timestamp > position.start()) assertLe(post.price, 2 * pre.price, "adjustPrice: price too high");
            if (post.price > pre.price) assertTrue(post.inCooldown, "adjustPrice: no cooldown after price increase");
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
        s_env.collateralToken().approve(address(s_env.mintingHub()), collateralAmount);
        try s_env.mintingHub().challenge(address(position), collateralAmount, minPrice) {
            Snapshot memory post = snapshot(position);
            if (SNAPSHOT_LOGGING) logSnapshot("challengePosition", collateralAmount, post);

            // Post conditions
            assertEq(
                post.mintingHubBalanceCOL,
                pre.mintingHubBalanceCOL + collateralAmount,
                "challengePosition: incorrect minting hub collateral balance"
            );
            assertEq(
                post.challengedAmount,
                pre.challengedAmount + collateralAmount,
                "challengePosition: incorrect challenged amount"
            );
            assertEq(post.posBalanceCOL, pre.posBalanceCOL, "challengePosition: position collateral balance changed");
            assertEq(post.principal, pre.principal, "challengePosition: principal changed");
            assertGe(post.interest, pre.interest, "challengePosition: interest decreased");
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

        Position position = Position(payable(address(challenge.position)));
        if (!position.bidChallengeAllowed()) return;

        (uint256 liqPrice, uint40 phase) = position.challengeData();

        // Skip if the Dutch auction has fully expired (price = 0).
        // Phase 1 (avert) lasts `phase` seconds, phase 2 (auction) another `phase` seconds.
        // After 2*phase the collateral is free, creating a 100% loss covered from reserves.
        // This is valid protocol behavior (loss absorption), but testing it masks real solvency issues.
        if (block.timestamp >= challenge.start + 2 * uint256(phase)) return;
        bidSize = bound(bidSize, 1, challenge.size);

        // Capture state before bid
        recordAction("bidChallenge");

        uint256 requiredDEURO = (bidSize * liqPrice) / 1e18;
        s_env.mintDEURO(s_bidder, requiredDEURO);
        Snapshot memory pre = snapshot(position);
        vm.startPrank(s_bidder);
        s_env.deuro().approve(address(s_env.mintingHub()), requiredDEURO);
        try s_env.mintingHub().bid(validIndex, bidSize, postpone) {
            Snapshot memory post = snapshot(position);
            if (SNAPSHOT_LOGGING) logSnapshot("bidChallenge", bidSize, post);

            // post conditions
            if (block.timestamp <= challenge.start + phase) {
                // TODO: Phase 1 (avert phase)
            } else {
                // Phase 2 (dutch auction phase)
                assertLe(post.debt, pre.debt, "bidChallenge: debt increased");
                assertLe(post.challengedAmount, pre.challengedAmount, "bidChallenge: challenged amount increased");
                assertEq(
                    bidSize,
                    pre.challengedAmount - post.challengedAmount,
                    "bidChallenge: incorrect challenged amount"
                );
                assertEq(
                    post.bidderBalanceCOL - pre.bidderBalanceCOL,
                    min(pre.posBalanceCOL, bidSize),
                    "bidChallenge: incorrect bidder collateral"
                );
                assertGe(pre.mintingHubBalanceCOL, bidSize, "bidChallenge: insufficient minting hub collateral");
                if (!postpone) {
                    assertEq(
                        post.mintingHubBalanceCOL,
                        pre.mintingHubBalanceCOL - bidSize,
                        "bidChallenge: incorrect minting hub collateral"
                    );
                    assertEq(
                        post.challengerBalanceCOL,
                        pre.challengerBalanceCOL + bidSize,
                        "bidChallenge: incorrect challenger collateral"
                    );
                } else {
                    assertEq(
                        post.mintingHubBalanceCOL,
                        pre.mintingHubBalanceCOL,
                        "bidChallenge: minting hub collateral changed"
                    );
                    assertEq(
                        post.challengerBalanceCOL,
                        pre.challengerBalanceCOL,
                        "bidChallenge: challenger collateral changed"
                    );
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
        uint256 forceSalePrice = s_env.mintingHub().expiredPurchasePrice(position);
        uint256 dustAmount = forceSalePrice > 0 ? (s_env.mintingHub().OPENING_FEE() * 1e18) / forceSalePrice : 0; // TODO: 0 division case handled correctly?
        upToAmount = bound(upToAmount, lb, ub);
        upToAmount = upToAmount < posBalanceCOL && posBalanceCOL - upToAmount < dustAmount ? posBalanceCOL : upToAmount;

        recordAction("buyExpiredCollateral");
        uint256 requiredDEURO = (upToAmount * forceSalePrice) / 1e18;
        s_env.mintDEURO(s_bidder, requiredDEURO);
        Snapshot memory pre = snapshot(position);
        vm.startPrank(s_bidder);
        // We must approve the Position contract, not the MintingHub
        s_env.deuro().approve(address(position), requiredDEURO);
        try s_env.mintingHub().buyExpiredCollateral(position, upToAmount) {
            Snapshot memory post = snapshot(position);
            if (SNAPSHOT_LOGGING) logSnapshot("buyExpiredCollateral", upToAmount, post);

            // Post conditions
            assertLe(post.posBalanceCOL, pre.posBalanceCOL, "buyExpiredCollateral: position collateral increased");
            assertEq(
                post.bidderBalanceCOL,
                pre.bidderBalanceCOL + upToAmount,
                "buyExpiredCollateral: incorrect bidder collateral"
            );
            if (pre.posBalanceCOL == 0)
                assertEq(post.debt, 0, "buyExpiredCollateral: non-zero debt with zero collateral");
            // TODO: Check that debt is repaid correctly
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

        // Post conditions
        assertTrue(post.isExpired, "expirePosition: position not expired");
        if (pre.principal > 1e16) assertGt(post.interest, pre.interest, "expirePosition: interest did not accrue");
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

        // Post conditions
        assertFalse(post.inCooldown, "passCooldown: position still in cooldown");
        if (pre.principal > 1e16) assertGt(post.interest, pre.interest, "passCooldown: interest did not accrue");
    }

    /// @dev Warp time by 1-14 days
    function warpTime(uint40 time) external {
        if (!shouldExecute(5)) return;

        time = uint40(bound(time, 1 days, 14 days));
        recordAction("warpTime");
        uint40 timeBefore = uint40(block.timestamp);
        increaseTime(time);

        // Post conditions
        assertGe(block.timestamp, timeBefore + time, "warpTime: time did not increase correctly");
    }

    // ==================== Savings Actions ====================

    /// @dev Save dEURO into Savings
    function saveDEURO(uint8 eoaIdx, uint192 amount, bool compound) public {
        if (!shouldExecute(20)) return;

        address actor = s_env.eoas(eoaIdx);
        amount = uint192(bound(amount, 1e18, 500_000e18));

        recordAction("saveDEURO");
        s_env.mintDEURO(actor, amount);
        Savings sav = s_env.savings();
        (uint192 preSaved,) = sav.savings(actor);

        vm.startPrank(actor);
        s_env.deuro().approve(address(sav), amount);
        try sav.save(amount, compound) {
            (uint192 postSaved,) = sav.savings(actor);
            assertGe(postSaved, preSaved + amount, "saveDEURO: saved did not increase correctly");
        } catch {
            recordRevert("saveDEURO");
        }
        vm.stopPrank();
    }

    /// @dev Withdraw dEURO from Savings
    function withdrawSavings(uint8 eoaIdx, uint192 amount) public {
        if (!shouldExecute(15)) return;

        address actor = s_env.eoas(eoaIdx);
        Savings sav = s_env.savings();
        (uint192 saved,) = sav.savings(actor);
        if (saved == 0) return;

        amount = uint192(bound(amount, 1, saved));

        recordAction("withdrawSavings");
        uint256 preBalance = s_env.deuro().balanceOf(actor);

        vm.startPrank(actor);
        try sav.withdraw(actor, amount) {
            uint256 postBalance = s_env.deuro().balanceOf(actor);
            assertGt(postBalance, preBalance, "withdrawSavings: dEURO balance did not increase");
        } catch {
            recordRevert("withdrawSavings");
        }
        vm.stopPrank();
    }

    /// @dev Claim accrued savings interest
    function claimSavingsInterest(uint8 eoaIdx) public {
        if (!shouldExecute(10)) return;

        address actor = s_env.eoas(eoaIdx);
        Savings sav = s_env.savings();

        recordAction("claimSavingsInterest");

        vm.startPrank(actor);
        try sav.claimInterest(actor) {
            assertEq(sav.claimableInterest(actor), 0, "claimSavingsInterest: claimable not zeroed");
        } catch {
            recordRevert("claimSavingsInterest");
        }
        vm.stopPrank();
    }

    /// @dev Refresh savings balance to trigger interest compounding
    function refreshSavings(uint8 eoaIdx) public {
        if (!shouldExecute(10)) return;

        address actor = s_env.eoas(eoaIdx);
        Savings sav = s_env.savings();
        (uint192 saved,) = sav.savings(actor);
        if (saved == 0) return;

        recordAction("refreshSavings");
        (, uint64 preTicks) = sav.savings(actor);

        vm.startPrank(actor);
        try sav.refreshBalance(actor) {
            (, uint64 postTicks) = sav.savings(actor);
            assertGe(postTicks, preTicks, "refreshSavings: ticks did not advance");
        } catch {
            recordRevert("refreshSavings");
        }
        vm.stopPrank();
    }

    // ==================== Equity Actions ====================

    /// @dev Invest dEURO into Equity (buy nDEPS)
    function investEquity(uint8 eoaIdx, uint256 amount) public {
        if (!shouldExecute(10)) return;

        address actor = s_env.eoas(eoaIdx);
        Equity eq = s_env.equity();
        amount = bound(amount, 1000e18, 100_000e18);

        recordAction("investEquity");
        s_env.mintDEURO(actor, amount);
        uint256 preShares = eq.balanceOf(actor);

        vm.startPrank(actor);
        s_env.deuro().approve(address(eq), amount);
        try eq.invest(amount, 0) {
            uint256 postShares = eq.balanceOf(actor);
            assertGt(postShares, preShares, "investEquity: nDEPS balance did not increase");
        } catch {
            recordRevert("investEquity");
        }
        vm.stopPrank();
    }

    /// @dev Redeem nDEPS for dEURO
    function redeemEquity(uint8 eoaIdx, uint256 shares) public {
        if (!shouldExecute(5)) return;

        address actor = s_env.eoas(eoaIdx);
        Equity eq = s_env.equity();
        if (!eq.canRedeem(actor)) return;

        uint256 balance = eq.balanceOf(actor);
        if (balance == 0) return;

        // Redeem conservatively: 1% to 50% of balance
        shares = bound(shares, 1, balance / 2 + 1);

        recordAction("redeemEquity");
        uint256 preBalance = s_env.deuro().balanceOf(actor);

        vm.startPrank(actor);
        try eq.redeem(actor, shares) {
            uint256 postBalance = s_env.deuro().balanceOf(actor);
            assertGt(postBalance, preBalance, "redeemEquity: dEURO balance did not increase");
        } catch {
            recordRevert("redeemEquity");
        }
        vm.stopPrank();
    }

    // ==================== StablecoinBridge Actions ====================

    /// @dev Mint dEURO via StablecoinBridge (deposit EUR)
    function bridgeMint(uint8 eoaIdx, uint256 amount) public {
        if (!shouldExecute(10)) return;

        StablecoinBridge br = s_env.bridge();
        if (br.stopped()) return;
        if (block.timestamp > br.horizon()) return;

        uint256 remaining = br.limit() - br.minted();
        if (remaining == 0) return;

        address actor = s_env.eoas(eoaIdx);
        amount = bound(amount, 1e18, remaining > 100_000e18 ? 100_000e18 : remaining);

        recordAction("bridgeMint");
        s_env.mintEUR(actor, amount);
        uint256 preDeuro = s_env.deuro().balanceOf(actor);
        uint256 preMinted = br.minted();

        vm.startPrank(actor);
        s_env.eurToken().approve(address(br), amount);
        try br.mint(amount) {
            uint256 postDeuro = s_env.deuro().balanceOf(actor);
            uint256 postMinted = br.minted();
            assertEq(postDeuro, preDeuro + amount, "bridgeMint: incorrect dEURO balance");
            assertEq(postMinted, preMinted + amount, "bridgeMint: incorrect minted tracking");
        } catch {
            recordRevert("bridgeMint");
        }
        vm.stopPrank();
    }

    /// @dev Burn dEURO via StablecoinBridge (withdraw EUR)
    function bridgeBurn(uint8 eoaIdx, uint256 amount) public {
        if (!shouldExecute(10)) return;

        StablecoinBridge br = s_env.bridge();
        uint256 minted = br.minted();
        if (minted < 1e18) return;

        address actor = s_env.eoas(eoaIdx);
        amount = bound(amount, 1e18, minted > 100_000e18 ? 100_000e18 : minted);

        recordAction("bridgeBurn");
        s_env.mintDEURO(actor, amount);
        uint256 preEur = s_env.eurToken().balanceOf(actor);

        vm.startPrank(actor);
        s_env.deuro().approve(address(br), amount);
        try br.burn(amount) {
            uint256 postEur = s_env.eurToken().balanceOf(actor);
            assertGt(postEur, preEur, "bridgeBurn: EUR balance did not increase");
        } catch {
            recordRevert("bridgeBurn");
        }
        vm.stopPrank();
    }

    // ==================== Multi-position Actions ====================

    /// @dev Clone an existing position
    function clonePosition(uint8 eoaIdx, uint8 parentIdx, uint256 collateral, uint256 mintAmount) public {
        if (!shouldExecute(5)) return;

        Position parent = s_env.getPosition(parentIdx);
        if (!parent.cloneAllowed()) return;
        if (block.timestamp < parent.start()) return;

        address actor = s_env.eoas(eoaIdx);
        uint256 minCol = parent.minimumCollateral();
        collateral = bound(collateral, minCol, minCol * 10);

        // Conservative mint: 0 to 50% of collateral value
        uint256 maxMint = (collateral * parent.price()) / (2 * 1e18);
        mintAmount = bound(mintAmount, 0, maxMint);

        recordAction("clonePosition");
        uint256 openingFee = s_env.mintingHub().OPENING_FEE();
        s_env.mintDEURO(actor, openingFee);
        s_env.mintCOL(actor, collateral);
        uint256 preCount = s_env.positionCount();

        // Expiration: at least 30 days from now, at most parent expiration
        uint40 expiration = parent.expiration();
        uint40 minExpiration = uint40(block.timestamp + 30 days);
        if (expiration < minExpiration) return; // not enough time left

        vm.startPrank(actor);
        s_env.deuro().approve(address(s_env.mintingHub()), openingFee);
        s_env.collateralToken().approve(address(s_env.mintingHub()), collateral);
        try s_env.mintingHub().clone(actor, address(parent), collateral, mintAmount, expiration, parent.price()) returns (address newPos) {
            s_env.addPosition(Position(payable(newPos)));
            uint256 postCount = s_env.positionCount();
            assertEq(postCount, preCount + 1, "clonePosition: position count did not increase");
            assertEq(Position(payable(newPos)).owner(), actor, "clonePosition: incorrect owner");
        } catch {
            recordRevert("clonePosition");
        }
        vm.stopPrank();
    }

    // ==================== Governance Actions ====================

    /// @dev Propose a leadrate change on both MintingHub and Savings.
    ///      Only proposes when no change is pending (avoids resetting the 7-day timer).
    function proposeLeadrateChange(uint24 newRate) public {
        MintingHub hub = s_env.mintingHub();
        Savings sav = s_env.savings();

        // Only propose if no pending change (avoid overwriting and resetting the 7-day timer)
        if (hub.currentRatePPM() != hub.nextRatePPM()) return;

        newRate = uint24(bound(newRate, 0, 100_000)); // 0-10%
        if (newRate == hub.currentRatePPM()) return; // no-op proposal

        address proposer = s_env.deployer();
        address[] memory helpers = new address[](0);

        recordAction("proposeLeadrateChange");
        vm.startPrank(proposer);
        try hub.proposeChange(newRate, helpers) {} catch {
            recordRevert("proposeLeadrateChange");
        }
        vm.stopPrank();

        vm.startPrank(proposer);
        try sav.proposeChange(newRate, helpers) {} catch {
            recordRevert("proposeLeadrateChange");
        }
        vm.stopPrank();
    }

    /// @dev Apply pending leadrate changes on MintingHub and/or Savings.
    ///      Warps time past the 7-day delay if needed (same pattern as expirePosition/passCooldown).
    function applyLeadrateChange() public {
        MintingHub hub = s_env.mintingHub();
        Savings sav = s_env.savings();

        bool hubPending = hub.currentRatePPM() != hub.nextRatePPM();
        if (!hubPending) return; // nothing to apply

        recordAction("applyLeadrateChange");

        // Warp past the 7-day proposal delay
        if (block.timestamp < hub.nextChange()) {
            increaseTimeTo(hub.nextChange());
        }

        try hub.applyChange() {} catch {
            recordRevert("applyLeadrateChange");
        }

        // Savings has the same nextChange since both are proposed together
        if (sav.currentRatePPM() != sav.nextRatePPM()) {
            try sav.applyChange() {} catch {
                recordRevert("applyLeadrateChange");
            }
        }
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
                mintingHubBalanceCOL: s_env.collateralToken().balanceOf(address(s_env.mintingHub())),
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
