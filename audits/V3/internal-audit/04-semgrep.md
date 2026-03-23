# dEuro Smart Contracts — Semgrep Static Analysis Report

**Date**: 2026-03-03
**Tool**: Semgrep OSS 1.153.1 (via `uvx`)
**Scope**: `contracts/` + `foundry-test/` (excluding `node_modules/`, `lib/`)
**Solidity Files Scanned**: 31 (23 production, 8 test)
**TypeScript Files Scanned**: 42 (test & deployment scripts)

---

## Executive Summary

| Category | Total Findings | Production | Test-Only |
|----------|---------------|------------|-----------|
| Security | 39 | 24 | 15 |
| Performance | 114 | 44 | 70 |
| Best Practice | 1 | 1 | 0 |
| **Total** | **154** | **69** | **85** |

All 154 findings come from the **Decurity semgrep-smart-contracts** ruleset (57 Solidity-specific rules). The official Semgrep rulesets (`p/security-audit`, `p/secrets`, `p/typescript`) produced **zero findings** — expected, since `p/security-audit` contains no Solidity rules, and the TypeScript files are simple deployment/test scripts.

**Bottom line**: No true-positive security vulnerabilities were identified. All 24 production security findings are `basic-arithmetic-underflow` pattern matches on Solidity `>=0.8` code, which has built-in overflow/underflow protection. These are **false positives** in this compiler version context.

---

## Rulesets Used

| Ruleset | Rules Loaded | Findings | Target |
|---------|-------------|----------|--------|
| `p/security-audit` | 225 | 0 | `.sol` files (no Solidity rules in this ruleset) |
| `p/secrets` | 52 | 0 | `.sol` files |
| `p/typescript` | 74 | 0 | `.ts` files |
| [Decurity smart-contracts](https://github.com/Decurity/semgrep-smart-contracts) | 57 | 154 | `.sol` files |

### Note on Decurity Rule Loading

The initial scan pointed `--config` at the Decurity repository root, causing Semgrep to fail on `.github/workflows/lint-rules.yaml` (not a rule file). A corrected re-scan using `--config .../solidity` loaded all 57 rules successfully. The corrected results are included in this report and in `static_analysis_semgrep_1/raw/sol-decurity-fixed.json`.

---

## Security Findings

### SEC-1: `security.basic-arithmetic-underflow` — 24 production instances

**Severity**: Informational (per Decurity: Blocking)
**Triage**: FALSE POSITIVE — Solidity >=0.8 built-in underflow protection

This rule flags any subtraction operation as a potential underflow. However, the dEuro codebase compiles with Solidity `^0.8.26`, which has built-in checked arithmetic. All subtractions will revert on underflow unless explicitly wrapped in `unchecked {}`.

**All 24 flagged locations** (production contracts only):

#### DecentralizedEURO.sol (7 instances)

| Line | Code | Analysis |
|------|------|----------|
| 183 | `(_amount * (1_000_000 - _reservePPM)) / 1_000_000` | Safe: `_reservePPM` is a `uint32` capped at 1M by callers. Solidity 0.8 reverts if violated. |
| 185 | `_amount - usableMint` | Safe: `usableMint` is derived from `_amount` via division — always ≤ `_amount`. |
| 226 | `minterReserveE6 > reserveReduction ? minterReserveE6 - reserveReduction : 0` | Safe: Explicit ternary guard prevents underflow. |
| 249 | `targetTotalBurnAmount - assigned` | Safe: `assigned = calculateAssignedReserve(targetTotalBurnAmount, ...)` which returns ≤ `targetTotalBurnAmount`. |
| 251 | `targetTotalBurnAmount - assigned` | Same as L249. |
| 252 | `minterReserveE6 -= targetTotalBurnAmount * reservePPM` | Protected by Solidity 0.8 checked arithmetic. Could theoretically revert under extreme reserve depletion (see audit context open question #2). |
| 262 | `(1_000_000 * amountExcludingReserve) / (1_000_000 - effectiveReservePPM)` | Safe: `effectiveReservePPM` is bounded to < 1M by `_effectiveReservePPM()`. |

#### Equity.sol (4 instances)

| Line | Code | Analysis |
|------|------|----------|
| 289 | `budget - destroyedVotes` | Safe: `destroyedVotes` accumulates via loop, capped by `_reduceVotes` return values that sum to ≤ `budget`. |
| 292 | `totalVotes() - destroyedVotes - budget` | Protected by Solidity 0.8 checked arithmetic. Only called in `kamikaze()` which is a self-destructive governance action where revert is acceptable. |
| 415 | `totalShares - reductionAfterFees` | Safe: `reductionAfterFees` applies a 2% fee to `shares` which is ≤ `totalShares` (caller must own the shares). |
| 416 | `capital - newCapital` | Safe: `newCapital` is derived from `capital * _power5(ratio)` where `ratio ≤ 1.0` in 18-decimal representation. |

#### Leadrate.sol (1 instance)

| Line | Code | Analysis |
|------|------|----------|
| 77 | `(uint64(timestamp) - anchorTime) * currentRatePPM` | Safe: `timestamp` is always ≥ `anchorTime` (anchor is set to current time when updated). |

#### MintingHub.sol (3 instances)

| Line | Code | Analysis |
|------|------|----------|
| 475 | `block.timestamp - expiration` | Safe: Only reached when `block.timestamp > expiration` (checked by `buyExpiredCollateral` caller). |
| 478 | `challengePeriod - timePassed` | Safe: Only reached when `timePassed < challengePeriod` (inside `if` guard on L476). |
| 482 | `2 * challengePeriod - timePassed` | Safe: Only reached when `timePassed < 2 * challengePeriod` (inside `else` branch of L476). |

#### Position.sol (3 instances)

| Line | Code | Analysis |
|------|------|----------|
| 250 | `totalMinted -= repaid_` | Safe: `repaid_` comes from `_repayPrincipal()` which caps at `principal`, and `principal ≤ totalMinted`. |
| 871 | `challengedAmount -= size` | Safe: `size` is the challenge size that was added to `challengedAmount` in `notifyChallengeStarted`. |
| 890 | `challengedAmount -= _size` | Safe: `_size` bounded by proportional calculation from existing `challengedAmount`. |

#### PositionRoller.sol (2 instances)

| Line | Code | Analysis |
|------|------|----------|
| 98 | `repay - used` | Safe: `used` is the amount consumed by the new position, bounded by the `repay` flash loan amount. Refunds excess. |
| 155 | `repay - used` | Same pattern as L98, native-ETH variant. |

#### Savings.sol (4 instances)

| Line | Code | Analysis |
|------|------|----------|
| 92 | `(uint256(ticks - account.ticks) * account.saved) / ...` | Safe: `ticks` is from `currentTicks()` which is monotonically non-decreasing (SYS-8). `account.ticks` was set at a prior timestamp. |
| 122 | `targetAmount - balance.saved` | Safe: Only reached when `targetAmount > balance.saved` (inside `if` on L121). |
| 124 | `balance.saved - targetAmount` | Safe: Only reached when `balance.saved > targetAmount` (inside `else` on L123). |
| 152 | `account.saved -= amount` | Safe: `amount` is checked against `account.saved` at L149: `if (amount > account.saved) revert InsufficientBalance()`. |

### SEC-2: `security.exact-balance-check` — 2 test-only instances

**Severity**: Low
**Triage**: NOT APPLICABLE — both instances are in `foundry-test/` invariant test code

| Location | Context |
|----------|---------|
| `foundry-test/invariant/ActionUtils.sol:57` | Test helper checking exact balances for assertions |
| `foundry-test/invariant/Handler.t.sol:502` | Test handler checking balances for state validation |

These are test assertions, not production code. No action needed.

---

## Performance Findings (Production Only)

These are gas optimization suggestions. None affect correctness or security. Listed for reference.

| Rule | Count | Description | Contracts |
|------|-------|-------------|-----------|
| `use-nested-if` | 15 | Suggests nested `if` instead of `&&` | DecentralizedEURO, MintingHub, Position, Savings, SavingsVaultDEURO |
| `non-payable-constructor` | 11 | Payable constructors save ~21 gas on deployment | All contracts with constructors |
| `inefficient-state-variable-increment` | 7 | Suggests `+= 1` patterns be optimized | DecentralizedEURO, Leadrate, Position, SavingsVaultDEURO, StablecoinBridge |
| `use-custom-error-not-require` | 4 | Suggests custom errors over `require()` strings | PositionFactory, ERC3009 |
| `unnecessary-checked-arithmetic-in-loop` | 4 | Suggests `unchecked` for loop increments | Equity |
| `use-prefix-increment-not-postfix` | 4 | `++i` instead of `i++` | Equity |
| `use-short-revert-string` | 3 | Suggests shorter revert strings | ERC3009 |
| `state-variable-read-in-a-loop` | 2 | Cache state variables outside loops | (unspecified) |
| `array-length-outside-loop` | 0 (prod) | Cache `.length` outside `for` loops | N/A (test-only) |
| `use-multiple-require` | 1 | Split compound `require` statements | DecentralizedEURO |

### Recommendation

Most of these gas patterns are valid micro-optimizations but have negligible impact on a protocol of this complexity. The codebase already uses custom errors in most places; the `require()` findings are limited to `ERC3009.sol` and `PositionFactory.sol`. Consider addressing `use-custom-error-not-require` for consistency but deprioritize the rest.

---

## Best Practice Findings

### BP-1: `best-practice.use-ownable2step` — 1 instance

**Location**: `contracts/MintingHubV3/Position.sol:17`
**Description**: Suggests using OpenZeppelin's `Ownable2Step` instead of `Ownable` to prevent accidental ownership transfer to a wrong address.

**Triage**: By design. Position ownership transfers are handled through the system's own mechanisms (position cloning, roller). The standard `Ownable` pattern is sufficient here since ownership transfer is not a primary user workflow. Adding a two-step pattern would add gas cost to every ownership operation with minimal practical benefit in this context.

---

## Methodology

### Scan Configuration

```
Engine:     Semgrep OSS 1.153.1
Invocation: uvx semgrep --metrics=off
Exclusions: --exclude="node_modules" --exclude="lib"
Mode:       Run all (no severity filtering)
```

### Rulesets

1. **`p/security-audit`** — Semgrep's comprehensive security audit ruleset (225 rules). Contains rules for Python, C, Java, JS, Go, etc. but **no Solidity-specific rules**. Included as baseline but produced no findings as expected.

2. **`p/secrets`** — Hardcoded credentials detection (52 rules). Scanned all Solidity and TypeScript files for API keys, private keys, tokens, etc. No findings.

3. **`p/typescript`** — TypeScript security patterns (74 rules). Scanned test/deployment scripts. No findings — expected for simple Hardhat test files.

4. **[Decurity semgrep-smart-contracts](https://github.com/Decurity/semgrep-smart-contracts)** — 57 Solidity-specific rules covering DeFi exploits, reentrancy, access control, arithmetic, and gas optimization. This was the only ruleset that produced findings.

### Limitations

1. **Semgrep OSS — no cross-file analysis**: Semgrep Pro (not available) would enable inter-procedural taint tracking across contract boundaries. OSS mode only matches patterns within single files, missing cross-contract data flow issues.

2. **Solidity is experimental in Semgrep**: Official Semgrep rulesets (`p/security-audit`, `p/ci`, etc.) contain zero Solidity rules. The Decurity third-party ruleset is the primary source of Solidity coverage, with 57 rules focused on known vulnerability patterns.

3. **Pattern-based, not semantic**: Semgrep matches syntactic patterns, not semantic program behavior. It cannot reason about invariants, state machine transitions, reserve accounting correctness, or the complex cross-contract interactions documented in `01-context.md`. The open questions identified there (challengedPrice locking, reserve depletion edge cases, compounding mode ordering) are beyond the reach of pattern-based static analysis.

4. **Complementary to Slither**: The Slither scan in `03-secure-workflow-report.md` provides deeper analysis via its 97+ detectors with data flow and control flow awareness. Semgrep and Slither are complementary — Semgrep catches pattern-based issues Slither misses (e.g., specific DeFi exploit patterns), while Slither catches semantic issues Semgrep cannot.

---

## Output Artifacts

| File | Description |
|------|-------------|
| `static_analysis_semgrep_1/results/results.sarif` | Merged SARIF (154 findings, valid JSON) |
| `static_analysis_semgrep_1/raw/sol-decurity-fixed.json` | Decurity scan results (corrected, 154 findings) |
| `static_analysis_semgrep_1/raw/sol-decurity-fixed.sarif` | Decurity SARIF output |
| `static_analysis_semgrep_1/raw/sol-security-audit.json` | p/security-audit results (0 findings) |
| `static_analysis_semgrep_1/raw/sol-secrets.json` | p/secrets results (0 findings) |
| `static_analysis_semgrep_1/raw/ts-typescript.json` | p/typescript results (0 findings) |
| `static_analysis_semgrep_1/raw/ts-security-audit.json` | p/security-audit on TypeScript (0 findings) |
| `static_analysis_semgrep_1/raw/ts-secrets.json` | p/secrets on TypeScript (0 findings) |
| `static_analysis_semgrep_1/rulesets.txt` | Approved ruleset list |
