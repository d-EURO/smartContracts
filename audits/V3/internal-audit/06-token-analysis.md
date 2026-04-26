# Token Integration Analysis Report — dEuro Smart Contracts

**Project:** dEuro (Decentralized Euro Stablecoin Protocol)
**Scope:** All contracts in `contracts/` (excluding `contracts/test/`)
**Platform:** Solidity ^0.8.0 (compiled with 0.8.26), Foundry + Hardhat
**Analysis Date:** 2026-03-03
**Method:** Slither `slither-check-erc` + manual code review against Trail of Bits' Token Integration Checklist + Weird ERC20 Database

---

## Executive Summary

**Token Type:** ERC-20 Implementation (5 tokens) + Protocol Integrating External Tokens (4 contracts)
**Overall Risk Level:** MEDIUM-HIGH

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 4 |
| Medium | 5 |
| Low | 4 |
| Informational | 5 |

**Top Concerns:**
- Fee-on-transfer collateral tokens silently break accounting in Position, MintingHub, PositionRoller, and StablecoinBridge
- No `SafeERC20` in Position, MintingHub, or PositionRoller — tokens returning `false` instead of reverting are silently accepted
- DecentralizedEURO `allowance()` override grants unlimited implicit allowance across all minters/positions/reserve, making a compromised minter a system-wide drain risk
- Rebasing collateral tokens break challenge accounting (`challengedAmount` becomes stale)
- Approval residual in `buyExpiredCollateral` and PositionRoller

---

## 1. General Considerations

| Check | Status | Notes |
|-------|--------|-------|
| Security review conducted | Pending | This analysis is part of the audit |
| Team publicly accountable | Unknown | -- |
| Bug bounty or security contact | Unknown | -- |
| Security mailing list | Unknown | -- |

---

## 2. Contract Composition

### Slither `--print human-summary` Results

| Contract | Functions | SLOC | ERCs | Complex Code | Features |
|----------|-----------|------|------|-------------|----------|
| DecentralizedEURO | 99 | -- | ERC20, ERC165, ERC2612 | No | Ecrecover, Tokens interaction |
| Equity | 95 | -- | ERC20, ERC165, ERC2612 | No | Ecrecover, Tokens interaction |
| MintingHub | 47 | -- | ERC165 | **Yes** | Receive ETH, Send ETH, Tokens interaction |
| Position | 121 | -- | -- | **Yes** | Receive ETH, Send ETH, Tokens interaction |
| PositionRoller | 10 | -- | -- | No | Receive ETH, Send ETH, Tokens interaction |
| Savings | 18 | -- | -- | No | Tokens interaction |
| SavingsVaultDEURO | 77 | -- | ERC20, ERC4626 | No | Tokens interaction |
| StablecoinBridge | 10 | -- | -- | No | Tokens interaction |
| DEPSWrapper | 59 | -- | ERC20, ERC2612 | No | Ecrecover, Tokens interaction |
| BridgedToken | 69 | -- | ERC20, ERC165, ERC2612 | No | Ecrecover |

**Aggregate:** 2205 SLOC in source, 24 contracts. Slither reports 39 high, 65 medium, 106 low, 151 informational (includes dependencies).

### SafeMath / Overflow Protection

- Solidity 0.8.26 with built-in overflow protection.
- No `unchecked` blocks in production contracts (only in test code).
- All arithmetic operations protected.

**Status:** PASS

### Non-Token Functions

Position.sol (121 functions) and MintingHub.sol (47 functions) are the highest-complexity contracts. Position is the largest attack surface with the most state-changing logic.

---

## 3. Owner Privileges

### DecentralizedEURO (dEURO)

| Privilege | Actor | Risk |
|-----------|-------|------|
| Unlimited minting | Any registered minter | **By design** — minters are governance-approved via time-delay application |
| Unlimited burning from any minter/position/reserve | Any registered minter | Via implicit allowance override |
| Cover losses (mint from reserve or inflate) | Any registered minter | `_withdrawFromReserve` can mint new dEURO if reserve is empty |
| Wipe nDEPS balances | Qualified voters (2% quorum, equity < 1000 dEURO) | Emergency-only `restructureCapTable` |

**Assessment:** No single admin. Governance is decentralized through minter registry with time-delay and veto. However, once a minter is approved, it has extensive power over the token. The implicit allowance mechanism is a design trade-off that increases systemic risk from compromised minters.

### Equity (nDEPS)

| Privilege | Actor | Risk |
|-----------|-------|------|
| No supply cap | N/A | Supply capped at `type(uint96).max` in `_invest()` |
| `restructureCapTable` | Qualified voters during crisis | Can burn anyone's shares without consent |
| `investFor` | Registered minters only | Can invest on behalf of another address |

### BridgedToken

| Privilege | Actor | Risk |
|-----------|-------|------|
| Unlimited minting | Bridge address (immutable) | Bridge can mint without cap |
| Burn from any address | Bridge address (immutable) | No allowance check — bridge is fully trusted |

**Assessment:** Standard Optimism bridge pattern. Bridge address cannot be changed post-deployment.

### SavingsVaultDEURO

| Privilege | Actor | Risk |
|-----------|-------|------|
| None | -- | Fully permissionless |
| Infinite approval to SAVINGS | Set at construction | Required for operation |

**Status:** ACCEPTABLE — governance is decentralized, privileges are appropriately gated.

---

## 4. ERC-20 Conformity

### Slither `slither-check-erc` Results

**DecentralizedEURO:** ALL CHECKS PASS
```
[OK] totalSupply(), balanceOf(), transfer(), transferFrom(), approve(), allowance()
[OK] All return types correct
[OK] Transfer and Approval events properly indexed
[ ] Not protected for ERC20 approval race condition
```

**Equity (nDEPS):** ALL CHECKS PASS
```
[OK] totalSupply(), balanceOf(), transfer(), transferFrom(), approve(), allowance()
[OK] All return types correct
[OK] Transfer and Approval events properly indexed
[ ] Not protected for ERC20 approval race condition
```

**ERC20 Interface Check:** `slither . --detect erc20-interface` → 0 violations found.

### Approval Race Condition

Both DecentralizedEURO and Equity lack `increaseAllowance`/`decreaseAllowance`. Mitigated by:
- ERC-2612 `permit()` support on both contracts
- ERC-3009 `transferWithAuthorization` on both contracts

**Risk:** LOW — standard mitigations are in place.

### Custom Allowance Override (DecentralizedEURO)

`DecentralizedEURO.allowance()` at L114-131 returns `type(uint256).max` when:
1. `spender == reserve` → always infinite
2. `spender` is a minter or child position of a minter, AND `owner` is a minter, registered position, or reserve

**Implications:**
- All registered minters and their positions can `transferFrom` each other's dEURO without explicit approval
- A compromised or malicious minter contract can drain dEURO from ALL other minters, positions, and the reserve
- This is **by design** but creates a **systemic trust coupling**: the security of every minter depends on every other minter

### Custom `_update` Hook (Equity)

Every nDEPS transfer triggers vote anchor recalculation in `_update()`. This:
- Adjusts recipient vote anchor to preserve time-weighted votes proportionally
- Updates global total votes tracking
- Can lose votes due to integer rounding (documented in code)
- No external calls — pure storage writes

**Status:** ERC-20 FULLY COMPLIANT (with noted advisory on approval race condition)

---

## 5. ERC-20 Extension Risks

### ERC-3009 (DecentralizedEURO, Equity, BridgedToken)

- `transferWithAuthorization`, `receiveWithAuthorization`, `cancelAuthorization`
- Uses ECDSA signature verification via OpenZeppelin
- Nonce-based replay protection
- `receiveWithAuthorization` requires `to == msg.sender` (front-running protection)

**Risk:** LOW — standard implementation.

### ERC-4626 (SavingsVaultDEURO)

- Inherits OpenZeppelin's virtual shares pattern for inflation attack mitigation
- `_decimalsOffset()` adds virtual shares to prevent first-depositor manipulation
- `totalAssets()` overridden to include accrued interest from Savings module
- `_deposit` does transfer-before-mint (CEI for reentrancy)
- `_withdraw` does burn-before-withdrawal (CEI for reentrancy)
- Uses `SafeERC20.safeTransferFrom` for deposits
- `_accrueInterest()` only updates `totalClaimed` counter — does NOT actually claim from Savings

**Note:** SavingsVaultDEURO does NOT implement ERC-2612 (`permit`), unlike all other token contracts. This means vault shares cannot be approved gaslessly. This is inconsistent with the rest of the protocol.

**Risk:** LOW for the vault itself. INFORMATIONAL for missing permit.

### No ERC-777 Hooks

None of the protocol tokens implement ERC-777. No reentrant transfer hooks.

---

## 6. Token Scarcity Analysis

| Token | Supply Cap | Flash Mintable | Notes |
|-------|-----------|----------------|-------|
| dEURO | No hard cap | Yes (PositionRoller flash mint) | Supply controlled by minter economics |
| nDEPS | `type(uint96).max` (~7.9e28) | No | Bonding curve with 5th-root dampening |
| DEPS | Mirrors nDEPS | No | 1:1 wrapper |
| BridgedToken | No hard cap | No | Bridge-only minting |
| SavingsVault | No hard cap | No | Shares mint/burn with deposits/withdrawals |

**Flash Mint Risk:** PositionRoller uses `deuro.mint(address(this), repay)` as a flash loan, then `deuro.burnFrom(msg.sender, repay)` at the end. If the burn fails or underpays, dEURO supply inflates. Mitigated by the roller being a registered minter with the implicit allowance system.

---

## 7. Weird ERC-20 Pattern Analysis

This section analyzes how the protocol handles each known weird token pattern when external tokens are used as **collateral** in positions or as **source stablecoins** in the bridge.

### 7.1 Reentrant Calls (ERC-777 hooks)

**Risk:** MEDIUM

Position.sol, MintingHub.sol, and PositionRoller.sol do not implement reentrancy guards. If an ERC-777 token were used as collateral, the `tokensToSend` and `tokensReceived` hooks could trigger reentrant calls during:
- `collateral.transferFrom()` in `Position._adjust()` (L372)
- `collateral.transfer()` in `Position._sendCollateral()` (L758)
- `collateral.transferFrom()` in `MintingHub.challenge()` (L250)

**Mitigation:** The `openPosition` check at MintingHub L148-155 may catch some ERC-777 behavior if the test transfer triggers hooks that revert. However, ERC-777 tokens that DON'T revert on the test amount could still be used. No explicit `nonReentrant` guards exist.

### 7.2 Missing Return Values (USDT-style)

**Risk:** HIGH

| Contract | Uses SafeERC20 | Affected |
|----------|---------------|----------|
| Position.sol | No | Yes — raw `IERC20.transfer()`/`transferFrom()` |
| MintingHub.sol | No | Yes — raw `IERC20.transfer()`/`transferFrom()` |
| PositionRoller.sol | No | Yes — raw `IERC20.transfer()`/`transferFrom()` |
| StablecoinBridge.sol | **Yes** | No |
| Savings.sol | No | No (only touches dEURO) |
| SavingsVaultDEURO.sol | **Yes** | No |

In Solidity 0.8+, calling `IERC20(token).transfer()` on a token that does NOT return a `bool` (like USDT on Ethereum mainnet) will revert at the ABI decoding step. This makes the protocol **incompatible** with such tokens as collateral.

**However:** The MintingHub `openPosition` check (L148-155) validates that the collateral token reverts on failed transfers by attempting an invalid transfer. Tokens that don't return `bool` will also fail this test (the ABI decode failure is a revert). So these tokens are effectively **excluded at position creation time**, though the exclusion reason is opaque.

**Risk for protocol-internal tokens (dEURO transfers):** The dEURO token itself returns `bool` properly, so raw calls between system contracts (Savings, Equity, MintingHub transferring dEURO) are safe. This is an acceptable pattern since dEURO is a known, controlled token.

**Recommendation:** Add SafeERC20 to Position, MintingHub, and PositionRoller for all external token interactions, OR document clearly that non-standard-return tokens are intentionally excluded.

### 7.3 Fee-on-Transfer Tokens

**Risk:** CRITICAL

**Position.sol** — `_adjust()` at L371-372:
```solidity
if (newCollateral > colbal) {
    collateral.transferFrom(msg.sender, address(this), newCollateral - colbal);
}
```
The contract requests `newCollateral - colbal` but may receive less due to fees. Subsequent logic uses `newCollateral` as the expected balance. However, `_checkCollateral()` inside `_mint()` reads the actual `balanceOf`, which provides partial protection — but `_adjust()` calls `_setPrice()` with `newCollateral` (L389), not the actual balance:
```solidity
_setPrice(newPrice, newCollateral);
```
This means the price bounds check uses an inflated collateral value, potentially allowing a higher price than the real collateral supports.

**MintingHub.sol** — `challenge()` at L250:
```solidity
IERC20(collateralAddr).transferFrom(msg.sender, address(this), _collateralAmount);
```
The challenge stores `_collateralAmount` as the challenge size, but the hub may hold less due to fees. When the challenge is averted and collateral returned, the hub attempts to return the full `_collateralAmount`, which could fail (insufficient balance) or succeed at the expense of other challengers' collateral.

**StablecoinBridge.sol** — `mintTo()` at L71:
```solidity
eur.safeTransferFrom(msg.sender, address(this), amount);
uint256 targetAmount = _convertAmount(amount, eurDecimals, dEURODecimals);
_mint(target, targetAmount);
```
The bridge mints dEURO based on the requested `amount`, not the actually received amount. A fee-on-transfer source stablecoin would create **unbacked dEURO**. No balance-before/after check exists.

**PositionRoller.sol** — `roll()` at L84:
```solidity
targetCollateral.transferFrom(msg.sender, address(this), collDeposit);
targetCollateral.approve(target.hub(), collDeposit);
```
Approves the full requested amount, but holds less. The subsequent `clone()` call may fail or produce an undercollateralized position.

**Recommendation:** Add balance-before/after patterns for all external token transfers. At minimum, document that fee-on-transfer tokens are not supported and add explicit validation.

### 7.4 Balance Modifications Outside Transfers (Rebasing)

**Risk:** HIGH

**Upward rebase (Aave aTokens, Lido stETH):** Position remains solvent (more collateral), no immediate harm. However, the extra collateral is not reflected in `totalMinted` tracking, potentially allowing over-minting relative to the limit.

**Downward rebase (Ampleforth):** Position becomes undercollateralized without any on-chain event. The challenge mechanism would need to be triggered, but `challengedAmount` and `challengedPrice` were set based on the pre-rebase balance. A successful challenge would attempt to return collateral that no longer exists in the expected quantity.

**MintingHub challenge accounting:** `challenge.size` is stored as a fixed number. If collateral rebases down, the position may not hold enough to settle all concurrent challenges.

**No contract in the protocol handles rebasing tokens.** Position.sol is partially resilient because `_collateralBalance()` reads `balanceOf` for checks, but challenge and debt accounting is not rebase-aware.

**Recommendation:** Document that rebasing tokens are not supported as collateral. Consider adding a rebase-detection check in `openPosition`.

### 7.5 Upgradeable Tokens (USDC, USDT)

**Risk:** MEDIUM

Tokens like USDC and USDT can be upgraded to change behavior after a position is created. The `openPosition` validation check runs only once at creation time. A token upgrade could:
- Add transfer fees (breaking accounting)
- Add blocklists (blocking challenge settlement)
- Change return value behavior
- Add hooks

No mitigation exists in the protocol for post-deployment token upgrades.

### 7.6 Blocklist / Pausable Tokens (USDC, USDT, BNB)

**Risk:** MEDIUM

If a position owner or challenger is blocklisted by the collateral token:
- `Position.withdrawCollateral()` would revert → owner cannot exit
- Challenge settlement (`transferChallengedCollateral`) would revert → challenge stuck
- `_returnCollateral` would revert → challenger cannot get collateral back

**Mitigation:** MintingHub has `pendingReturns` with `_returnCollateral(..., postpone=true)` which postpones delivery. However, Position's `_sendCollateral` has no such fallback — it directly calls `transfer` and would revert if the recipient is blocklisted.

If the collateral token is globally paused:
- All position operations involving collateral transfers would be frozen
- Challenges cannot be initiated, bid on, or settled
- This is inherent to any protocol that holds pausable tokens

### 7.7 Approval to Zero Required (USDT-style)

**Risk:** LOW

**PositionRoller.sol** — L85 and L146:
```solidity
targetCollateral.approve(target.hub(), collDeposit);
```
No `approve(0)` before setting a new approval. For tokens like USDT that require approval to be zero before setting a non-zero value, this would fail if a previous roll left a non-zero allowance (e.g., due to partial consumption or revert).

**MintingHub.sol** — L523:
```solidity
DEURO.approve(address(pos), costs);
```
This is on the dEURO token (protocol-controlled, doesn't require zero-first). Not a risk.

**Recommendation:** Use `SafeERC20.forceApprove()` in PositionRoller for external token approvals.

### 7.8 Revert on Zero Value Transfer

**Risk:** LOW

**Handled in Position.sol** — L756-757:
```solidity
if (amount > 0) {
    IERC20(collateral).transfer(target, amount);
}
```

**NOT handled in:**
- `MintingHub._returnPostponedCollateral()` — if `pendingReturns` is 0, transfers 0 tokens (L443)
- `MintingHub._returnCollateral()` — no zero check (L457)

**Mitigation:** Most code paths naturally avoid zero amounts (minimum collateral requirements, non-zero challenge sizes). The risk of hitting a zero-amount transfer in practice is low.

### 7.9 Multiple Token Addresses / Double Entry Points

**Risk:** LOW

**Handled in Position.sol** — `rescueToken()` at L703-708:
```solidity
function rescueToken(address token, address target, uint256 amount) external onlyOwner {
    if (token == address(collateral)) revert CannotRescueCollateral();
    uint256 balance = _collateralBalance();
    IERC20(token).transfer(target, amount);
    require(balance == _collateralBalance()); // guard against double-entry-point tokens
}
```
This balance-before/after check prevents draining collateral via a double-entry-point token. Well implemented.

**Not handled elsewhere:** If the collateral token has a second entry point, challenge/forceSale flows don't verify the collateral balance after transfers. However, the risk is low since the protocol reads `balanceOf` for collateral checks.

### 7.10 Low Decimals (USDC: 6, WBTC: 8, Gemini: 2)

**Risk:** LOW

Handled. MintingHub validates `decimals() <= 24` at L145. Price calculations use `(36 - decimals)` decimal precision per Position natspec. Minimum collateral value check at L158 (`_minCollateral * _liqPrice < 500 ether * 10**18`) ensures economic significance regardless of decimals.

### 7.11 High Decimals (YAM-V2: 24)

**Risk:** LOW

Handled. Maximum 24 decimals enforced by MintingHub L145. This leaves 12 digits for price precision in the `price * collateral` calculations.

### 7.12 Large Approval Overflow (UNI, COMP: revert on >= 2^96)

**Risk:** LOW

PositionRoller approves exact amounts, not `type(uint256).max`. MintingHub approves exact `costs` for dEURO. No infinite approvals on external tokens except SavingsVaultDEURO's approval to Savings (dEURO, which doesn't have this restriction).

### 7.13 `transferFrom` with `src == msg.sender`

**Risk:** INFORMATIONAL

Some tokens allow `transferFrom(msg.sender, to, amount)` without allowance. The protocol doesn't depend on this behavior. No issue.

### 7.14 Non-string Metadata (MKR bytes32 name/symbol)

**Risk:** INFORMATIONAL

MintingHub calls `IERC20Metadata(addr).decimals()` at L145. It does NOT call `name()` or `symbol()`. No risk from non-string metadata.

### 7.15 Flash Mintable Tokens (DAI)

**Risk:** INFORMATIONAL

If the collateral token is flash-mintable, an attacker could flash-mint a large amount to manipulate `totalSupply()` during the MintingHub validation check at L148 (`totalSupply() + 1`). However, this only affects the initial "does it revert" check, not the economic parameters of the position. No practical exploit path.

### 7.16 Code Injection via Token Name

**Risk:** INFORMATIONAL

Token names are not used in any on-chain logic. Only relevant for off-chain UIs consuming event data.

### 7.17 Tokens with Transfer Hooks (ERC-1363)

**Risk:** MEDIUM

Same concern as 7.1. No reentrancy guards on Position, MintingHub, or PositionRoller. Tokens with post-transfer callbacks could re-enter during collateral operations.

---

## 8. Token Integration Safety

### SafeERC20 Usage

| Contract | SafeERC20 | External Token Interactions |
|----------|-----------|---------------------------|
| Position.sol | **No** | Collateral: `transfer`, `transferFrom`, `balanceOf` |
| MintingHub.sol | **No** | Collateral: `transfer`, `transferFrom`, `decimals`, `totalSupply`, `balanceOf` |
| PositionRoller.sol | **No** | Collateral: `transfer`, `transferFrom`, `approve`, `balanceOf` |
| StablecoinBridge.sol | **Yes** | Source stablecoin: `safeTransfer`, `safeTransferFrom` |
| Savings.sol | **No** | dEURO only (controlled, not external) |
| SavingsVaultDEURO.sol | **Yes** | dEURO: `safeTransferFrom`, `forceApprove` |
| Equity.sol | **No** | dEURO only (controlled, not external) |

**Assessment:** The three contracts that interact with arbitrary external tokens (Position, MintingHub, PositionRoller) all lack SafeERC20. StablecoinBridge correctly uses SafeERC20 for its external token interactions.

### Balance Verification Patterns

| Contract | Balance Before/After | Where |
|----------|---------------------|-------|
| Position.sol | Yes (partial) | `rescueToken()` only — guards against double-entry-point tokens |
| MintingHub.sol | No | -- |
| PositionRoller.sol | No | -- |
| StablecoinBridge.sol | No | -- |

**Assessment:** Balance-before/after checks are only present in `rescueToken`. All other transfer paths trust that the requested amount was fully delivered. This is the root cause of fee-on-transfer vulnerability.

### Allowlist / Token Validation

MintingHub's `openPosition()` at L148-155 performs a creative compatibility check:
```solidity
uint256 invalidAmount = IERC20(_collateralAddress).totalSupply() + 1;
try IERC20(_collateralAddress).transfer(address(0x123), invalidAmount) {
    revert IncompatibleCollateral(); // we need a collateral that reverts on failed transfers
} catch Error(string memory) {} catch Panic(uint) {} catch (bytes memory) {}
```

This validates that the token **reverts on failed transfers** rather than returning `false`. Additionally:
- `decimals() <= 24` is enforced
- Minimum collateral value >= 500 dEURO is enforced
- Challenge period >= 1 day and init period >= 3 days enforced

**Acknowledged limitation (TODO at L149):** Older tokens that use `assert()` (consuming all gas) will cause the entire transaction to fail, not just the try/catch.

**Not validated:**
- Fee-on-transfer behavior
- Rebasing behavior
- Blocklist/pausability
- Upgradeable proxy patterns
- ERC-777 hooks

---

## 9. Findings Summary

### CRITICAL

| ID | Finding | Location | Description |
|----|---------|----------|-------------|
| T-1 | Fee-on-transfer tokens break StablecoinBridge accounting | `StablecoinBridge.sol:71-74` | Bridge mints dEURO based on requested `amount`, not actually received amount. A fee-on-transfer source stablecoin creates unbacked dEURO. No balance-before/after check. |

### HIGH

| ID | Finding | Location | Description |
|----|---------|----------|-------------|
| T-2 | Fee-on-transfer collateral breaks Position price bounds | `Position.sol:371-389` | `_adjust()` passes `newCollateral` to `_setPrice()`, not actual received balance. Price bounds check uses inflated value, allowing higher price than real collateral supports. |
| T-3 | Fee-on-transfer collateral breaks challenge accounting | `MintingHub.sol:250-253` | Challenge stores `_collateralAmount` as size, but hub holds less due to fees. Avert returns full amount, potentially using other challengers' collateral. |
| T-4 | No SafeERC20 on external token interactions | `Position.sol`, `MintingHub.sol`, `PositionRoller.sol` | Raw `.transfer()`/`.transferFrom()` ignore `false` return values. While the `openPosition` check filters most problematic tokens, tokens that conditionally return `false` (e.g., on certain amounts or recipients) would silently fail. |
| T-5 | Rebasing tokens break challenge accounting | `MintingHub.sol:253`, `Position.sol:858-905` | `challengedAmount` and `challenge.size` are fixed values. A downward rebase reduces actual collateral without updating these, making full challenge settlement impossible. |

### MEDIUM

| ID | Finding | Location | Description |
|----|---------|----------|-------------|
| T-6 | ERC-777 / ERC-1363 reentrancy risk | `Position.sol`, `MintingHub.sol`, `PositionRoller.sol` | No reentrancy guards. Transfer hooks could re-enter during collateral operations. The `openPosition` check may not catch all hook-bearing tokens. |
| T-7 | Blocklisted recipient blocks challenge settlement | `Position.sol:755-758` | `_sendCollateral` has no fallback if recipient is blocklisted. Stuck challenges possible. MintingHub has `pendingReturns` but Position does not. |
| T-8 | Upgradeable collateral token can change behavior post-position-creation | All integration contracts | `openPosition` validation runs once. Token upgrades can add fees, blocklists, hooks, or change return values. |
| T-9 | Implicit allowance scope in DecentralizedEURO | `DecentralizedEURO.sol:114-131` | A compromised minter can drain dEURO from ALL other minters, positions, and the reserve. Single minter compromise = system-wide risk. |
| T-10 | Approval residual in PositionRoller | `PositionRoller.sol:85,146` | No `approve(0)` before setting new approval. Tokens requiring zero-first approval (USDT) would fail on subsequent rolls if prior allowance remains. |

### LOW

| ID | Finding | Location | Description |
|----|---------|----------|-------------|
| T-11 | Zero-amount transfer not guarded everywhere | `MintingHub.sol:443,457` | `_returnPostponedCollateral` and `_returnCollateral` can attempt zero-amount transfers. Some tokens revert on zero transfers. Low practical risk due to minimum amount constraints. |
| T-12 | No ERC-2612 permit on SavingsVaultDEURO | `SavingsVaultDEURO.sol` | Inconsistent with rest of protocol. Users cannot gaslessly approve vault shares. |
| T-13 | Approval race condition on all token contracts | All ERC-20 implementations | No `increaseAllowance`/`decreaseAllowance`. Mitigated by ERC-2612 and ERC-3009 support. |
| T-14 | Approval residual in buyExpiredCollateral | `MintingHub.sol:522-523` | `DEURO.approve(address(pos), costs)` may leave non-zero residual if `forceSale` consumes less than `costs`. Low risk since this is on dEURO (protocol token). |

### INFORMATIONAL

| ID | Finding | Location | Description |
|----|---------|----------|-------------|
| T-15 | `openPosition` compatibility check has acknowledged limitation | `MintingHub.sol:149-155` | TODO comment: "Improve for older tokens that revert with assert, which consumes all gas and makes the entire tx fail (uncatchable)." |
| T-16 | No hard supply cap on dEURO | `DecentralizedEURO.sol` | By design for stablecoin system. Minting controlled by minter economics. |
| T-17 | SavingsVaultDEURO `_accrueInterest` only updates counter | `SavingsVaultDEURO.sol:125-132` | Does not actually claim interest from Savings. Interest is recognized through `totalAssets()` which queries the Savings contract. The counter is for event tracking only. |
| T-18 | `restructureCapTable` can wipe any nDEPS holder | `Equity.sol:432` | Emergency measure requiring equity < 1000 dEURO AND 2% quorum. By design but extreme. |
| T-19 | BridgedToken `burn` has no allowance check | `BridgedToken.sol:88-91` | Bridge burns from any address without approval. Standard Optimism pattern — bridge is fully trusted. |

---

## 10. Recommendations

### Priority 1 (Address before mainnet)

1. **Add SafeERC20** to Position.sol, MintingHub.sol, and PositionRoller.sol for all external collateral token interactions. This prevents silent failures from tokens that return `false` and ensures compatibility with tokens that don't return a value.

2. **Add balance-before/after checks** in StablecoinBridge `mintTo()` to prevent unbacked dEURO from fee-on-transfer source stablecoins:
   ```solidity
   uint256 balBefore = eur.balanceOf(address(this));
   eur.safeTransferFrom(msg.sender, address(this), amount);
   uint256 received = eur.balanceOf(address(this)) - balBefore;
   uint256 targetAmount = _convertAmount(received, eurDecimals, dEURODecimals);
   ```

3. **Add balance-before/after checks** in MintingHub `challenge()` for collateral received, and in Position `_adjust()` for collateral deposited.

### Priority 2 (Strongly recommended)

4. **Use `SafeERC20.forceApprove()`** in PositionRoller for external token approvals to handle USDT-style tokens.

5. **Document unsupported token patterns** explicitly: fee-on-transfer, rebasing, ERC-777 hooks. Consider adding a token allowlist or a more comprehensive validation check in `openPosition`.

6. **Add a zero-amount guard** in `MintingHub._returnPostponedCollateral()` and `_returnCollateral()`.

### Priority 3 (Nice to have)

7. **Add reentrancy guards** (`nonReentrant`) to Position, MintingHub, and PositionRoller functions that perform external calls (collateral transfers) followed by state changes.

8. **Add ERC-2612 permit support** to SavingsVaultDEURO for consistency with the rest of the protocol.

9. **Consider a cooldown or notification mechanism** for minter compromise to limit the blast radius of the implicit allowance system.

---

## Appendix: Token Implementation Summary

| Token | Contract | Symbol | Standards | Custom Overrides | Supply Cap |
|-------|----------|--------|-----------|-----------------|-----------|
| Decentralized Euro | DecentralizedEURO.sol | dEURO | ERC-20, ERC-2612, ERC-3009, ERC-165 | `allowance()` (implicit max for minters/positions/reserve) | None (minter-controlled) |
| Native Protocol Share | Equity.sol | nDEPS | ERC-20, ERC-2612, ERC-3009, ERC-165 | `_update()` (vote tracking on every transfer) | `type(uint96).max` |
| Protocol Share Wrapper | DEPSWrapper.sol | DEPS | ERC-20, ERC-2612, ERC20Wrapper | `decimals()` (resolves diamond inheritance) | Mirrors nDEPS |
| Bridged Token | BridgedToken.sol | configurable | ERC-20, ERC-2612, ERC-3009, ERC-165, IOptimismMintableERC20 | None | None (bridge-controlled) |
| Savings Vault | SavingsVaultDEURO.sol | configurable | ERC-20, ERC-4626 | `totalAssets()`, `_deposit()`, `_withdraw()` | None |

## Appendix: Integration Safety Matrix

| External Token Type | Position | MintingHub | PositionRoller | StablecoinBridge |
|---------------------|----------|------------|----------------|-----------------|
| Standard ERC-20 | Safe | Safe | Safe | Safe |
| Missing return value (USDT) | Excluded at creation | Excluded at creation | Inherits position | Safe (SafeERC20) |
| Fee-on-transfer | **UNSAFE** | **UNSAFE** | **UNSAFE** | **UNSAFE** |
| Rebasing | **UNSAFE** | **UNSAFE** | **UNSAFE** | **UNSAFE** |
| ERC-777 hooks | Risky (no reentrancy guard) | Risky | Risky | Safe (CEI pattern) |
| Blocklist/Pausable | Partial (no fallback in Position) | Partial (pendingReturns) | No mitigation | No mitigation |
| Upgradeable | No detection | No detection | No detection | No detection |
| Zero-transfer revert | Handled (_sendCollateral) | **Not handled** | Partial | Safe (SafeERC20) |
| Double entry point | Handled (rescueToken) | Not handled | Not handled | N/A |
| Low/high decimals | Handled (0-24) | Handled (validated) | Delegated | Handled |
