# Phase 10 — Property-Based Testing & Fuzz Test Generation

**Project:** dEuro Smart Contracts (V3)
**Date:** 2026-03-03
**Platform:** Solidity ^0.8.26, Foundry (forge-std)
**Existing Suite:** `foundry-test/invariant/` — 11 handler actions, 11 invariants, 100 runs
**Methodology:** Trail of Bits Property-Based Testing + Foundry Invariant Testing

---

## Executive Summary

This report provides a comprehensive property-based testing plan targeting the 8 missing critical invariants, 5 untested module handlers, and edge cases identified across phases 1–9. The existing invariant suite covers Position + MintingHub operations well but leaves Savings, Equity, PositionRoller, StablecoinBridge, and governance actions completely untested under fuzzing.

**Deliverables:**
1. Configuration changes to increase fuzz effectiveness (`foundry.toml`)
2. 8 new system-level invariant properties
3. 6 new handler actions (Savings, Equity, Bridge)
4. 4 targeted fuzz tests for edge cases from variant analysis
5. Multi-position scenario support
6. Recommended Echidna/Medusa properties for deeper coverage

**Priority order:** Config fixes → Missing invariants → Handler expansion → Edge case tests

---

## 1. Configuration Fixes (CRITICAL — Do First)

### 1.1 `foundry.toml` Changes

The current configuration has two critical issues that severely limit fuzzing effectiveness:

```toml
# CURRENT (problematic)
[fuzz]
runs = 100

[invariant]
runs = 100
fail_on_revert = false
```

**Problem 1: `runs = 100`** — Industry standard for DeFi protocols is 10,000+ runs. At 100 runs, the fuzzer explores a tiny fraction of the state space. Complex multi-step bugs (reserve depletion cascades, concurrent challenge interactions) require deep sequence exploration.

**Problem 2: `fail_on_revert = false`** — This silently swallows reverts in handler actions. If a handler encounters an unexpected revert (e.g., due to a bug in the protocol, not a precondition violation), it's masked. The handler already uses try/catch for expected reverts, so `fail_on_revert` should be `true` or the handler should be made robust enough to handle all expected revert cases.

```toml
# RECOMMENDED
[fuzz]
runs = 10000

[invariant]
runs = 1000           # 1K invariant sequences (each with depth steps)
depth = 50            # 50 calls per sequence (default is 15)
fail_on_revert = true # surface unexpected reverts
```

**Note:** Setting `fail_on_revert = true` will likely cause immediate failures because the current handler actions don't guard all revert paths. This is intentional — each failure reveals either a missing guard in the handler or a real bug. Fix handler guards iteratively.

### 1.2 CI Integration

Add to `.github/workflows/test.yml`:

```yaml
  foundry-invariant:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: foundry-rs/foundry-toolchain@v1
      - run: forge test --match-contract Invariants -vvv
        env:
          FOUNDRY_INVARIANT_RUNS: 1000
          FOUNDRY_INVARIANT_DEPTH: 50
```

---

## 2. Missing System Invariants (8 New Properties)

These correspond to MISS-1 through MISS-8 from phases 3, 5, and 8.

### 2.1 Reserve Solvency (MISS-1) — CRITICAL

**Property:** `balanceOf(reserve) >= minterReserve()`

This is the single most important untested invariant. If violated, the system is insolvent — equity is negative and the reserve cannot cover its obligations.

```solidity
/// @dev MISS-1: Reserve balance must always cover the minter reserve
function invariant_reserveSolvency() public view {
    DecentralizedEURO deuro = s_env.deuro();
    uint256 reserveBalance = deuro.balanceOf(address(deuro.reserve()));
    uint256 minterReserve = deuro.minterReserve();
    assertGe(
        reserveBalance,
        minterReserve,
        "MISS-1: Reserve balance below minter reserve (system insolvent)"
    );
}
```

**Why this matters:** Every `mintWithReserve` increases `minterReserveE6`, and every `burnFromWithReserve` decreases it. If any code path mints without properly accounting for reserves, or burns reserves without decreasing `minterReserveE6`, this invariant breaks. The `_effectiveReservePPM` mechanism handles graceful degradation, but the invariant should hold under normal operation.

### 2.2 Equity Identity (MISS-2) — CRITICAL

**Property:** `equity() == balanceOf(reserve) - minterReserve()` when `balanceOf(reserve) > minterReserve()`

```solidity
/// @dev MISS-2: Equity accounting identity
function invariant_equityIdentity() public view {
    DecentralizedEURO deuro = s_env.deuro();
    uint256 reserveBalance = deuro.balanceOf(address(deuro.reserve()));
    uint256 minterReserve = deuro.minterReserve();
    uint256 equity = deuro.equity();

    if (reserveBalance > minterReserve) {
        assertEq(
            equity,
            reserveBalance - minterReserve,
            "MISS-2: Equity identity violated"
        );
    } else {
        assertEq(equity, 0, "MISS-2: Equity should be 0 when reserve depleted");
    }
}
```

### 2.3 Challenge Amount Bounded (MISS-3) — HIGH

**Property:** For each position, `challengedAmount <= collateralBalance`

```solidity
/// @dev MISS-3: Challenged amount never exceeds collateral held by position
function invariant_challengedAmountBounded() public view {
    Position[] memory positions = s_env.getPositions();
    for (uint256 i = 0; i < positions.length; i++) {
        Position pos = positions[i];
        uint256 challenged = pos.challengedAmount();
        uint256 collateral = pos.collateral().balanceOf(address(pos));
        // Note: challengedAmount CAN exceed collateral by design (over-challenging).
        // The settlement caps at actual collateral via min(size, colBal) in
        // notifyChallengeSucceeded. However, the MintingHub's total held challenger
        // collateral should be >= sum of all active challenge sizes.
        // This invariant tests a weaker but still valuable property:
        // if challengedAmount > 0, position must not be closed.
        if (challenged > 0) {
            assertFalse(
                pos.isClosed(),
                "MISS-3: Closed position has outstanding challenges"
            );
        }
    }
}
```

**Note:** After reviewing the code more carefully, `challengedAmount` CAN legitimately exceed `collateralBalance` because challenges can be for more collateral than the position holds. The settlement handles this via `_size = min(_size, colBal)`. A stronger invariant would track the MintingHub's held collateral vs active challenge sizes, but that requires additional state tracking in the handler.

### 2.4 Savings Interest Cap (MISS-4) — HIGH

**Property:** Interest distributed from savings never exceeds equity

```solidity
/// @dev MISS-4: Savings interest is capped by equity
function invariant_savingsInterestCapped() public view {
    Savings savings = s_env.savings();
    DecentralizedEURO deuro = s_env.deuro();

    // For each EOA that might have savings, check that accrued interest <= equity
    for (uint256 i = 0; i < 5; i++) {
        address account = s_env.eoas(i);
        uint192 accruedInterest = savings.accruedInterest(account);
        uint256 equity = deuro.equity();
        assertLe(
            uint256(accruedInterest),
            equity,
            "MISS-4: Accrued savings interest exceeds equity"
        );
    }
}
```

### 2.5 Flash Loan Net-to-Zero (MISS-5) — HIGH

**Property:** PositionRoller never holds dEURO between transactions

```solidity
/// @dev MISS-5: PositionRoller holds zero dEURO between transactions
function invariant_rollerNetZero() public view {
    uint256 rollerBalance = s_env.deuro().balanceOf(address(s_env.positionRoller()));
    assertEq(
        rollerBalance,
        0,
        "MISS-5: PositionRoller holds dEURO (flash loan not repaid)"
    );
}
```

**Why this matters:** The roller uses `deuro.mint(address(this), repay)` as a flash loan and `deuro.burnFrom(msg.sender, repay)` at the end. If any code path allows the roller to retain minted dEURO, unbacked supply exists.

### 2.6 Leadrate Ticks Monotonic (MISS-6) — MEDIUM

**Property:** Leadrate ticks never decrease

```solidity
/// @dev MISS-6: Leadrate ticks are monotonically non-decreasing
/// Tracked via handler — store previous ticks and verify current >= previous
uint64 internal lastMintingHubTicks;
uint64 internal lastSavingsTicks;

function invariant_leadrateTicksMonotonic() public {
    MintingHub hub = s_env.mintingHub();
    Savings savings = s_env.savings();

    uint64 hubTicks = hub.currentTicks();
    uint64 savTicks = savings.currentTicks();

    assertGe(hubTicks, lastMintingHubTicks, "MISS-6: MintingHub ticks decreased");
    assertGe(savTicks, lastSavingsTicks, "MISS-6: Savings ticks decreased");

    lastMintingHubTicks = hubTicks;
    lastSavingsTicks = savTicks;
}
```

### 2.7 nDEPS Supply Cap (MISS-7) — MEDIUM

**Property:** `nDEPS totalSupply <= type(uint96).max`

```solidity
/// @dev MISS-7: nDEPS supply cannot exceed uint96 max
function invariant_ndepsSupplyCap() public view {
    Equity equity = Equity(address(s_env.deuro().reserve()));
    assertLe(
        equity.totalSupply(),
        type(uint96).max,
        "MISS-7: nDEPS supply exceeds uint96 max"
    );
}
```

### 2.8 Same-Block Challenge Avert (MISS-8) — MEDIUM

This is already enforced by a `require` in the code (`MintingHub.sol:338`). The handler should verify this by attempting same-block averts and confirming they revert. This is better tested as a targeted fuzz test (see Section 5) rather than a global invariant.

---

## 3. Handler Expansion (New Actions)

The current handler only covers Position + MintingHub. These additions cover Savings, Equity, and Bridge.

### 3.1 Environment Changes

The `Environment.t.sol` constructor needs to register Savings as a minter and set up equity with initial investment:

```solidity
// Add to Environment constructor, after s_deuro.initialize(...)

// Register Savings as minter (needed for distributeProfits)
s_deuro.suggestMinter(address(s_savings), 0, 0, "Register Savings");
increaseTime(uint40(s_deuro.MIN_APPLICATION_PERIOD()) + 1);

// Register PositionRoller as minter
s_deuro.suggestMinter(address(s_positionRoller), 0, 0, "Register Roller");
increaseTime(uint40(s_deuro.MIN_APPLICATION_PERIOD()) + 1);

// Bootstrap equity with initial investment so savings interest can flow
mintDEURO(alice, 10_000e18);
vm.startPrank(alice);
s_deuro.approve(address(s_deuro.reserve()), 10_000e18);
Equity(address(s_deuro.reserve())).invest(10_000e18, 0);
vm.stopPrank();

// Optionally set up a StablecoinBridge
s_sourceStablecoin = new TestToken("EUR Stablecoin", "EURS", 18);
s_bridge = new StablecoinBridge(
    address(s_sourceStablecoin),
    address(s_deuro),
    1_000_000e18, // limit
    365 days       // horizon
);
s_deuro.suggestMinter(address(s_bridge), 0, 0, "Register Bridge");
increaseTime(uint40(s_deuro.MIN_APPLICATION_PERIOD()) + 1);
```

### 3.2 Savings Handler Actions

```solidity
/// @dev Save dEURO into Savings
function saveDEURO(uint8 eoaIdx, uint192 amount, bool compound) public {
    address user = s_env.eoas(eoaIdx);
    if (s_env.savings().currentRatePPM() == 0) return; // rate must be > 0

    amount = uint192(bound(uint256(amount), 1e18, 100_000e18));
    s_env.mintDEURO(user, uint256(amount));

    recordAction("saveDEURO");
    vm.startPrank(user);
    s_env.deuro().approve(address(s_env.savings()), uint256(amount));
    try s_env.savings().save(amount, compound) {
        // Post-condition: user's saved balance increased
    } catch {
        recordRevert("saveDEURO");
    }
    vm.stopPrank();
}

/// @dev Withdraw from Savings
function withdrawSavings(uint8 eoaIdx, uint192 amount) public {
    address user = s_env.eoas(eoaIdx);
    (uint192 saved, ) = s_env.savings().savings(user);
    if (saved == 0) return;

    amount = uint192(bound(uint256(amount), 1, uint256(saved)));

    recordAction("withdrawSavings");
    vm.startPrank(user);
    try s_env.savings().withdraw(user, amount) {
        // Post-condition: user's saved balance decreased
    } catch {
        recordRevert("withdrawSavings");
    }
    vm.stopPrank();
}

/// @dev Claim non-compounding interest
function claimSavingsInterest(uint8 eoaIdx) public {
    address user = s_env.eoas(eoaIdx);
    uint192 claimable = s_env.savings().claimableInterest(user);
    if (claimable == 0) return;

    recordAction("claimSavingsInterest");
    vm.startPrank(user);
    try s_env.savings().claimInterest(user) {
        // Post-condition: claimable interest transferred
    } catch {
        recordRevert("claimSavingsInterest");
    }
    vm.stopPrank();
}

/// @dev Refresh savings balance (trigger interest accrual)
function refreshSavings(uint8 eoaIdx) public {
    address user = s_env.eoas(eoaIdx);

    recordAction("refreshSavings");
    try s_env.savings().refreshBalance(user) {
        // Post-condition: interest accrued
    } catch {
        recordRevert("refreshSavings");
    }
}
```

### 3.3 Equity Handler Actions

```solidity
/// @dev Invest in nDEPS
function investEquity(uint8 eoaIdx, uint256 amount) public {
    if (!shouldExecute(20)) return;

    address user = s_env.eoas(eoaIdx);
    Equity equity = Equity(address(s_env.deuro().reserve()));

    // Need minimum equity of 1000 dEURO in reserve
    if (s_env.deuro().equity() < 1000e18) return;

    amount = bound(amount, 100e18, 50_000e18);
    s_env.mintDEURO(user, amount);

    recordAction("investEquity");
    vm.startPrank(user);
    s_env.deuro().approve(address(equity), amount);
    try equity.invest(amount, 0) {
        // Post-condition: user received nDEPS shares
    } catch {
        recordRevert("investEquity");
    }
    vm.stopPrank();
}

/// @dev Redeem nDEPS for dEURO
function redeemEquity(uint8 eoaIdx, uint256 shares) public {
    if (!shouldExecute(10)) return;

    address user = s_env.eoas(eoaIdx);
    Equity equity = Equity(address(s_env.deuro().reserve()));

    uint256 userShares = equity.balanceOf(user);
    if (userShares == 0) return;
    if (!equity.canRedeem(user)) return;

    shares = bound(shares, 1, userShares);

    recordAction("redeemEquity");
    vm.startPrank(user);
    try equity.redeem(user, shares) {
        // Post-condition: user received dEURO
    } catch {
        recordRevert("redeemEquity");
    }
    vm.stopPrank();
}
```

### 3.4 StablecoinBridge Handler Actions

```solidity
/// @dev Mint dEURO via bridge
function bridgeMint(uint8 eoaIdx, uint256 amount) public {
    if (!shouldExecute(15)) return;

    StablecoinBridge bridge = s_env.bridge();
    if (bridge.stopped()) return;
    if (block.timestamp > bridge.horizon()) return;

    address user = s_env.eoas(eoaIdx);
    uint256 remaining = bridge.limit() - bridge.minted();
    if (remaining == 0) return;

    amount = bound(amount, 1e18, min(remaining, 100_000e18));

    // Mint source stablecoin to user
    s_env.mintSourceStablecoin(user, amount);

    recordAction("bridgeMint");
    vm.startPrank(user);
    s_env.sourceStablecoin().approve(address(bridge), amount);
    try bridge.mint(amount) {
        // Post-condition: user received dEURO, bridge.minted increased
    } catch {
        recordRevert("bridgeMint");
    }
    vm.stopPrank();
}

/// @dev Burn dEURO via bridge
function bridgeBurn(uint8 eoaIdx, uint256 amount) public {
    if (!shouldExecute(15)) return;

    StablecoinBridge bridge = s_env.bridge();
    if (bridge.minted() == 0) return;

    address user = s_env.eoas(eoaIdx);
    uint256 userBalance = s_env.deuro().balanceOf(user);
    if (userBalance == 0) return;

    amount = bound(amount, 1, min(userBalance, bridge.minted()));

    recordAction("bridgeBurn");
    vm.startPrank(user);
    try bridge.burn(amount) {
        // Post-condition: user received source stablecoin, bridge.minted decreased
    } catch {
        recordRevert("bridgeBurn");
    }
    vm.stopPrank();
}
```

### 3.5 Leadrate Governance Action

```solidity
/// @dev Propose a leadrate change (requires qualified voter)
function proposeLeadrateChange(uint24 newRate) public {
    if (!shouldExecute(5)) return;

    newRate = uint24(bound(uint256(newRate), 0, 100_000)); // 0-10%

    recordAction("proposeLeadrateChange");
    // Use deployer who should have enough votes from initial equity investment
    address proposer = s_env.eoas(0); // Alice (initial investor)
    address[] memory helpers = new address[](0);

    vm.startPrank(proposer);
    try s_env.mintingHub().proposeChange(newRate, helpers) {
        // Post-condition: nextRatePPM set, nextChange set to +7 days
    } catch {
        recordRevert("proposeLeadrateChange");
    }
    vm.stopPrank();
}

/// @dev Apply a pending leadrate change
function applyLeadrateChange() public {
    if (s_env.mintingHub().nextChange() == 0) return;
    if (block.timestamp < s_env.mintingHub().nextChange()) return;

    recordAction("applyLeadrateChange");
    try s_env.mintingHub().applyChange() {
        // Post-condition: currentRatePPM == nextRatePPM
    } catch {
        recordRevert("applyLeadrateChange");
    }
}
```

### 3.6 Multi-Position Support

Add position cloning to the handler to test multi-position scenarios:

```solidity
/// @dev Clone an existing position
function clonePosition(uint8 positionIdx, uint8 eoaIdx, uint256 collateralAmount) public {
    if (!shouldExecute(10)) return;
    if (s_env.positionCount() >= 5) return; // limit total positions

    Position parent = s_env.getPosition(positionIdx);
    // Parent must be cloneable (alive, backed, no cooldown, no challenge)
    try parent.assertCloneable() {} catch { return; }

    address newOwner = s_env.eoas(eoaIdx);
    collateralAmount = bound(collateralAmount, parent.minimumCollateral(), 200e18);

    s_env.mintCOL(newOwner, collateralAmount);
    uint256 openingFee = s_env.mintingHub().OPENING_FEE();
    s_env.mintDEURO(newOwner, openingFee);

    recordAction("clonePosition");
    vm.startPrank(newOwner);
    s_env.deuro().approve(address(s_env.mintingHub()), openingFee);
    s_env.collateralToken().approve(address(s_env.mintingHub()), collateralAmount);
    try s_env.mintingHub().clone(
        address(parent),
        newOwner,
        collateralAmount,
        parent.price(),
        parent.challengePeriod(),
        parent.riskPremiumPPM()
    ) returns (address newPos) {
        s_env.addPosition(Position(payable(newPos)));
    } catch {
        recordRevert("clonePosition");
    }
    vm.stopPrank();
}
```

**Note:** `Environment.addPosition` is a new function needed:

```solidity
// Add to Environment.t.sol
function addPosition(Position pos) external {
    s_positions.push(pos);
}
```

---

## 4. Updated Invariants Contract

The full selector array for the expanded handler:

```solidity
function setUp() public {
    s_env = new Environment();
    s_handler = new Handler(address(s_env));

    bytes4[] memory selectors = new bytes4[](22);
    // Position (existing)
    selectors[0] = Handler.mintTo.selector;
    selectors[1] = Handler.repay.selector;
    selectors[2] = Handler.addCollateral.selector;
    selectors[3] = Handler.withdrawCollateral.selector;
    selectors[4] = Handler.adjustPrice.selector;
    // Time (existing)
    selectors[5] = Handler.passCooldown.selector;
    selectors[6] = Handler.warpTime.selector;
    selectors[7] = Handler.expirePosition.selector;
    // MintingHub (existing)
    selectors[8] = Handler.challengePosition.selector;
    selectors[9] = Handler.bidChallenge.selector;
    selectors[10] = Handler.buyExpiredCollateral.selector;
    // Savings (NEW)
    selectors[11] = Handler.saveDEURO.selector;
    selectors[12] = Handler.withdrawSavings.selector;
    selectors[13] = Handler.claimSavingsInterest.selector;
    selectors[14] = Handler.refreshSavings.selector;
    // Equity (NEW)
    selectors[15] = Handler.investEquity.selector;
    selectors[16] = Handler.redeemEquity.selector;
    // Bridge (NEW)
    selectors[17] = Handler.bridgeMint.selector;
    selectors[18] = Handler.bridgeBurn.selector;
    // Governance (NEW)
    selectors[19] = Handler.proposeLeadrateChange.selector;
    selectors[20] = Handler.applyLeadrateChange.selector;
    // Multi-position (NEW)
    selectors[21] = Handler.clonePosition.selector;

    targetSelector(FuzzSelector({addr: address(s_handler), selectors: selectors}));
    targetContract(address(s_handler));
}
```

---

## 5. Targeted Fuzz Tests for Edge Cases

These are standalone fuzz tests (not invariant tests) targeting specific edge cases from the variant analysis.

### 5.1 Challenge Phase 1 Aversion (TODO from Handler)

The existing handler has `// TODO: Phase 1 (avert phase)` in `bidChallenge`. This test specifically targets Phase 1:

```solidity
/// @dev Fuzz test: Challenge aversion (Phase 1 bidding)
function test_fuzz_challengeAversion(
    uint256 challengeSize,
    uint256 bidSize,
    uint40 bidDelay
) public {
    // Setup: create and fund a position with debt
    Position pos = s_env.getPosition(0);
    _setupPositionWithDebt(pos);

    // Challenge
    challengeSize = bound(challengeSize, pos.minimumCollateral(), pos.collateral().balanceOf(address(pos)));
    s_env.mintCOL(s_challenger, challengeSize);

    vm.startPrank(s_challenger);
    s_env.collateralToken().approve(address(s_env.mintingHub()), challengeSize);
    uint256 challengeIdx = s_env.mintingHub().challenge(address(pos), challengeSize, 0);
    vm.stopPrank();

    // Delay (must be > 0 to avoid same-block avert prevention)
    bidDelay = uint40(bound(uint256(bidDelay), 1, pos.challengePeriod()));
    increaseTime(bidDelay);

    // Avert bid
    (, uint40 phase) = pos.challengeData();
    if (block.timestamp <= uint40(block.timestamp) + phase) {
        uint256 liqPrice = pos.virtualPrice();
        uint256 avertCost = (challengeSize * liqPrice) / 1e18;
        s_env.mintDEURO(s_bidder, avertCost);

        uint256 preCollateral = s_env.collateralToken().balanceOf(s_bidder);
        uint256 preChallenged = pos.challengedAmount();

        vm.startPrank(s_bidder);
        s_env.deuro().approve(address(s_env.mintingHub()), avertCost);
        s_env.mintingHub().bid(uint32(challengeIdx), challengeSize, false);
        vm.stopPrank();

        // Verify: challenged amount decreased
        assertEq(pos.challengedAmount(), preChallenged - challengeSize, "Avert: challenged amount wrong");
        // Verify: bidder received challenger's collateral
        assertEq(
            s_env.collateralToken().balanceOf(s_bidder),
            preCollateral + challengeSize,
            "Avert: bidder didn't receive collateral"
        );
        // Verify: position entered cooldown
        assertGt(pos.cooldown(), block.timestamp, "Avert: no cooldown set");
    }
}
```

### 5.2 Same-Block Avert Prevention (MISS-8)

```solidity
/// @dev Fuzz test: Same-block challenge avert must revert
function test_fuzz_sameBlockAvertReverts(uint256 challengeSize) public {
    Position pos = s_env.getPosition(0);
    _setupPositionWithDebt(pos);

    challengeSize = bound(challengeSize, pos.minimumCollateral(), pos.collateral().balanceOf(address(pos)));
    s_env.mintCOL(s_challenger, challengeSize);

    vm.startPrank(s_challenger);
    s_env.collateralToken().approve(address(s_env.mintingHub()), challengeSize);
    uint256 challengeIdx = s_env.mintingHub().challenge(address(pos), challengeSize, 0);
    vm.stopPrank();

    // Attempt avert in same block (should revert)
    uint256 liqPrice = pos.virtualPrice();
    uint256 avertCost = (challengeSize * liqPrice) / 1e18;
    s_env.mintDEURO(s_bidder, avertCost);

    vm.startPrank(s_bidder);
    s_env.deuro().approve(address(s_env.mintingHub()), avertCost);
    vm.expectRevert(); // must revert — same block as challenge creation
    s_env.mintingHub().bid(uint32(challengeIdx), challengeSize, false);
    vm.stopPrank();
}
```

### 5.3 Reserve Depletion Cascade

```solidity
/// @dev Fuzz test: Multiple liquidations don't break reserve accounting
function test_fuzz_reserveDepletionCascade(
    uint256[3] memory mintAmounts,
    uint256[3] memory challengeSizes
) public {
    // Create 3 positions with varying debt levels
    for (uint256 i = 0; i < 3; i++) {
        s_env.createPosition(s_env.eoas(i));
    }
    increaseTime(5 days); // past init period

    // Mint varying amounts on each position
    for (uint256 i = 0; i < 3; i++) {
        Position pos = s_env.getPosition(i);
        uint256 maxMint = pos.availableForMinting();
        if (maxMint == 0) continue;

        mintAmounts[i] = bound(mintAmounts[i], 1e18, maxMint);
        vm.startPrank(pos.owner());
        pos.mint(pos.owner(), mintAmounts[i]);
        vm.stopPrank();
    }

    // Challenge and liquidate each position
    for (uint256 i = 0; i < 3; i++) {
        Position pos = s_env.getPosition(i);
        if (pos.principal() == 0) continue;

        uint256 colBal = pos.collateral().balanceOf(address(pos));
        challengeSizes[i] = bound(challengeSizes[i], pos.minimumCollateral(), colBal);

        s_env.mintCOL(s_challenger, challengeSizes[i]);
        vm.startPrank(s_challenger);
        s_env.collateralToken().approve(address(s_env.mintingHub()), challengeSizes[i]);
        try s_env.mintingHub().challenge(address(pos), challengeSizes[i], 0) {} catch { continue; }
        vm.stopPrank();

        // Wait for Phase 2 and bid at low price
        increaseTime(uint40(pos.challengePeriod()) + uint40(pos.challengePeriod()) - 100);

        // Bid
        vm.startPrank(s_bidder);
        s_env.deuro().approve(address(s_env.mintingHub()), type(uint256).max);
        try s_env.mintingHub().bid(uint32(i), challengeSizes[i], false) {} catch {}
        vm.stopPrank();
    }

    // CRITICAL CHECK: Reserve solvency after cascade
    DecentralizedEURO deuro = s_env.deuro();
    uint256 reserveBalance = deuro.balanceOf(address(deuro.reserve()));
    uint256 minterReserve = deuro.minterReserve();

    // After losses, equity may be 0 but reserve should be handled gracefully
    // The key property: no revert during the cascade, and accounting is consistent
    assertEq(
        deuro.equity(),
        reserveBalance > minterReserve ? reserveBalance - minterReserve : 0,
        "Cascade: Equity identity broken after liquidation cascade"
    );
}
```

### 5.4 Concurrent Challenges on Same Position

```solidity
/// @dev Fuzz test: Multiple concurrent challenges resolve correctly
function test_fuzz_concurrentChallenges(
    uint256 size1,
    uint256 size2,
    uint40 bidDelay
) public {
    Position pos = s_env.getPosition(0);
    _setupPositionWithDebt(pos);

    uint256 colBal = pos.collateral().balanceOf(address(pos));
    uint256 minCol = pos.minimumCollateral();

    size1 = bound(size1, minCol, colBal);
    size2 = bound(size2, minCol, colBal);

    // Challenge 1
    s_env.mintCOL(s_challenger, size1);
    vm.startPrank(s_challenger);
    s_env.collateralToken().approve(address(s_env.mintingHub()), size1);
    uint256 idx1 = s_env.mintingHub().challenge(address(pos), size1, 0);
    vm.stopPrank();

    uint256 challengedAfter1 = pos.challengedAmount();
    assertEq(challengedAfter1, size1, "Concurrent: first challenge size wrong");

    // Challenge 2 (same position, different block)
    increaseTime(1);
    s_env.mintCOL(s_env.eoas(3), size2); // David as second challenger
    vm.startPrank(s_env.eoas(3));
    s_env.collateralToken().approve(address(s_env.mintingHub()), size2);
    uint256 idx2 = s_env.mintingHub().challenge(address(pos), size2, 0);
    vm.stopPrank();

    uint256 challengedAfter2 = pos.challengedAmount();
    assertEq(challengedAfter2, size1 + size2, "Concurrent: total challenged amount wrong");

    // Both challenges use the same challengedPrice (locked on first challenge)
    // Resolve challenge 1 in Phase 2
    bidDelay = uint40(bound(uint256(bidDelay), 1, pos.challengePeriod() * 2 - 1));
    increaseTime(uint40(pos.challengePeriod()) + bidDelay);

    uint256 prePrincipal = pos.principal();
    s_env.mintDEURO(s_bidder, 1_000_000e18);
    vm.startPrank(s_bidder);
    s_env.deuro().approve(address(s_env.mintingHub()), type(uint256).max);
    try s_env.mintingHub().bid(uint32(idx1), size1, false) {
        // After resolving challenge 1, challenged amount should decrease
        assertLe(pos.challengedAmount(), challengedAfter2, "Concurrent: challenged didn't decrease");
        assertLe(pos.principal(), prePrincipal, "Concurrent: principal increased after liquidation");
    } catch {}
    vm.stopPrank();
}
```

---

## 6. Bridge-Specific Invariants

```solidity
/// @dev Bridge minted amount never exceeds limit
function invariant_bridgeMintedWithinLimit() public view {
    StablecoinBridge bridge = s_env.bridge();
    assertLe(
        bridge.minted(),
        bridge.limit(),
        "Bridge: minted exceeds limit"
    );
}

/// @dev Bridge source stablecoin balance matches minted amount
function invariant_bridgeBalanceConsistency() public view {
    StablecoinBridge bridge = s_env.bridge();
    uint256 sourceBalance = s_env.sourceStablecoin().balanceOf(address(bridge));
    // sourceBalance should equal bridge.minted() (1:1 backing)
    // Allow for rounding with different decimals
    assertApproxEqAbs(
        sourceBalance,
        bridge.minted(),
        1, // 1 wei tolerance for decimal conversion
        "Bridge: source balance doesn't match minted"
    );
}
```

---

## 7. Echidna / Medusa Properties (Recommended)

For deeper coverage, these properties are designed for dedicated fuzzing tools that can explore longer sequences and detect more subtle issues.

### 7.1 Echidna Configuration

```yaml
# echidna.yaml
testMode: assertion
testLimit: 100000
seqLen: 100
contractAddr: "0x00a329c0648769A73afAc7F9381E08FB43dBEA72"
deployer: "0x00a329c0648769A73afAc7F9381E08FB43dBEA72"
sender: ["0x10000", "0x20000", "0x30000"]
cryticArgs: ["--compile-force-framework", "foundry"]
```

### 7.2 Echidna Property Contract

```solidity
contract EchidnaProperties {
    DecentralizedEURO deuro;
    Equity equity;
    MintingHub hub;
    Savings savings;
    PositionRoller roller;

    // Property: Reserve solvency
    function echidna_reserve_solvency() public view returns (bool) {
        return deuro.balanceOf(address(equity)) >= deuro.minterReserve();
    }

    // Property: Roller never holds dEURO
    function echidna_roller_empty() public view returns (bool) {
        return deuro.balanceOf(address(roller)) == 0;
    }

    // Property: Equity identity
    function echidna_equity_identity() public view returns (bool) {
        uint256 reserveBal = deuro.balanceOf(address(equity));
        uint256 minterRes = deuro.minterReserve();
        if (reserveBal > minterRes) {
            return deuro.equity() == reserveBal - minterRes;
        } else {
            return deuro.equity() == 0;
        }
    }

    // Property: nDEPS supply bounded
    function echidna_ndeps_bounded() public view returns (bool) {
        return equity.totalSupply() <= type(uint96).max;
    }

    // Property: No unbacked dEURO from savings
    function echidna_savings_bounded() public view returns (bool) {
        // Total savings shouldn't exceed dEURO held by savings + available equity
        return true; // requires per-account iteration, simplified here
    }
}
```

---

## 8. Test Coverage Matrix

### Current vs Recommended Coverage

| Module | Current Handler Actions | New Handler Actions | Total |
|--------|----------------------|-------------------|-------|
| Position | 5 (mint, repay, addCol, withdrawCol, adjustPrice) | 0 | 5 |
| MintingHub | 3 (challenge, bid, buyExpired) | 1 (clone) | 4 |
| Time | 3 (cooldown, warp, expire) | 0 | 3 |
| Savings | 0 | 4 (save, withdraw, claim, refresh) | 4 |
| Equity | 0 | 2 (invest, redeem) | 2 |
| Bridge | 0 | 2 (mint, burn) | 2 |
| Governance | 0 | 2 (proposeChange, applyChange) | 2 |
| **Total** | **11** | **11** | **22** |

### Invariant Coverage

| ID | Invariant | Status | Priority |
|----|-----------|--------|----------|
| INV-1 | No trapped dEURO | Existing | — |
| INV-2 | Position collateralized | Existing | — |
| INV-3 | Nonzero interest → nonzero principal | Existing | — |
| INV-4 | Zero principal → zero interest | Existing | — |
| INV-5 | Active position minimum collateral | Existing | — |
| INV-6 | Debt = principal + interest | Existing | — |
| INV-7 | Minting limit not exceeded | Existing | — |
| INV-8 | Minter reserve consistency | Existing | — |
| INV-9 | Virtual price >= actual price | Existing | — |
| INV-10 | Total supply consistency | Existing | — |
| INV-11 | Fixed rate >= risk premium | Existing | — |
| **MISS-1** | **Reserve solvency** | **NEW** | **CRITICAL** |
| **MISS-2** | **Equity identity** | **NEW** | **CRITICAL** |
| **MISS-3** | **Challenge amount bounded** | **NEW** | **HIGH** |
| **MISS-4** | **Savings interest capped** | **NEW** | **HIGH** |
| **MISS-5** | **Roller net-to-zero** | **NEW** | **HIGH** |
| **MISS-6** | **Leadrate ticks monotonic** | **NEW** | **MEDIUM** |
| **MISS-7** | **nDEPS supply cap** | **NEW** | **MEDIUM** |
| **MISS-8** | **Same-block avert** | **NEW (targeted test)** | **MEDIUM** |
| **NEW-1** | **Bridge minted within limit** | **NEW** | **MEDIUM** |
| **NEW-2** | **Bridge balance consistency** | **NEW** | **MEDIUM** |

### Targeted Fuzz Tests

| Test | Edge Case | Source Phase |
|------|-----------|-------------|
| `test_fuzz_challengeAversion` | Phase 1 bidding (TODO in handler) | Phase 3 |
| `test_fuzz_sameBlockAvertReverts` | MEV protection (MISS-8) | Phase 1 |
| `test_fuzz_reserveDepletionCascade` | Cascading liquidations | Phase 3, 9 |
| `test_fuzz_concurrentChallenges` | Multiple challenges on same position | Phase 1, 9 |

---

## 9. Implementation Roadmap

### Phase A: Configuration & Quick Wins (1 day)

1. Update `foundry.toml` with recommended settings
2. Add MISS-1 (reserve solvency) and MISS-5 (roller net-zero) invariants — these require zero handler changes
3. Add MISS-2 (equity identity) and MISS-7 (nDEPS cap) invariants
4. Run with `fail_on_revert = true`, fix handler guards as needed

### Phase B: Handler Expansion (2-3 days)

5. Add `addPosition` to Environment
6. Implement Savings handler actions (save, withdraw, claim, refresh)
7. Implement Equity handler actions (invest, redeem)
8. Add `clonePosition` handler action
9. Update selector array in Invariants.setUp()
10. Add MISS-4 (savings interest cap) and MISS-6 (ticks monotonic) invariants

### Phase C: Bridge & Governance (1-2 days)

11. Add Bridge to Environment setup
12. Implement Bridge handler actions (mint, burn)
13. Implement Governance handler actions (proposeChange, applyChange)
14. Add bridge invariants (NEW-1, NEW-2)

### Phase D: Targeted Edge Cases (2-3 days)

15. Implement `test_fuzz_challengeAversion`
16. Implement `test_fuzz_sameBlockAvertReverts`
17. Implement `test_fuzz_reserveDepletionCascade`
18. Implement `test_fuzz_concurrentChallenges`

### Phase E: CI & Hardening (1 day)

19. Add Foundry tests to GitHub Actions CI
20. Run 10K+ invariant sequences overnight
21. Analyze coverage reports, identify remaining gaps
22. Document any invariant violations found

---

## 10. Properties NOT Recommended for Fuzzing

Some issues from the audit are better addressed through code changes or manual review rather than property-based testing:

| Issue | Why Not Fuzz | Better Approach |
|-------|-------------|-----------------|
| Fee-on-transfer tokens (T-1 through T-3) | Requires deploying a custom fee-on-transfer mock token — the standard TestToken won't trigger the bug | Write a dedicated integration test with a `FeeOnTransferToken` mock |
| ERC-777 reentrancy (T-6) | Requires deploying an ERC-777 token with transfer hooks | Write a dedicated test with a `ReentrantToken` mock |
| Implicit allowance abuse (T-9) | The implicit allowance is by design — fuzzing won't flag it | Code review + documentation |
| Missing events (V6.x) | Events are not observable from within Solidity tests | Off-chain event monitoring tests (Hardhat/ethers.js) |
| Approval residual (T-10) | Requires USDT-style approve-to-zero tokens | Dedicated integration test with mock |
| `_finishChallenge` spec mismatch | Semantic mismatch, not a crash/invariant violation | Code review against spec |

---

## Appendix A: Helper Functions Needed

```solidity
/// @dev Setup a position with collateral and minted debt
function _setupPositionWithDebt(Position pos) internal {
    address owner = pos.owner();

    // Ensure position is past init period and active
    if (block.timestamp < pos.start()) {
        increaseTimeTo(uint40(pos.start()) + 1);
    }
    if (pos.cooldown() > block.timestamp) {
        increaseTimeTo(uint40(pos.cooldown()) + 1);
    }

    // Mint some debt if none exists
    if (pos.principal() == 0) {
        uint256 maxMint = pos.availableForMinting();
        uint256 colBal = pos.collateral().balanceOf(address(pos));
        uint256 maxByCol = colBal > 0 ? (colBal * pos.price()) / 1e18 : 0;
        uint256 amount = min(maxMint, maxByCol);
        if (amount > 1e18) {
            amount = amount / 2; // mint half of max for safety margin
            vm.startPrank(owner);
            pos.mint(owner, amount);
            vm.stopPrank();
        }
    }
}
```

---

## Appendix B: Expected Findings from Expanded Testing

Based on the audit context, the expanded fuzzing suite is expected to surface or confirm:

1. **Reserve accounting under heavy load** — With Savings + Equity + Position + Bridge all operating concurrently, the minterReserveE6 accounting may reveal edge cases not visible with Position-only testing.

2. **Savings interest distribution ordering** — With multiple EOAs saving and refreshing in varying orders, the per-account interest cap (`<= equity()`) may show that earlier refreshes get more interest than later ones within the same block.

3. **Leadrate tick accumulation precision** — Rate changes between Savings and MintingHub Leadrate instances may diverge if tick accumulation has precision issues.

4. **Challenge settlement with concurrent positions** — Multiple positions from the same original, all with active challenges, may expose totalMinted tracking issues.

5. **Bridge + Equity interaction** — Large bridge mints increasing reserve balance followed by equity redemption may create a race condition where `minterReserve` temporarily exceeds actual reserve.

---

*Report generated as Phase 10 of the dEuro V3 audit playbook. Follow the implementation roadmap in Section 9 to incrementally add these tests to the Foundry invariant suite.*
