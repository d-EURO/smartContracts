# dEuro Smart Contracts — Code Maturity Assessment

**Date**: 2026-03-03
**Framework**: Trail of Bits Code Maturity Evaluation v0.1.0
**Scope**: `contracts/` (excluding `contracts/test/`)
**Platform**: Solidity ^0.8.26, Foundry + Hardhat
**SLOC**: ~2,205 across 12 concrete in-scope contracts

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Overall Maturity** | **2.3 / 4.0 (Moderate)** |
| **Strongest Categories** | Arithmetic (3), Access Controls (3), Decentralization (3), Low-Level (3) |
| **Weakest Category** | Transaction Ordering Risks (1) |
| **Critical Gaps** | MEV protections on `bid()`, fuzz run count, missing invariant coverage |

### Top 3 Strengths

1. **Arithmetic Engineering** — Solidity 0.8+ checked arithmetic, no `unchecked` blocks, documented rounding decisions with concrete examples, precision-aware constant design (`minterReserveE6`), and assertions validating arithmetic invariants in settlement functions.

2. **Access Control Architecture** — 12 well-defined modifiers covering all critical paths, governance via time-weighted qualified voting (2% quorum), multisig/DAO for production deployment, timelocks on all governance changes, and comprehensive role separation.

3. **Decentralization Model** — No centralized owner/admin, veto-based minter approval (default-approve with minority veto), immutable contracts (no upgradeable proxies), users can always exit, and emergency mechanisms require distributed governance approval.

### Top 3 Critical Gaps

1. **Transaction Ordering / MEV** — `bid()` has no max price guarantee in Phase 2 Dutch auctions, `clone()` lacks slippage protection, and MEV risks have not been formally documented or tested.

2. **Testing Coverage Gaps** — 8 critical system invariants not yet fuzzed (reserve solvency, flash loan net-zero, challenge amount consistency), only 100 fuzz runs (vs 10K+ industry standard), Foundry tests not in CI, and handler coverage missing Savings/Equity/Roller actions.

3. **Event/Monitoring Gaps** — Missing events for `registerPosition()`, challenge state notifications (`notifyChallengeStarted/Averted/Succeeded`), `kamikaze()`, and `restructureCapTable()`. The high-frequency `MintingUpdate` event has no indexed fields, making it unqueryable.

### Priority Recommendations

1. **CRITICAL**: Add `_maxPrice` parameter to `bid()` for Phase 2 front-running protection
2. **CRITICAL**: Add reserve solvency and flash loan net-zero invariant tests; increase fuzz runs to 10K+
3. **HIGH**: Add events for challenge notifications and position registration
4. **HIGH**: Add Foundry invariant tests to CI pipeline
5. **HIGH**: Consolidate duplicated collateral transfer logic (4 instances of WETH/native pattern)

---

## Maturity Scorecard

| # | Category | Rating | Score | Key Finding |
|---|----------|--------|-------|-------------|
| 1 | Arithmetic | Satisfactory | 3 | Checked arithmetic, documented rounding, precision-aware design, assertions on invariants |
| 2 | Auditing | Moderate | 2 | 80% event coverage, monitoring + IR plan exist, but missing events for critical state transitions |
| 3 | Authentication / Access Controls | Satisfactory | 3 | 12 modifiers, qualified voting governance, multisig, timelocks; no active minter revocation |
| 4 | Complexity Management | Moderate | 2 | Good helper delegation, but 4x duplicated collateral transfer pattern and multi-responsibility functions |
| 5 | Decentralization | Satisfactory | 3 | No centralized admin, veto-based governance, immutable contracts, user exit always available |
| 6 | Documentation | Moderate | 2 | Good contract-level docs and formula specs; 60% of functions lack @param, no architecture diagram |
| 7 | Transaction Ordering Risks | Weak | 1 | Some protections (invest minShares, redeem minProceeds) but bid() unprotected, MEV not documented |
| 8 | Low-Level Manipulation | Satisfactory | 3 | 1 justified assembly block (ERC1167), all .call instances error-handled, no delegatecall |
| 9 | Testing & Verification | Moderate | 2 | 11 invariants, >80% coverage, tests pass; but 100 fuzz runs, 8 missing invariants, no formal verification |

**Overall: 2.3 / 4.0 (Moderate)**

---

## Detailed Analysis

### 1. ARITHMETIC — Satisfactory (3/4)

**Overflow Protection**
- Solidity ^0.8.26 provides default checked arithmetic across all contracts
- **Zero `unchecked` blocks** found in production code — conservative, security-first approach
- Safe subtraction patterns used where underflow is possible: `DecentralizedEURO.sol:226` clamps to 0

**Precision Handling**
- `minterReserveE6` stores reserves with 6 extra digits to avoid rounding loss during PPM calculations (`DecentralizedEURO.sol:139,186`)
- `MathUtil._ceilDivPPM()` (`MathUtil.sol:55-57`) implements ceiling division for collateral requirements — rounding always favors the protocol
- `MathUtil._fifthRoot()` uses Halley's method with explicit convergence threshold `THRESH_DEC18 = 10^6` (12 digits of precision)
- `ONE_DEC18 = 10^18` used consistently for 18-decimal scaling

**Documented Rounding Decisions**
- `DecentralizedEURO.sol:183`: `"// rounding down is fine"` — minter gets slightly less, excess to reserve
- `Position.sol:607`: Full worked example with concrete numbers (`principal=40, interest=10, reservePPM=200000 → repayment=42`)
- `Equity.sol:25-38`: Detailed valuation model specification (`supply ∝ reserve^(1/5)`)
- `Equity.sol:166`: Rounding loss explicitly tracked and corrected in vote anchor redistribution

**Arithmetic Assertions**
- `Position.sol:683`: `assert(proceeds == 0)` validates settlement invariant in force sale
- `Position.sol:842`: `assert(returnedReserve == freedAmount - repayment)` validates reserve math exactness

**Edge Case Handling**
- Zero division guards: `Equity.sol:115` (price), `Position.sol:487` (virtual price), `Savings.sol:89` (interest)
- Collateral dust prevention: `Position.sol:772` treats sub-minimum collateral as zero
- Reserve shortfall: `DecentralizedEURO.sol:285` scales effective reserve ratio proportionally

**Gaps**
- `MathUtil._ceilDivPPM()` has no local guard for `ppm >= 1_000_000` (would cause division by zero) — validated upstream but not locally
- Interest calculation at `Position.sol:528` chains 4 large multiplications before single division — potential for large intermediates
- No differential fuzzing of arithmetic operations
- No formal verification of mathematical properties

**To reach Strong**: Add local PPM range validation in `_ceilDivPPM`, implement differential fuzzing for `_fifthRoot` and interest calculations, and formally verify key arithmetic invariants.

---

### 2. AUDITING — Moderate (2/4)

**Event Coverage**
- **31 custom event definitions** across the codebase
- **~80% of state-changing functions emit events**
- Dual emission pattern: positions emit `MintingUpdate` locally AND forward to hub via `emitPositionUpdate()` for centralized indexing (`Position.sol:303-306`, `MintingHub.sol:102-105`)
- Financial audit trail: `Loss`, `Profit`, `ProfitDistributed` clearly logged (`DecentralizedEURO.sol:49-53`)

**Off-Chain Infrastructure** (per user input)
- Full monitoring infrastructure exists with event indexing
- Incident response plan exists and has been tested

**Missing Events (Critical State Transitions)**

| Function | File:Line | Impact |
|----------|-----------|--------|
| `registerPosition()` | `DecentralizedEURO.sol:146` | Position enablement not trackable off-chain |
| `notifyChallengeStarted()` | `Position.sol:858` | Challenge state changes invisible from position side |
| `notifyChallengeAverted()` | `Position.sol:870` | Challenge resolution not logged |
| `notifyChallengeSucceeded()` | `Position.sol:885` | Critical debt reduction not logged |
| `kamikaze()` | `Equity.sol:285` | Governance manipulation not tracked |
| `restructureCapTable()` | `Equity.sol:432` | Emergency capital action not explicitly logged |

**Indexing Gaps**

| Event | File:Line | Issue |
|-------|-----------|-------|
| `MintingUpdate` | `Position.sol:126` | Emitted 17+ times, **NO indexed fields** — unqueryable |
| `ForcedSale` | `MintingHub.sol:68` | `pos` parameter not indexed |
| `RateProposed` / `RateChanged` | `Leadrate.sol:25-26` | No indexed fields for governance tracking |
| `Roll` | `PositionRoller.sol:24` | source/target positions not indexed |

**Naming Inconsistency**: Mix of gerunds (`Saved`, `Withdrawn`) and past participles (`Started`, `Averted`, `Succeeded`)

**To reach Satisfactory**: Add events for all challenge notification functions, index `MintingUpdate` with position address, add events for `registerPosition` and governance actions, standardize event naming.

---

### 3. AUTHENTICATION / ACCESS CONTROLS — Satisfactory (3/4)

**Modifier System** — 12 modifiers covering all critical paths:

| Modifier | Contract | Check |
|----------|----------|-------|
| `minterOnly` | DecentralizedEURO.sol:61 | `isMinter(msg.sender)` or registered position |
| `validPos` | MintingHub.sol:84 | Position registered with this hub |
| `alive` | Position.sol:151 | `block.timestamp < expiration` |
| `backed` | Position.sol:157 | `!isClosed()` |
| `expired` | Position.sol:162 | `block.timestamp >= expiration` |
| `noCooldown` | Position.sol:167 | `block.timestamp > cooldown` |
| `noChallenge` | Position.sol:172 | `challengedAmount == 0` |
| `onlyHub` | Position.sol:177 | `msg.sender == hub` |
| `ownerOrRoller` | Position.sol:182 | Owner or designated roller |
| `own` | PositionRoller.sol:209 | Caller owns the position |
| `valid` | PositionRoller.sol:214 | Position registered in dEURO |
| `onlyBridge` | BridgedToken.sol:31 | L2 bridge address |

**Role Separation**
- 8 distinct role types: Minter, Position Owner, nDEPS Holder, Qualified Voter, Roller, Hub, Bridge, Reserve
- Non-overlapping privileges: minters mint/burn dEURO, position owners manage collateral, governance vetoes
- Least privilege: Position `mint()` restricted to `ownerOrRoller`, not just any minter

**Governance**
- Production uses multisig/DAO for all privileged operations
- Time-weighted voting prevents flash loan governance attacks
- 2% quorum for standard governance, 10% for emergency bridge stop
- Timelocks: 10d minter application, 7d rate changes, 3d position initialization

**Implicit Allowance** (`DecentralizedEURO.sol:114-131`)
- Well-documented trust model: minters and positions have infinite mutual allowance
- Justified by design: these entities already have mint/burn privileges
- Risk mitigated by veto-based minter approval process

**Gaps**
- Active minters cannot be revoked (only prevented during application period)
- Position uses standard OpenZeppelin `Ownable` (single-step transfer, not two-step)
- No rate caps or circuit breakers on lead rate governance
- `PositionFactory` has no access control (orphan positions possible, though harmless)

**To reach Strong**: Implement two-step ownership transfer on Position, add minter revocation mechanism (even if time-delayed), add rate caps to prevent governance from setting extreme values.

---

### 4. COMPLEXITY MANAGEMENT — Moderate (2/4)

**Function Lengths**
- Longest function: `MintingHub.openPosition()` at ~59 lines — acceptable given validation requirements
- Most functions are well-decomposed into internal helpers
- `Position.sol` has 42 functions (justified by CDP complexity) but is the densest contract

**Code Duplication** — Collateral transfer pattern repeated 4+ times:
```
MintingHub._finishChallenge() (line 326-333)
MintingHub._returnPostponedCollateral() (line 438-443)
MintingHub._returnCollateral() (line 452-457)
MintingHub._buyExpiredCollateral() (line 521-527)
```
Each repeats: check if WETH + native → unwrap → `.call{value}` || transfer. Should be a single `_transferCollateralOut()` utility.

**Multi-Responsibility Functions**
- `Position.adjust()` (`Position.sol:365`): deposits collateral, adjusts debt, adjusts price, withdraws — 5 concerns in one function
- `MintingHub.openPosition()` (`MintingHub.sol:130`): validates params, checks collateral, creates position, registers, transfers — 6 concerns
- `Position.forceSale()` (`Position.sol:664`): transfers collateral, calculates debt, repays interest/principal, covers losses — 5 concerns
- `PositionRoller.rollNative()` (`PositionRoller.sol:122`): 48 lines mixing flash loan, collateral movement, and position cloning

**Inheritance**
- Shallow hierarchies (max 3-4 levels excluding OZ base classes)
- No diamond inheritance
- Good use of mixins (`MathUtil`, `Leadrate`)

**Naming**
- Mostly consistent (UPPER_SNAKE for constants, camelCase for state, `_` prefix for internal)
- Minor inconsistencies: mixed PPM suffix usage (`reserveContribution` vs `reservePPM` vs `reserveContributionPPM`)

**To reach Satisfactory**: Extract collateral transfer utility, decompose `openPosition` validation into standalone helper, split `rollNative` into flash-loan and position-setup phases, standardize PPM naming.

---

### 5. DECENTRALIZATION — Satisfactory (3/4)

**No Centralized Admin**
- `DecentralizedEURO.sol` has no owner or admin role
- `Equity.sol` constructor has no ownership transfer
- All governance actions require qualified voter approval (2% quorum)

**Governance Model**
- Veto-based minter approval: anyone can propose (with 1000 dEURO fee), approved by default after timelock, minority (2%) can veto
- Lead rate governance: qualified voters propose, 7-day timelock, anyone can apply
- Position denial: qualified voters can reject new positions during initialization period

**Immutability**
- No upgradeable proxies (UUPS, Transparent, Beacon) — contracts are immutable after deployment
- ERC-1167 clones are minimal proxies for gas efficiency, not upgradeability
- Core parameters (timelocks, quorums, minimum fees) are hardcoded constants

**User Exit Paths**
- dEURO holders: `burn()` at any time, no restrictions (`DecentralizedEURO.sol:196`)
- nDEPS holders: `redeem()` after 90-day average holding, 2% fee (`Equity.sol:365`)
- Position owners: `repayFull()` + `withdrawCollateral()` — always available unless challenged or in cooldown
- Bridge users: `burn()` returns source stablecoin immediately (`StablecoinBridge.sol:89`)

**Emergency Mechanisms**
- Bridge emergency stop: 10% quorum, permanently stops new mints but allows burns (`StablecoinBridge.sol:112`)
- Capital restructuring: 2% quorum, only when equity < 1000 dEURO (`Equity.sol:432`)

**Gaps**
- Active minters cannot be revoked — only vetoed during application period
- No circuit breakers or rate caps on lead rate (governance could set 999,999 PPM)
- Governance relies on active participation — 2% veto threshold may be insufficient for a distributed holder base

**To reach Strong**: Add minter sunset/revocation mechanism, implement rate caps, document decentralization path and governance risk model.

---

### 6. DOCUMENTATION — Moderate (2/4)

**Contract-Level Documentation**
- All 12 concrete contracts have `@title` and `@notice` with clear purpose descriptions
- `Equity.sol:24-74`: Excellent valuation model specification with mathematical derivation
- `DecentralizedEURO.sol:216-219`: Reserve calculation with worked example
- `Position.sol:607`: Interest formula with concrete numbers

**README.md**
- Comprehensive: fork lineage, contract reference table, changelog, 4 prior audits listed, dev setup guide
- January 2025 update notes are detailed and useful
- Missing: architecture diagram, economic model explanation, system interaction flows

**NatSpec Coverage: ~35%**
- Well-documented: `suggestMinter()`, `denyMinter()`, `invest()`, `redeem()` — full @param/@return
- Poorly documented: `_accrueInterest()`, `_adjust()`, `notifyMint()` — zero or minimal NatSpec
- ~60% of functions lack @param documentation

**Missing**
- No centralized architecture diagram (only in audit artifacts, not in repo)
- No domain glossary (principal vs debt vs outstanding used inconsistently)
- No user stories document
- Complex internal functions (`_accrueInterest`, `_adjustPrice`) lack inline explanation of WHY
- Bitwise shift operations in `Equity._anchorTime()` underdocumented

**To reach Satisfactory**: Add @param/@return to all public/external functions, create ARCHITECTURE.md with diagrams, create GLOSSARY.md, add inline comments to `_accrueInterest` and price adjustment logic.

---

### 7. TRANSACTION ORDERING RISKS — Weak (1/4)

**Existing Protections**

| Function | Protection | File:Line |
|----------|-----------|-----------|
| `Equity.invest()` | `_minShares` parameter | `Equity.sol:318` |
| `Equity.redeemExpected()` | `_minProceeds` parameter | `Equity.sol:373` |
| `MintingHub.buyExpiredCollateral()` | `_maxCosts` via price check | `MintingHub.sol:498` |
| Lead rate changes | 7-day timelock | `Leadrate.sol:48` |

**Missing Protections**

| Function | Risk | Impact |
|----------|------|--------|
| `MintingHub.bid()` | No max price in Phase 2 Dutch auction | Bidder can be front-run; attacker sees profitable bid and submits first at higher price |
| `MintingHub.clone()` | No slippage protection | Original position state could change between tx submission and execution |
| `Position.adjust()` | No min collateral factor guarantee | Multi-step operation outcome could differ from expectation |

**MEV Analysis**
- No formal documentation of MEV risks
- No MEV simulation or testing performed
- Challenge bidding (Dutch auction) is inherently MEV-extractable — declining price partially mitigates but doesn't eliminate
- No oracle dependency (prices set by position owners) — eliminates oracle manipulation vector
- No AMM-style trades — eliminates sandwich attack vector

**To reach Moderate**: Document all transaction ordering risks, add `_maxPrice` to `bid()`, add deadline parameters to time-sensitive operations, test ordering attack scenarios.

---

### 8. LOW-LEVEL MANIPULATION — Satisfactory (3/4)

**Assembly Usage: Minimal & Justified**
- **1 production assembly block**: `PositionFactory._createClone()` (`PositionFactory.sol:60-66`)
  - Canonical ERC-1167 minimal proxy bytecode
  - Inline GitHub citation
  - `require(result != address(0))` error check
  - Justified: no high-level equivalent for deploying minimal proxies

**Low-Level Calls: Properly Handled**
- **7 `.call{value}` instances** across Position.sol, MintingHub.sol, PositionRoller.sol
- All use `(bool success, ) = target.call{value: amount}("")` pattern
- All check `require(success)` with custom `NativeTransferFailed()` error
- No `.delegatecall` or `.staticcall` found anywhere in codebase

**ABI Encoding**
- `abi.encode()` used only for EIP-712 signature hashing in `ERC3009.sol:135,160` — standard pattern

**Bitwise Operations**
- `Equity.sol:60,178,200`: Bit shifts for time-resolution packing (20-bit sub-second precision)
- Justified for storage efficiency, but inline documentation is sparse
- Comment at `Equity.sol:60` ("Set to 5 for local testing") is misleading — should explain the shift purpose

**Type Casting**
- All casts are explicit (`uint64(...)`, `uint192(...)`, `bytes20(...)`)
- No implicit conversions or risky address casts

**To reach Strong**: Add inline comments to all bitwise operations in Equity, implement differential fuzzing comparing assembly clone with reference implementation, document compiler optimization considerations.

---

### 9. TESTING & VERIFICATION — Moderate (2/4)

**Test Infrastructure**
- ~2,769 lines of test code across Hardhat (TypeScript) and Foundry (Solidity)
- **Hardhat**: 3 test files — SavingsVaultDEURO (61+ tests, 915 lines), BridgedToken (11 tests), ERC3009 (5 tests)
- **Foundry**: Invariant suite with 11 properties, 11 fuzzing actions, statistics tracking

**Invariant Testing (Foundry)**
11 invariants tested: position collateralization, debt accounting, minting limits, reserve consistency, virtual price, fixed rate floor, no trapped dEURO, and more.

**Handler Coverage**
11 actions: mintTo, repay, addCollateral, withdrawCollateral, adjustPrice, challengePosition, bidChallenge, buyExpiredCollateral, passCooldown, warpTime, expirePosition.

**Post-Condition Verification**: Each handler action captures 18-field snapshots before/after and validates state transitions.

**Coverage**: >80% line/branch coverage, all tests pass.

**Gaps**

| Gap | Impact |
|-----|--------|
| Only 100 fuzz/invariant runs | Industry standard is 10K+ for DeFi; 100 catches trivial bugs only |
| `fail_on_revert = false` | Masks potential bugs by silently ignoring reverts |
| Foundry tests not in CI | Invariant violations only caught locally, not on PRs |
| 8 critical invariants missing | Reserve solvency (SYS-1), flash loan net-zero (SYS-6), savings cap (SYS-7) not tested |
| Missing handler actions | No Savings, Equity, Roller, or Bridge actions in fuzzing handler |
| No formal verification | No Certora, Halmos, or symbolic execution |
| Limited negative tests | Reverts caught but reasons not validated |
| No E2E scenarios | Cascade liquidations, multi-position interactions untested |

**To reach Satisfactory**: Increase fuzz runs to 10K+, add Foundry tests to CI, add missing 8 invariants, expand handler with Savings/Equity/Roller actions, add explicit negative tests with revert reason validation, consider Halmos for critical arithmetic properties.

---

## Improvement Roadmap

### CRITICAL (Immediate)

| # | Action | Category | Effort | Impact |
|---|--------|----------|--------|--------|
| 1 | Add `_maxPrice` parameter to `MintingHub.bid()` for Phase 2 | Transaction Ordering | Low | Prevents front-running losses for bidders |
| 2 | Add reserve solvency invariant: `balanceOf(reserve) >= minterReserve()` | Testing | Low | Tests the single most important system property |
| 3 | Add flash loan net-zero invariant for PositionRoller | Testing | Low | Prevents unbacked minting via Roller |
| 4 | Increase fuzz/invariant runs to 10,000+ | Testing | Low | Current 100 runs is insufficient for production DeFi |
| 5 | Add Foundry invariant tests to CI pipeline | Testing | Low | Currently only Hardhat tests run on PRs |

### HIGH (1-2 months)

| # | Action | Category | Effort | Impact |
|---|--------|----------|--------|--------|
| 6 | Add events to `registerPosition`, `notifyChallengeStarted/Averted/Succeeded` | Auditing | Low | Enables off-chain challenge state tracking |
| 7 | Index `MintingUpdate` event with position address | Auditing | Low | Makes highest-frequency event queryable |
| 8 | Expand fuzzing handler: Savings, Equity, Roller, Bridge actions | Testing | Medium | Covers currently untested protocol surface |
| 9 | Add `challengedAmount` consistency and savings interest cap invariants | Testing | Low | Tests 2 more critical system properties |
| 10 | Consolidate collateral transfer pattern into single utility | Complexity | Low | Eliminates 4x code duplication in MintingHub |
| 11 | Document all MEV risks in a TRANSACTION_ORDERING.md | Transaction Ordering | Medium | Formalizes awareness and communicates risks |
| 12 | Add @param/@return NatSpec to all public/external functions | Documentation | Medium | Raises NatSpec coverage from ~35% to >90% |

### MEDIUM (2-4 months)

| # | Action | Category | Effort | Impact |
|---|--------|----------|--------|--------|
| 13 | Create ARCHITECTURE.md with system interaction diagrams | Documentation | Medium | Aids future auditors and contributors |
| 14 | Decompose multi-responsibility functions (adjust, openPosition, rollNative) | Complexity | Medium | Reduces cognitive load and improves testability |
| 15 | Add inline comments to `_accrueInterest`, `_adjustPrice`, Equity bitwise ops | Documentation | Low | Explains critical logic that currently has zero docs |
| 16 | Add deadline parameter to `clone()` and `adjust()` | Transaction Ordering | Low | Prevents stale transaction execution |
| 17 | Add explicit negative tests with revert reason validation | Testing | Medium | Validates failure modes, not just success paths |
| 18 | Set `fail_on_revert = false` to `true` or add targeted revert handling | Testing | Low | Stops masking potential invariant violations |
| 19 | Add local PPM range validation in `MathUtil._ceilDivPPM()` | Arithmetic | Low | Defense-in-depth for division-by-zero edge case |
| 20 | Consider Halmos symbolic execution for critical arithmetic | Testing | High | Provides formal guarantees beyond fuzzing |

---

## Appendix: Assessment Methodology

Each of the 9 categories was assessed against the Trail of Bits Code Maturity Evaluation v0.1.0 criteria:

- **Missing (0)**: Not present / not implemented
- **Weak (1)**: Several significant improvements needed
- **Moderate (2)**: Adequate, can be improved
- **Satisfactory (3)**: Above average, minor improvements possible
- **Strong (4)**: Exceptional, only small improvements possible

**Rating logic**: ANY "Weak" criteria present → Weak. NO "Weak" + SOME "Moderate" unmet → Moderate. ALL "Moderate" met + SOME "Satisfactory" met → Satisfactory. ALL "Satisfactory" + exceptional practices → Strong.

Evidence was gathered via 6 parallel research agents analyzing: arithmetic patterns, events/auditing, complexity management, testing/verification, low-level manipulation + documentation, and decentralization + access controls. Off-chain process information (monitoring, key management, MEV documentation, test status) was obtained via user interview.
