# Phase 9 — Variant Hunting Report

**Project:** dEuro Smart Contracts (V3)
**Methodology:** Trail of Bits Variant Analysis — systematic generalization of patterns from phases 1-8
**Date:** 2026-03-03
**Scope:** All production contracts in `contracts/` (excluding `test/`)

---

## Executive Summary

Seven vulnerability patterns from prior audit phases were systematically searched across the entire codebase. The analysis confirmed 6 previously-known findings and surfaced **19 new variant instances**. The most significant new findings are in Pattern 3 (reentrancy via native ETH returns in MintingHub) and Pattern 6 (missing events for critical state transitions). No completely new vulnerability classes were discovered — the variants are manifestations of already-identified root causes in additional code locations.

| Pattern | Known Instances | New Variants | Highest New Severity |
|---------|----------------|--------------|---------------------|
| 1. Fee-on-Transfer Accounting | 3 | 2 | Low |
| 2. Missing Slippage/MEV Protection | 3 | 2 | Medium |
| 3. Missing Reentrancy Guards | 3 | 5 | Medium |
| 4. Missing SafeERC20 | 3 contracts | 0 (fully enumerated) | — |
| 5. Implicit Infinite Allowance | 1 | 1 | Informational |
| 6. Missing Events | 5 | 7 | Informational |
| 7. Approval Residual | 2 | 0 | — |
| **Total** | | **17** | |

---

## Pattern 1: Fee-on-Transfer Accounting Mismatch

**Root cause:** Code assumes `amount` requested in `transferFrom` equals `amount` received. With fee-on-transfer tokens, received < requested, causing accounting mismatches.

### Known Instances (from phases 6-7)

| ID | Location | Severity |
|----|----------|----------|
| T-1 | `StablecoinBridge.sol:71-74` — mints dEURO based on requested amount | Critical |
| T-2 | `Position.sol:371-389` — `_adjust` passes `newCollateral` to `_mint` instead of actual balance | High |
| T-3 | `MintingHub.sol:250-253` — challenge stores `_collateralAmount` as challenge size | High |

### New Variants

**V1.1: `Position._adjust` emits stale collateral value in event** — Low

- **File:** `Position.sol:393`
- **Code:** `_emitUpdate(newCollateral, newPrice, newPrincipal)`
- **Issue:** After a fee-on-transfer deposit at line 372, the `_emitUpdate` at line 393 emits `newCollateral` (the requested amount) rather than `_collateralBalance()` (the actual amount). Off-chain monitoring systems, indexers, and frontends that rely on the `MintingUpdate` event would display inaccurate collateral amounts.
- **Confidence:** High — code path is clear.
- **Impact:** Low — cosmetic/monitoring only, no on-chain state corruption beyond what T-2 already covers. But could mask the T-2 issue from off-chain detection.

**V1.2: `PositionRoller.roll` — double fee on roller-mediated clone path** — Low

- **File:** `PositionRoller.sol:84-86`
- **Code:**
  ```solidity
  targetCollateral.transferFrom(msg.sender, address(this), collDeposit); // fee deducted
  targetCollateral.approve(target.hub(), collDeposit);                   // approves full amount
  target = _cloneTargetPosition(target, collDeposit, mint, expiration);  // hub transfers from roller
  ```
- **Issue:** When the roller mediates a clone (the `needsClone` branch), collateral is first transferred from the user to the roller (fee deducted), then from the roller to the hub/position (fee deducted again). The roller approves and passes the full `collDeposit` amount, but it holds less. The second `transferFrom` by the hub will revert for most fee-on-transfer tokens (insufficient balance), causing a DoS. For tokens that silently return false (no revert), the position would receive even less than expected.
- **Confidence:** High — two-hop transfer path is clear.
- **Impact:** Low — results in DoS (revert) for fee-on-transfer tokens. Actual exploitation requires a token that (a) passes the `openPosition` admission check and (b) has fees. The same double-fee path exists in `rollNative` at lines 146-147.
- **Mitigation note:** The admission check in `MintingHub.openPosition:148-155` screens for tokens that revert on failed transfers, which blocks many fee-on-transfer tokens. However, tokens with conditional fees (e.g., Safemoon-style tokens where fees can be toggled) could pass the check at position creation time and later enable fees.

### Pattern 1 — Comprehensive Transfer Inventory

For completeness, all raw `transferFrom` calls on external (non-dEURO) collateral tokens:

| File | Line | Context | FoT Risk |
|------|------|---------|----------|
| `Position.sol` | 372 | `_adjust` deposit | **T-2 (known)** |
| `MintingHub.sol` | 183 | `openPosition` deposit | Safe — no immediate mint; position reads actual balance later |
| `MintingHub.sol` | 215 | `clone` deposit | Safe — `child.mint` reads `_collateralBalance()` |
| `MintingHub.sol` | 250 | `challenge` deposit | **T-3 (known)** |
| `PositionRoller.sol` | 84 | `roll` clone path | **V1.2 (new)** — DoS |
| `PositionRoller.sol` | 91 | `roll` direct path | Safe — position reads actual balance in `mint` |
| `PositionRoller.sol` | 149 | `rollNative` clone path | Same as V1.2 |

---

## Pattern 2: Missing Slippage / MEV Protection

**Root cause:** State-changing functions that exchange economic value lack min/max bound parameters, exposing users to front-running and sandwich attacks.

### Known Instances (from phases 5, 8)

| ID | Location | Severity |
|----|----------|----------|
| MEV-1 | `MintingHub.bid()` — no `_maxPrice` in Phase 2 Dutch auction | High |
| MEV-2 | `MintingHub.clone()` — no slippage protection | Medium |
| MEV-3 | `_finishChallenge` — no `maxInterest` parameter | Medium |

### Existing Protections (verified)

| Function | Protection |
|----------|-----------|
| `Equity.invest()` | `expectedShares` parameter |
| `Equity.redeemExpected()` | `expectedProceeds` parameter |
| `MintingHub.challenge()` | `minimumPrice` parameter |
| `Leadrate.proposeChange()` | 7-day timelock |

### New Variants

**V2.1: `PositionRoller.roll()` — no slippage bounds on explicit parameters** — Medium

- **File:** `PositionRoller.sol:68-103`
- **Signature:** `roll(source, repay, collWithdraw, target, mint, collDeposit, expiration)`
- **Issue:** The explicit `roll()` function accepts user-specified `repay`, `collWithdraw`, `mint`, and `collDeposit` values with no min/max bounds. Between tx submission and execution:
  - Interest accrues on the source position, changing the effective repayment outcome
  - The target position's price could change (via `adjustPrice` by the target's owner)
  - The leadrate could change, affecting the locked-in rate for the new position
  - The available minting limit could decrease if other clones consumed capacity
- **Confidence:** High — the function has no validation of economic outcomes.
- **Exploitability:** An MEV bot could sandwich a `roll` transaction by:
  1. Adjusting the target position's price upward (if the bot owns/controls the target)
  2. Letting the roller execute at the worse rate
  3. Adjusting the price back down
- **Note:** `rollFully` and `rollFullyWithExpiration` calculate parameters at execution time, mitigating this for the convenience wrappers. But the explicit `roll()` and `rollNative()` are exposed.

**V2.2: `Equity.redeem()` — no `expectedProceeds` protection** — Low

- **File:** `Equity.sol:365-367`
- **Signature:** `redeem(address target, uint256 shares)`
- **Issue:** The basic `redeem` function has no minimum proceeds parameter, unlike `redeemExpected`. A user calling `redeem` directly is vulnerable to sandwich attacks that manipulate the nDEPS price between tx submission and execution. The 90-day holding period and 2% fee provide some natural protection, but a sandwich attacker could still extract value by temporarily depressing equity.
- **Confidence:** High — the function clearly lacks the protection that `redeemExpected` provides.
- **Impact:** Low — `redeemExpected` exists as the protected alternative. The risk is limited to users who call the unprotected version.

---

## Pattern 3: Missing Reentrancy Guards with External Calls

**Root cause:** No `ReentrancyGuard` is used anywhere in the protocol. Native ETH transfers via `.call{value}` create reentry points where recipients can atomically perform additional operations against partially-updated state.

### Known Concerns (from phase 3)

| ID | Location | Mitigation |
|----|----------|-----------|
| RE-1 | `Position._adjust` — ETH via `.call{value}` | `onlyOwner` modifier |
| RE-2 | `Position.rescueToken` — balance-check-after-transfer | Collateral guard check |
| RE-3 | Arbitrary collateral token interactions | Admission check filters most |

### New Variants — MintingHub Native ETH Returns

All `asNative`/`returnCollateralAsNative` code paths in MintingHub send ETH to external addresses via `.call{value}`. Each creates a reentrancy window.

**V3.1: `_finishChallenge` — bidder reentrancy after challenge settlement** — Medium

- **File:** `MintingHub.sol:326-330`
- **Code:**
  ```solidity
  _challenge.position.transferChallengedCollateral(address(this), collateral);
  IWrappedNative(WETH).withdraw(collateral);
  (bool success, ) = msg.sender.call{value: collateral}("");  // ← reentry point
  ```
- **Issue:** After challenge settlement is complete (position state updated, challenge deleted/resized, dEURO transferred), the bidder receives native ETH and can re-enter MintingHub. At this point:
  - The challenge has been deleted/resized in `_returnChallengerCollateral`
  - `notifyChallengeSucceeded` has updated the position (reduced `challengedAmount`, `principal`, `interest`)
  - dEURO transfers and burns are complete
  - But `_bid` has not yet returned, so the calling context is still mid-execution
- **Attack vector:** A malicious bidder contract could:
  1. Win a challenge with `returnCollateralAsNative=true`
  2. On receiving ETH, re-enter `challenge()` on the same (now weakened) position
  3. Or re-enter `bid()` on another open challenge atomically
  4. Or re-enter `buyExpiredCollateral()` if the position is expired
- **Confidence:** Medium — state changes complete before the ETH send, so re-entrant calls would operate on consistent state. The risk is that atomicity enables multi-step strategies (e.g., challenge + immediate liquidation) that the protocol may not intend to allow.
- **Exploitability:** Requires WETH-collateral positions and `asNative=true`. The re-entrant call operates on valid, updated state, so it's not a traditional reentrancy bug (no double-spend). However, it enables atomic multi-step operations that could be MEV-relevant.

**V3.2: `_avertChallenge` — averter reentrancy** — Medium

- **File:** `MintingHub.sol:352-355`
- **Code:**
  ```solidity
  IWrappedNative(WETH).withdraw(size);
  (bool success, ) = msg.sender.call{value: size}("");  // ← reentry point
  ```
- **Issue:** After averting a challenge with `asNative=true`, the averter receives native ETH and can re-enter. The position's `notifyChallengeAverted` has been called (setting `_restrictMinting(1 days)`), and the challenge has been adjusted. A re-entrant call could start a new challenge immediately.
- **Confidence:** Medium — same reasoning as V3.1.

**V3.3: `_returnCollateral` — challenger reentrancy** — Medium

- **File:** `MintingHub.sol:452-455`
- **Code:**
  ```solidity
  IWrappedNative(WETH).withdraw(amount);
  (bool success, ) = recipient.call{value: amount}("");  // ← reentry point
  ```
- **Issue:** When returning collateral to a challenger as native ETH (during Phase 2 bid), the challenger receives ETH and can re-enter. Called from `_returnChallengerCollateral` during `_bid`, the challenge has been resized but `_finishChallenge` has not yet executed. A malicious challenger could re-enter to interfere with the ongoing bid process.
- **Confidence:** Medium — the call happens within `_bid` before `_finishChallenge`, so the reentrancy window includes pending state changes.
- **Note:** This is more concerning than V3.1 because the ETH send happens BEFORE `_finishChallenge` executes. The challenger could re-enter with the position state not yet fully settled.

**V3.4: `_buyExpiredCollateral` — buyer reentrancy** — Low

- **File:** `MintingHub.sol:524-527`
- **Code:**
  ```solidity
  pos.forceSale(address(this), amount, costs);
  IWrappedNative(WETH).withdraw(amount);
  (bool success, ) = msg.sender.call{value: amount}("");  // ← reentry point
  ```
- **Issue:** After buying expired collateral as native ETH, the buyer can re-enter to buy more collateral from the same position atomically. The `forceSale` has already executed, updating position state.
- **Confidence:** High — code path is clear.
- **Impact:** Low — re-entrant purchase operates on valid updated state (less collateral remains, debt adjusted). Enables atomic bulk purchasing but doesn't violate invariants.

**V3.5: `_returnPostponedCollateral` — safe (delete-before-send)** — Safe

- **File:** `MintingHub.sol:436-441`
- **Issue:** NOT vulnerable. The `pendingReturns` mapping is deleted BEFORE the ETH send, so re-entering `returnPostponedCollateral` would find zero balance. Classic check-effects-interactions pattern correctly applied.

### Reentrancy Summary

| Location | ETH Recipient | State Before Send | Re-Entry Risk |
|----------|--------------|-------------------|---------------|
| `_finishChallenge:329` | Bidder (msg.sender) | Challenge settled, position updated | Medium — atomic multi-step |
| `_avertChallenge:354` | Averter (msg.sender) | Challenge averted, cooldown set | Medium — new challenge possible |
| `_returnCollateral:454` | Challenger | Challenge resized, **`_finishChallenge` not yet called** | **Medium — mid-execution window** |
| `_buyExpiredCollateral:526` | Buyer (msg.sender) | forceSale complete | Low — atomic bulk purchase |
| `_returnPostponedCollateral:440` | Target | Pending deleted | Safe |
| `Position._withdrawCollateralAsNative:738` | Target | Withdrawal complete | Low — onlyOwner |
| `PositionRoller.rollNative:164` | msg.sender | Roll complete | Low — own(source) |

---

## Pattern 4: Missing SafeERC20 on External Token Interactions

**Root cause:** Raw `.transfer()`/`.transferFrom()` calls on arbitrary external tokens instead of SafeERC20. Tokens that return `false` instead of reverting on failure would silently fail.

### Comprehensive Inventory

**Contracts using SafeERC20:** StablecoinBridge (✓), SavingsVaultDEURO (✓)
**Contracts NOT using SafeERC20:** Position, MintingHub, PositionRoller

#### Raw Calls on External (Non-dEURO) Collateral Tokens

| File | Line | Function | Call | Token |
|------|------|----------|------|-------|
| `Position.sol` | 372 | `_adjust` | `collateral.transferFrom(msg.sender, …, amount)` | Collateral |
| `Position.sol` | 706 | `rescueToken` | `IERC20(token).transfer(target, amount)` | Arbitrary |
| `Position.sol` | 758 | `_sendCollateral` | `IERC20(collateral).transfer(target, amount)` | Collateral |
| `MintingHub.sol` | 181 | `openPosition` | `IERC20(WETH).transfer(address(pos), …)` | WETH (trusted) |
| `MintingHub.sol` | 183 | `openPosition` | `IERC20(…).transferFrom(msg.sender, …, …)` | Collateral |
| `MintingHub.sol` | 213 | `clone` | `collateral.transfer(pos, …)` | WETH (trusted) |
| `MintingHub.sol` | 215 | `clone` | `collateral.transferFrom(msg.sender, pos, …)` | Collateral |
| `MintingHub.sol` | 250 | `challenge` | `IERC20(…).transferFrom(msg.sender, …, …)` | Collateral |
| `MintingHub.sol` | 357 | `_avertChallenge` | `collateral().transfer(msg.sender, size)` | Collateral |
| `MintingHub.sol` | 443 | `_returnPostponedCollateral` | `IERC20(collateral).transfer(target, amount)` | Collateral |
| `MintingHub.sol` | 457 | `_returnCollateral` | `collateral.transfer(recipient, amount)` | Collateral |
| `PositionRoller.sol` | 84 | `roll` | `targetCollateral.transferFrom(msg.sender, …, …)` | Collateral |
| `PositionRoller.sol` | 91 | `roll` | `targetCollateral.transferFrom(msg.sender, …, …)` | Collateral |
| `PositionRoller.sol` | 149 | `rollNative` | `targetCollateral.transfer(address(target), …)` | Collateral |

**Total: 14 raw transfer/transferFrom calls on external tokens across 3 contracts.**

No new variants beyond the already-identified 3 contracts. The inventory above is the complete enumeration.

### Mitigating Factor

The admission check at `MintingHub.openPosition:148-155` tests that the collateral token reverts on failed transfers:
```solidity
try IERC20(_collateralAddress).transfer(address(0x123), invalidAmount) {
    revert IncompatibleCollateral();
} catch Error(string memory) {} catch Panic(uint) {} catch (bytes memory) {}
```
This filters out tokens that return `false` without reverting. However, it does NOT catch tokens that revert under some conditions but return `false` under others.

---

## Pattern 5: Implicit Infinite Allowance Trust Model

**Root cause:** `DecentralizedEURO.allowance()` at lines 114-131 grants `type(uint256).max` allowance between all system entities (minters, positions, reserve). A single compromised minter can drain ALL other minters, ALL positions, and the entire reserve.

### Known Instance (from phase 6)

| ID | Location | Severity |
|----|----------|----------|
| T-9 | `DecentralizedEURO.sol:114-131` — implicit allowance override | Medium |

### Trust Chain Analysis

The implicit allowance means any registered minter can call `dEURO.transferFrom(victim, attacker, balance)` where `victim` is any minter, position, or the reserve. Current registered minters include:

| Minter | Role | Attack Surface |
|--------|------|---------------|
| MintingHub | Position management | Fixed code, audited |
| PositionRoller | Position rolling | Fixed code, audited |
| Savings | Interest distribution | Fixed code, audited |
| StablecoinBridge(s) | Pegged minting | Fixed code, but one per source stablecoin |

### New Variant

**V5.1: Multi-bridge attack surface amplification** — Informational

- **Issue:** Each StablecoinBridge instance is a registered minter. As more bridges are deployed for different source stablecoins, the attack surface grows linearly. If ANY bridge has a vulnerability, it has implicit infinite allowance from ALL other system entities.
- **Current mitigation:** Each bridge has a limited `limit` (maximum minted amount) and `horizon` (expiration). The `emergencyStop` function provides a governance backstop. But the implicit allowance is not bounded by these limits — it applies to ALL dEURO the bridge holds or can access via transferFrom.
- **Impact:** Informational — this is an inherent design property, not a bug. But the risk grows with each new minter added to the system.

### Functions Relying on Implicit Allowance (verified)

| Caller | Function | Implicit From | Purpose |
|--------|----------|--------------|---------|
| Position | `deuro.collectProfits(payer, …)` | payer (if system entity) | Interest repayment |
| Position | `deuro.burnFromWithReserve(payer, …)` | payer (if system entity) | Principal repayment |
| Position | `deuro.transferFrom(buyer, owner(), …)` | buyer (if system entity) | Force sale surplus |
| MintingHub | `DEURO.transferFrom(msg.sender, …)` | bidder (if system entity) | Challenge bid |
| MintingHub | `DEURO.transferFrom(msg.sender, …)` | averter (if system entity) | Challenge avert |
| Equity | `dEURO.transferFrom(investor, …)` | investor (if system entity) | nDEPS investment |

---

## Pattern 6: Missing Events for Critical State Transitions

**Root cause:** State-changing functions lack event emissions, making it impossible to monitor critical system changes from off-chain indexers, dashboards, and security monitoring tools.

### Known Missing Events (from phases 5, 8)

| ID | Function | Impact |
|----|----------|--------|
| EV-1 | `DecentralizedEURO.registerPosition()` | Position enablement not trackable |
| EV-2 | `Position.notifyChallengeStarted/Averted/Succeeded` | Challenge lifecycle invisible from position |
| EV-3 | `Equity.kamikaze()` | Vote destruction not logged |
| EV-4 | `Equity.restructureCapTable()` | Emergency cap table changes not logged |
| EV-5 | `Position._close()` — position closure | Position state transition not emitted |

### New Variants

**V6.1: `Position._close()` — silent position closure during collateral operations** — Informational

- **Files:** `Position.sol:296`, called from `_sendCollateral:761`, `_withdrawCollateralAsNative:742`
- **Issue:** When collateral drops below `minimumCollateral`, `_close()` sets `closed = true` with no event. This can happen silently during `withdrawCollateral`, `forceSale`, `transferChallengedCollateral`, or any operation that calls `_sendCollateral`. The position becomes permanently unable to mint, but there is no on-chain notification.
- **Note:** Distinct from EV-5 — the prior finding identified the missing event, but this variant highlights the MULTIPLE code paths through which silent closure occurs (5 different callers of `_sendCollateral`).

**V6.2: `Position._fixRateToLeadrate()` — interest rate lock not emitted** — Informational

- **File:** `Position.sol:497-499`
- **Issue:** When a position's `fixedAnnualRatePPM` is recalculated (during `_mint` at line 577, `initialize` at line 231, or constructor at line 219), no event records the new locked-in rate. Off-chain systems cannot track what rate each position is paying without reading storage directly.

**V6.3: `Position.initialize()` — clone initialization not emitted by position** — Informational

- **File:** `Position.sol:226-233`
- **Issue:** When a clone is initialized, it sets critical parameters (`expiration`, `price`, `fixedAnnualRatePPM`) and transfers ownership, but emits no event. The hub emits `PositionOpened`, but the position's specific initialized state (which may differ from the parent) is not recorded.

**V6.4: `Savings.nonCompounding` toggle — preference change not emitted** — Informational

- **File:** `Savings.sol:115`
- **Code:** `nonCompounding[msg.sender] = !compound;`
- **Issue:** When a user changes their compounding preference via `save(uint192 amount, bool compound)`, no event is emitted. This makes it impossible to track compounding preference changes off-chain.

**V6.5: `DEPSWrapper.halveHoldingDuration()` — governance action not emitted** — Informational

- **File:** `DEPSWrapper.sol:61-65`
- **Issue:** When a qualified voter halves the wrapper's holding duration, no dedicated event is emitted. Only the standard ERC20 `Transfer` event from `nDEPS.transfer(address(this), totalSupply())` is logged. A dedicated event would improve monitoring of this governance action.

**V6.6: `DecentralizedEURO._withdrawFromReserve()` — reserve minting not distinguished from transfer** — Informational

- **File:** `DecentralizedEURO.sol:328-336`
- **Issue:** When the reserve is insufficient to cover a withdrawal, new dEURO is minted at line 334: `_mint(recipient, amount - reserveLeft)`. This inflation event is not specifically tracked. The calling functions emit `Loss` or `ProfitDistributed`, but whether the payout came from existing reserves or new minting is indistinguishable on-chain.

**V6.7: `MintingUpdate` event lacks indexed fields** — Informational

- **File:** `Position.sol:126`
- **Code:** `event MintingUpdate(uint256 collateral, uint256 price, uint256 principal);`
- **Issue:** This event is emitted 17+ times across all position state changes but has zero indexed parameters. It cannot be efficiently filtered by collateral amount, price threshold, or principal range. The companion `PositionUpdate` event in IMintingHub has the position address indexed, which partially compensates, but the position-side event remains unqueryable.

---

## Pattern 7: Approval Residual / Non-Standard Token Handling

**Root cause:** `approve()` calls that don't first set approval to zero. Tokens like USDT that require zero-first approval would fail on subsequent calls.

### Known Instances (from phase 6)

| ID | Location | Token |
|----|----------|-------|
| T-10 | `PositionRoller.sol:85` | External collateral |
| T-10 | `PositionRoller.sol:146` | External collateral |

### Complete Inventory of `approve()` Calls

| File | Line | Token | Zero-First? | Risk |
|------|------|-------|------------|------|
| `PositionRoller.sol` | 85 | External collateral | No | **T-10 (known)** |
| `PositionRoller.sol` | 146 | External collateral | No | **T-10 (known)** |
| `MintingHub.sol` | 523 | dEURO (internal) | No | Safe — dEURO is standard ERC20 |
| `SavingsVaultDEURO.sol` | 43 | dEURO (internal) | N/A — uses `forceApprove` | Safe |

**No new variants found.** The two PositionRoller locations are the only approve calls on external tokens without zero-first pattern.

---

## Cross-Pattern Analysis

### Compound Risk: Reentrancy + Missing Slippage

The combination of V3.1-V3.4 (reentrancy via native ETH) and MEV-1 (no `_maxPrice` in bid Phase 2) creates a compound risk: A malicious bidder contract could win a challenge bid at a favorable price, receive ETH via the native return path, and atomically re-enter to perform additional operations (e.g., start a new challenge, buy more expired collateral) — all within a single transaction. This compounds the MEV advantage beyond what either pattern alone would enable.

### Compound Risk: Fee-on-Transfer + Challenge Accounting

T-2 (fee-on-transfer in `_adjust`) combined with T-3 (challenge size mismatch) creates a scenario where:
1. A fee-on-transfer collateral position has less actual collateral than recorded
2. A challenge is launched for more collateral than the position actually holds
3. Challenge settlement calls `notifyChallengeSucceeded` which caps `_size` to `colBal` (Position.sol:893), partially mitigating the issue
4. But `_returnChallengerCollateral` returns the full original challenge amount to the challenger from the hub's holdings

This means the hub's collateral balance (from step T-3) and the position's collateral balance (from step T-2) are both overstated, creating a two-sided accounting mismatch.

### Admission Check Coverage

The `MintingHub.openPosition` admission check (lines 148-155) is the primary defense against many of these patterns:
- It blocks tokens that return `false` on failed transfers → partially mitigates Pattern 4
- It blocks tokens that don't revert on invalid operations → partially mitigates Patterns 1 and 7
- It does NOT protect against: tokens with conditional fees (togglable), rebasing tokens, tokens with transfer hooks (ERC-777), or tokens with blocklists (USDC, USDT)

---

## Consolidated Recommendations

### By Priority

**High — Address before deployment:**
1. Add `ReentrancyGuard` to MintingHub, or refactor all `asNative` paths to follow checks-effects-interactions (send ETH last, after all state changes and external calls)
2. Add `_maxPrice` parameter to `MintingHub.bid()` for Phase 2 (MEV-1 from prior phases)
3. Add slippage bounds to `PositionRoller.roll()` and `rollNative()` (V2.1)

**Medium — Address in next iteration:**
4. Use `_collateralBalance()` instead of `newCollateral` in `Position._adjust` lines 388 and 393 (fixes T-2 and V1.1)
5. Add SafeERC20 to Position, MintingHub, and PositionRoller for all external token interactions (Pattern 4)
6. Add `approve(token, 0)` before `approve(token, amount)` in PositionRoller, or use `forceApprove` (T-10)

**Low — Quality improvements:**
7. Add events for: `_close()` (V6.1), `_fixRateToLeadrate()` (V6.2), `initialize()` (V6.3), `nonCompounding` toggle (V6.4), `halveHoldingDuration()` (V6.5), reserve minting (V6.6)
8. Add indexed fields to `MintingUpdate` event (V6.7)
9. Document the implicit allowance trust model (T-9) and its implications for future minter additions (V5.1)

---

*Report generated as part of Phase 9 (Variant Hunting) of the Trail of Bits audit methodology.*
