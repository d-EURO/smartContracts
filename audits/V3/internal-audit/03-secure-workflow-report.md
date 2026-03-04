# dEuro Smart Contracts — Trail of Bits Secure Development Workflow Report

**Date**: 2026-03-03
**Tool**: Slither 0.11.5
**Build**: Foundry + Hardhat (Solidity ^0.8.26)
**Scope**: `contracts/` (excluding `contracts/test/`)
**SLOC**: 2,205 source lines across 24 contracts (12 concrete in-scope)

---

## Step 1: Slither Security Scan

### Summary

| Impact | Count | Triaged Real | False Positive / By-Design |
|--------|-------|-------------|---------------------------|
| High | 19 | 1 | 18 |
| Medium | 31 | 4 | 27 |
| Low | 47+ | ~5 | remainder |
| **Total** | **97+** | **~10** | **~87** |

### High-Impact Findings

#### H-1: `unchecked-transfer` — 13 instances ➜ **FALSE POSITIVE (By Design)**

All 13 instances use `transfer()` / `transferFrom()` on either:
- **dEURO** (DecentralizedEURO): Custom ERC-20 that inherits OpenZeppelin's ERC20 which always returns `true` or reverts. Return value is guaranteed.
- **Collateral tokens**: `openPosition()` at `MintingHub.sol:148-155` validates that collateral tokens revert on failed transfers at position creation time. Tokens that return `false` without reverting are explicitly rejected.

**Triage**: By design. The protocol enforces revert-on-failure at the admission boundary. No action needed.

#### H-2: `arbitrary-send-erc20` — 2 instances in `Position.forceSale()` ➜ **FALSE POSITIVE**

`forceSale()` at `Position.sol:664` uses `deuro.transferFrom(buyer, owner(), proceeds)`. Slither flags `buyer` as arbitrary, but:
- `forceSale` is restricted to `onlyHub` (MintingHub only)
- `buyer` is always `msg.sender` passed from `MintingHub._buyExpiredCollateral()`
- The buyer explicitly consents by calling the function and providing approval

**Triage**: False positive. Access control prevents arbitrary usage.

#### H-3: `arbitrary-send-eth` — `Position._withdrawCollateralAsNative()` ➜ **FALSE POSITIVE**

`Position.sol:738`: `target.call{value: amount}("")` — `target` is always provided by the `onlyOwner`-gated caller. The owner controls where their own collateral goes.

**Triage**: False positive. Owner-controlled.

#### H-4: `weak-prng` — `Equity._adjustRecipientVoteAnchor()` ➜ **FALSE POSITIVE**

`Equity.sol:167`: `recipientVotes % newbalance` is not used as a random number generator. It's the mathematical remainder when redistributing vote-weighted time anchors. This is intentional arithmetic for tracking vote rounding loss.

**Triage**: False positive. Not PRNG usage.

#### H-5: `reentrancy-balance` — `Position.rescueToken()` ➜ **TRUE POSITIVE (Low Severity)**

`Position.sol:703-708`: Reads `_collateralBalance()` before external `transfer()`, then checks it hasn't changed. This is intentionally designed as a guard against double-entry-point tokens. However, with a malicious token that has a transfer callback, the balance check *is* the reentrancy guard — and it works correctly (reverts if balance changed). The finding is technically true (there is reentrancy potential) but the guard handles it.

**Triage**: Acknowledged. The check-after pattern is the intended defense. Consider adding a comment explaining the design. No code change needed.

#### H-6: `reentrancy-eth` — `Position._adjust()` ➜ **NEEDS REVIEW**

`Position.sol:365-394`: Complex function that performs collateral deposit, debt repayment, collateral withdrawal (including native ETH via `target.call{value}`), minting, and price adjustment in sequence. After the native ETH send at L381/L738, state variables (`cooldown`, `fixedAnnualRatePPM`, `interest`, `lastAccrual`, `price`, `principal`) are written.

The function is `onlyOwner`, so only the position owner can trigger it. The owner would be reentering their own position. Since the owner already has full control over their position's parameters (they can call adjust again normally), this doesn't create an additional attack vector beyond what the owner already has.

**Triage**: Low risk due to `onlyOwner`. However, the lack of `ReentrancyGuard` across the protocol means if a malicious collateral token were admitted (e.g., ERC-777 via a permissive position), the state ordering could be exploitable. **Recommend documenting this as an accepted risk contingent on collateral vetting.**

### Medium-Impact Findings

#### M-1: `reentrancy-no-eth` — 16 instances ➜ **MOSTLY FALSE POSITIVE**

Most are in `Position` and `Savings` where external calls to dEURO (trusted) or collateral (vetted) precede state writes. The trust model relies on:
1. dEURO is a known, non-reentrant ERC-20
2. Collateral tokens are validated at admission

Two notable instances worth monitoring:
- **`Savings.refresh()`** (`Savings.sol:59`): Calls `deuro.distributeProfits()` externally before updating account state. Since dEURO is trusted, this is safe but fragile if the trust assumption changes.
- **`SavingsVaultDEURO._deposit()`** (`SavingsVaultDEURO.sol:74`): Explicitly documented and handled (transfer-before-mint pattern, with comments about ERC-777).

**Triage**: By design. Trust model documented in 01-context.md.

#### M-2: `incorrect-equality` — 13 instances ➜ **MOSTLY FALSE POSITIVE**

Strict equality checks on amounts like `amount == 0` (early return), `balance == _collateralBalance()` (rescue guard), `totalSupply() == 0` (initialization). These are intentional guards, not manipulable conditions.

**Triage**: By design. No action needed.

#### M-3: `divide-before-multiply` — 2 instances ➜ **TRUE POSITIVE (Low Impact)**

1. **`PositionRoller._calculateRollParams()`** (`PositionRoller.sol:184-187`): Divides to get `depositAmount`, then multiplies back to get `mintAmount`. This is intentional ceiling division followed by recalculation to ensure the mint amount matches what the deposit covers. Rounding is in the protocol's favor.

2. **`MintingHub._finishChallenge()`** (`MintingHub.sol:310-313`): `offer = (unitPrice * collateral) / 1e18` then `reward = (offer * CHALLENGER_REWARD) / 1_000_000`. Precision loss is bounded by `CHALLENGER_REWARD / 1M` of one unit (~0.00002%), negligible.

**Triage**: Acknowledged. Precision loss is bounded and intentional. No fix needed.

#### M-4: `unused-return` — 4 instances ➜ **REVIEW**

Several IERC20 operations don't check return values, but this is covered by the revert-on-failure collateral validation. However, `IERC20(WETH).transfer()` at `MintingHub.sol:181` assumes WETH always returns true or reverts — this is a valid assumption for canonical WETH but should be documented.

**Triage**: Acceptable given WETH is set at construction time. Document the WETH trust assumption.

---

## Step 2: Special Feature Checks

### Upgradeability: N/A ✓

No proxy patterns, `delegatecall`, `UUPS`, or `TransparentProxy` found. Positions use ERC-1167 minimal proxies for cloning but these are immutable clones (not upgradeable). The clone factory at `PositionFactory.sol:58-68` creates deterministic clones with no upgrade path.

### ERC Conformance: PASS ✓ (with note)

| Contract | Standard | Result |
|----------|----------|--------|
| DecentralizedEURO | ERC-20 | ✅ All checks pass |
| Equity | ERC-20 | ✅ All checks pass |
| SavingsVaultDEURO | ERC-20/ERC-4626 | ✅ All checks pass |
| DEPSWrapper | ERC-20 | ✅ All checks pass |
| BridgedToken | ERC-20 | ✅ All checks pass |

**Note**: All ERC-20 tokens flag "not protected for the ERC20 approval race condition." This is standard OZ ERC-20 behavior — the protocol provides `permit()` (ERC-2612) as the recommended alternative.

**Critical note on DecentralizedEURO**: The custom `allowance()` override at `DecentralizedEURO.sol:114-131` returns `type(uint256).max` for minter-to-minter/position transfers. While ERC-20 compliant (allowance is a view function with no mandated behavior), this is a **non-standard trust assumption** that any ERC-20 integrator would not expect. Any external protocol integrating dEURO should be warned.

### Token Integration: REVIEW RECOMMENDED

The protocol interacts with external collateral tokens. Key findings:
- **Fee-on-transfer tokens**: Not explicitly blocked. The `openPosition` validation at `MintingHub.sol:148-155` checks revert-on-failure but not fee-on-transfer. If a fee-on-transfer token passes the check, `_adjust()` at `Position.sol:372` would pass `newCollateral` to `_mint()` which could differ from actual received balance.
- **Rebasing tokens**: No explicit protection. A rebasing collateral token could silently change the effective collateralization ratio.
- **ERC-777 tokens**: No reentrancy guards. If an ERC-777 token were used as collateral, transfer hooks could trigger reentry.

### Clone Pattern: REVIEWED ✓

`PositionFactory._createClone()` at `PositionFactory.sol:58-68` uses inline assembly for ERC-1167 minimal proxy creation. The bytecode matches the canonical ERC-1167 pattern. The `require(result != address(0))` check prevents silent deployment failure. Clones delegate to `original()` which is set immutably in the constructor.

---

## Step 3: Visual Security Inspection

### Contract Feature Matrix

| Contract | Functions | Complex | Features | Risk |
|----------|-----------|---------|----------|------|
| Position | 121 | **Yes** | Receive ETH, Send ETH, Tokens | **Highest** |
| MintingHub | 47 | **Yes** | Receive ETH, Send ETH, Tokens | **High** |
| Equity | 95 | No | Ecrecover, Tokens | **Medium** |
| DecentralizedEURO | 99 | No | Ecrecover, Tokens | **Medium** |
| Savings | 18 | No | Tokens | **Medium** |
| PositionRoller | 10 | No | Receive ETH, Send ETH, Tokens | **Medium** |
| SavingsVaultDEURO | 77 | No | Tokens (ERC-4626) | **Low** |
| StablecoinBridge | 10 | No | Tokens | **Low** |

### Position.sol Modifier Coverage

| Modifier | Functions Protected | Coverage |
|----------|-------------------|----------|
| `onlyHub` | 6 (initialize, forceSale, transferChallengedCollateral, notifyChallenge*) | ✅ Complete |
| `onlyOwner` | 6 (adjust*, adjustPrice*, rescueToken, withdrawCollateralAsNative) | ✅ Complete |
| `ownerOrRoller` | 2 (mint, withdrawCollateral) | ✅ Complete |
| `noChallenge` | 6 (assertCloneable, _adjustPrice, _mint, forceSale, _withdrawCollateral*) | ✅ Complete |
| `noCooldown` | 4 (assertCloneable, _mint, _withdrawCollateral*) | ✅ Complete |
| `alive` | 4 (assertCloneable, _adjustPrice, _mint, notifyChallengeStarted) | ✅ Complete |
| `backed` | 3 (assertCloneable, _adjustPrice, _mint) | ✅ Complete |
| `expired` | 1 (forceSale) | ✅ Complete |

**Observation**: `repay()` and `repayFull()` have NO access control — anyone can repay anyone's debt. This is by design (documented in 02-entry-points.md) but unusual.

### State Variable Write Authorization

Key mutable state in `Position`:
| Variable | Written By | Guard |
|----------|-----------|-------|
| `price` | `_setPrice` | `onlyOwner` (via adjust/adjustPrice) or `onlyHub` (via initialize) |
| `principal` | `_mint`, `_repayPrincipal*`, `notifyChallengeSucceeded` | `ownerOrRoller` or `onlyHub` or anyone (repay) |
| `interest` | `_accrueInterest`, `_repayInterest`, `_notifyInterestPaid` | Implicit (called within guarded functions) |
| `challengedAmount` | `notifyChallengeStarted`, `notifyChallengeAverted`, `notifyChallengeSucceeded` | `onlyHub` |
| `cooldown` | `_restrictMinting`, `initialize` | `onlyHub` (indirect) |
| `expiration` | `initialize` | `onlyHub` (one-time) |
| `fixedAnnualRatePPM` | `_fixRateToLeadrate` | Called within `_mint` |

---

## Step 4: Security Properties & Testing

### 4.1 Documented Security Invariants

From the existing Foundry invariant suite (`foundry-test/invariant/Invariants.t.sol`), **10 invariants** are already tested:

| ID | Invariant | Status |
|----|-----------|--------|
| INV-1 | No trapped dEURO in positions | ✅ Tested |
| INV-2 | Positions sufficiently collateralized | ✅ Tested |
| INV-3 | Nonzero interest implies nonzero principal | ✅ Tested |
| INV-4 | Zero principal implies zero interest | ✅ Tested |
| INV-5 | Active positions have minimum collateral | ✅ Tested |
| INV-6 | Debt = principal + interest | ✅ Tested |
| INV-7 | Minting limit not exceeded | ✅ Tested |
| INV-8 | Minter reserve consistency | ✅ Tested |
| INV-9 | Virtual price >= actual price (when debt exists) | ✅ Tested |
| INV-10 | Fixed rate >= risk premium | ✅ Tested |

### 4.2 Missing Invariants (Recommended Additions)

The following critical invariants from `01-context.md` are **NOT yet tested**:

| ID | Missing Invariant | Priority | Rationale |
|----|-------------------|----------|-----------|
| **MISS-1** | `balanceOf(reserve) >= minterReserve()` (SYS-1) | **Critical** | Core accounting identity. If violated, equity is negative and the system is insolvent. |
| **MISS-2** | `equity() = balanceOf(reserve) - minterReserve()` (SYS-2) | **Critical** | Derived from MISS-1 but should be independently tested. |
| **MISS-3** | `challengedAmount` tracks actual challenged collateral (SYS-5) | **High** | Challenge settlement correctness depends on this. |
| **MISS-4** | Savings interest <= equity (SYS-7) | **High** | Prevents system drain via savings. |
| **MISS-5** | Leadrate ticks are monotonically non-decreasing (SYS-8) | **Medium** | Tick accumulation correctness. |
| **MISS-6** | `nDEPS supply <= type(uint96).max` (SYS-9) | **Medium** | Prevents vote calculation overflow. |
| **MISS-7** | Flash loan net-to-zero in PositionRoller (SYS-6) | **High** | Critical for preventing unbacked minting via Roller. |
| **MISS-8** | Same-block challenge avert prevented (SYS-10) | **Medium** | Anti-MEV protection. |

### 4.3 Handler Coverage Gaps

Current handler covers 11 actions. Missing:
- **Savings**: `save`, `withdraw`, `claimInterest`, `refreshBalance`
- **Equity**: `invest`, `redeem`
- **Roller**: `roll`, `rollNative`
- **Bridge**: `mint`, `burn`
- **Governance**: `denyMinter`, `deny` (position), `proposeChange`
- **Multi-position**: creating multiple clones, concurrent challenges

### 4.4 Recommended Echidna Properties

```solidity
// Property: Reserve solvency
function echidna_reserve_covers_minter() public view returns (bool) {
    return deuro.balanceOf(address(deuro.reserve())) >= deuro.minterReserve();
}

// Property: No unbacked minting via roller
function echidna_roller_net_zero() public view returns (bool) {
    return deuro.balanceOf(address(roller)) == 0;
}

// Property: Savings doesn't drain equity
function echidna_savings_bounded() public view returns (bool) {
    return savings.totalSaved() <= deuro.balanceOf(address(savings)) + deuro.equity();
}

// Property: Challenge amount consistency
function echidna_challenge_amount_bounded() public view returns (bool) {
    // For each position, challengedAmount <= collateral balance
    // (tested per position in the handler)
    return true; // implement with position iteration
}
```

---

## Step 5: Manual Review Areas

### 5.1 Privacy: LOW RISK ✓

No on-chain secrets, commit-reveal patterns, or private data storage. All position parameters are public. No randomness-dependent logic (the `weak-prng` finding is a false positive).

### 5.2 Front-Running: **MEDIUM RISK**

| Area | Risk | Detail |
|------|------|--------|
| **Challenge bidding** | **Medium** | Dutch auction bids can be front-run. An attacker seeing a profitable bid can submit their own bid first. Mitigated partially by the declining price (front-runner pays more). |
| **Equity investment** | **Medium** | `Equity.invest()` has a `_minShares` parameter for front-running protection. ✅ |
| **Equity redemption** | **Medium** | `redeemExpected()` has `_minProceeds` parameter. ✅ |
| **Position cloning** | **Low** | No slippage protection on `clone()`. A front-runner could manipulate the original position's state before the clone tx executes. |
| **Force sale** | **Low** | `buyExpiredCollateral()` has `_maxCosts` enforcement via `expiredPurchasePrice`. ✅ |
| **Savings rate changes** | **Low** | Rate changes have a 7-day delay (`Leadrate.sol:48`). No front-running risk. |

**Missing protection**: No explicit slippage/deadline on:
- `MintingHub.bid()` — bidder has no max price guarantee in Phase 2
- `Position.adjust()` — no min collateral factor guarantee after multi-step operation

### 5.3 Cryptography: LOW RISK ✓

- **ERC-2612 permit**: Standard OZ implementation with proper nonce tracking
- **ERC-3009**: Custom implementation at `contracts/impl/ERC3009.sol` using `ecrecover` with standard validity checks
- No custom cryptography, no weak randomness, no hash collision risks

### 5.4 DeFi / Economic Risks: **HIGH PRIORITY**

| Risk | Severity | Detail |
|------|----------|--------|
| **No oracle dependency** | ✅ N/A | Prices are set by position owners, not oracles. No manipulation risk. |
| **Flash loan via PositionRoller** | **Medium** | Roller flash-mints dEURO (L77, L133). The mint+burn atomicity is enforced within a single transaction. However, the Roller is a registered minter with implicit infinite allowances — if the burn at the end fails for any reason, unbacked dEURO would exist. |
| **Challenge price locking** | **Medium** | First challenge locks `challengedPrice` (`Position.sol:863`). Subsequent concurrent challenges inherit this stale price. If position economics change between challenges, settlement uses an outdated price. |
| **Reserve depletion cascade** | **High** | If reserve is depleted, `_effectiveReservePPM` reduces proportionally. This means `_repayPrincipalNet` in `forceSale` requires the buyer to cover nearly the full principal. Combined with loss coverage via `coverLoss`, a cascade of liquidations during reserve depletion could leave the system with permanent bad debt. |
| **Savings interest ordering** | **Medium** | When multiple accounts are refreshed in one block, each `distributeProfits()` draws from reserve. First refresh sees full equity; subsequent see reduced equity. This creates ordering-dependent interest distribution (documented in 01-context.md, open question #7). |
| **Compounding mode switch** | **Low** | `save(uint192, bool)` sets mode before settling interest. Documented in 01-context.md, open question #3. |
| **uint32 challenge index** | **Low** | `challenge()` returns `uint256`, `bid()` accepts `uint32`. After 4.3B challenges, new challenges are unbiddable. Documented in 01-context.md, open question #4. |

### 5.5 Access Control: WELL-DESIGNED ✓

Modifier usage is comprehensive and correct:
- Position: 8 modifiers covering all critical state transitions
- MintingHub: `validPos` modifier for position-dependent functions
- DecentralizedEURO: `minterOnly` for all mint/burn/reserve operations
- Governance: `checkQualified` with 2% quorum consistently applied

**One concern**: `PositionFactory` has **no access control**. Anyone can call `createNewPosition()` or `clonePosition()`. While "orphan" positions (not registered via MintingHub) can't mint dEURO, the `hub` field is set to `msg.sender` in `createNewPosition`. If someone creates a position through the factory directly and then interacts with the original position's `notifyMint`/`notifyRepaid`, the inline check `deuro.getPositionParent(msg.sender) != hub` prevents abuse. ✅ Verified safe.

---

## Action Plan

### Critical Priority

- [ ] **Add reserve solvency invariant test** (MISS-1, MISS-2): `balanceOf(reserve) >= minterReserve()`. This is the single most important invariant not yet fuzzed.
- [ ] **Add flash loan net-zero invariant** (MISS-7): Verify Roller never holds dEURO between transactions.
- [ ] **Document reserve depletion cascade scenario**: Model what happens when multiple positions are liquidated while reserve is depleted. Determine if `_effectiveReservePPM` graceful degradation is sufficient.

### High Priority

- [ ] **Expand invariant handler**: Add Savings, Equity, Roller, and Bridge actions to the Foundry invariant suite (currently only 11 Position/MintingHub actions).
- [ ] **Add `challengedAmount` consistency invariant** (MISS-3): `challengedAmount <= collateralBalance` for all positions.
- [ ] **Add savings interest cap invariant** (MISS-4): `distributedInterest <= equity()`.
- [ ] **Document fee-on-transfer/rebasing token risks**: Either add explicit validation in `openPosition()` or document as an accepted limitation.
- [ ] **Add `_maxPrice` parameter to `bid()`**: Currently bidders have no front-running protection in Phase 2 of Dutch auctions.

### Medium Priority

- [ ] **Document implicit allowance trust model**: The `allowance()` override is the most critical cross-contract mechanism. Any external integration (DEXes, lending protocols) must understand this.
- [ ] **Document WETH trust assumption**: Multiple functions assume WETH reverts on failure. This is hardcoded at MintingHub construction.
- [ ] **Add `nonReentrant` to Position._adjust()** or document why it's unnecessary: The `onlyOwner` restriction limits risk, but the state ordering after native ETH sends is technically vulnerable.
- [ ] **Review `rescueToken` reentrancy with exotic tokens**: The balance-check guard works for standard tokens but could be tricky with tokens that have multiple entry points.

### Low Priority

- [ ] **Fix ERC-20 approval race condition**: Standard OZ issue. Users should use `permit()` or `increaseAllowance`/`decreaseAllowance`.
- [ ] **Add monotonicity invariant for Leadrate ticks** (MISS-5).
- [ ] **Add nDEPS supply cap invariant** (MISS-6).
- [ ] **Consider `SafeERC20` wrappers**: Even though collateral is validated at admission, `SafeERC20` would provide defense-in-depth for the 13 unchecked transfer instances.

---

## Workflow Checklist

| Step | Status | Notes |
|------|--------|-------|
| ✅ Step 1: Slither scan | Complete | 19 High (1 real), 31 Medium (4 real), 47+ Low |
| ✅ Step 2: Special features | Complete | No upgradeability. ERC-20 conformant. Clone pattern verified. |
| ✅ Step 3: Visual inspection | Complete | Modifier coverage comprehensive. Feature matrix generated. |
| ⚠️ Step 4: Security properties | Partial | 10 invariants tested, 8 critical ones missing. No Echidna setup. |
| ✅ Step 5: Manual review | Complete | Front-running medium risk, DeFi interactions high priority, no crypto issues. |

---

## Trail of Bits Resources

- **Slither**: https://github.com/crytic/slither
- **Echidna**: https://github.com/crytic/echidna (not installed — recommend installing for property testing)
- **Building Secure Contracts**: https://github.com/crytic/building-secure-contracts
- **Office Hours**: Every Tuesday — https://meetings.hubspot.com/trailofbits/office-hours
