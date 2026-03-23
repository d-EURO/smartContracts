# dEuro Smart Contracts — Trail of Bits Development Guidelines Assessment

**Date**: 2026-03-03
**Framework**: [Building Secure Contracts — Development Guidelines](https://github.com/crytic/building-secure-contracts)
**Scope**: `contracts/` (excluding `contracts/test/`)
**SLOC**: ~2,200 source lines across 12 concrete in-scope contracts
**Compiler**: Solidity 0.8.26, optimizer enabled (200 runs)

---

## 1. Documentation & Specifications

### 1.1 Plain English System Description

The dEuro system is a decentralized Euro-tracking stablecoin. Users deposit collateral into Positions (CDPs) to mint dEURO. The system is governed by nDEPS equity share holders who can veto minters and positions. Interest accrues on minted debt and flows to savings depositors and the equity reserve. Undercollateralized positions are liquidated through a two-phase Dutch auction challenge mechanism.

**Existing documentation**:
- `README.md` (379 lines): Comprehensive overview of contracts and changes from the Frankencoin fork
- `audits/V3/Claude-ToB/01-context.md`: Deep architectural context (441 lines)
- `audits/V3/Claude-ToB/02-entry-points.md`: Entry point catalog (314 lines)
- No dedicated `docs/` directory

**Assessment**: Good high-level documentation exists. The audit context files provide the depth that a formal specification would, including system invariants, state machines, workflow traces, and trust boundary maps. However, there is no standalone protocol specification document separate from audit artifacts.

### 1.2 NatSpec Coverage

| Contract | Grade | Notes |
|----------|-------|-------|
| DecentralizedEURO.sol | **A** | Excellent. All public functions have @notice, many with @dev examples. |
| MintingHub.sol | **A-** | Comprehensive @notice/@param/@return on public API. Internal helpers less documented. |
| Position.sol | **B+** | Good coverage on public functions. Internal functions (_mint, _adjustPrice, _setPrice) have minimal NatSpec. Challenge notification functions (notifyChallengeStarted/Averted/Succeeded) lack @notice. |
| Equity.sol | **B** | Public functions documented. Mathematical internals (_calculateShares, _fifthRoot) under-documented. |
| Savings.sol | **C-** | Nearly all public functions lack NatSpec. save(), withdraw(), claimInterest(), refreshBalance() have no @notice. |
| Leadrate.sol | **B** | Basic documentation present. Tick mechanics deserve more explanation. |
| PositionRoller.sol | **B-** | Flash loan mechanics documented at function level. Internal calculation helpers lack docs. |
| StablecoinBridge.sol | **B+** | Well documented for a simple contract. |
| SavingsVaultDEURO.sol | **B** | ERC-4626 standard functions inherit documentation. Custom interest accrual patterns under-documented. |

### 1.3 Documentation Gaps

| Gap | Priority | Detail |
|-----|----------|--------|
| **No formal specification** | HIGH | No standalone document defining protocol rules, interest formulas, and invariants independent of the codebase |
| **Savings.sol lacks NatSpec** | HIGH | Most user-facing functions have no documentation |
| **Implicit allowance mechanism undocumented** | HIGH | The `allowance()` override (DecentralizedEURO.sol:114-131) is the single most surprising behavior for external integrators. No NatSpec explains it. |
| **Interest formula not documented** | MEDIUM | The formula `principal * (1M - reserveContribution) * fixedAnnualRatePPM * delta / (365 days * 1M * 1M)` is not explained in code comments |
| **Bonding curve math undocumented** | MEDIUM | The 5th-root bonding curve in Equity.sol lacks explanation of economic rationale |
| **No deployment documentation** | MEDIUM | No documented deployment procedure, initialization sequence, or post-deployment verification steps |
| **Vote anchor time-shifting** | LOW | The 20-bit sub-second resolution for vote tracking is clever but non-obvious — deserves a @dev explanation |

### 1.4 Recommendations

- **CRITICAL**: Add NatSpec to all public/external functions in Savings.sol
- **HIGH**: Document the implicit allowance override with a comprehensive @dev comment explaining the trust model, who gets infinite allowances, and the security implications for external integrators
- **HIGH**: Create a standalone protocol specification document (can be derived from 01-context.md)
- **MEDIUM**: Add @dev comments to Position.sol's interest calculation explaining the formula
- **MEDIUM**: Document the deployment and initialization sequence

---

## 2. On-Chain vs Off-Chain Computation

### Assessment: Well-Designed

The dEuro system keeps computation on-chain appropriately:

- **Interest accrual**: Uses a tick-based linear accumulation model (Leadrate.sol) rather than per-block compounding. This is gas-efficient — interest is calculated lazily on interaction rather than accumulated continuously.
- **Bonding curve**: The 5th-root calculation in Equity.sol uses fixed-point math (MathUtil) rather than external oracles or off-chain computation. This is correct for a self-contained pricing mechanism.
- **No oracle dependency**: Position prices are set by owners, eliminating oracle manipulation risk at the cost of requiring the challenge mechanism for price honesty.
- **Dutch auction pricing**: Calculated on-chain from `block.timestamp` using linear interpolation. Simple and gas-efficient.

**No off-chain computation opportunities identified.** The system is designed as a fully on-chain protocol with no keeper dependencies (anyone can trigger challenge settlements, apply rate changes, etc.).

---

## 3. Upgradeability

### Assessment: N/A — No Upgradeability (By Design)

- **No proxy patterns**: No UUPS, TransparentProxy, or Beacon patterns detected
- **No delegatecall**: Zero instances in production code
- **ERC-1167 clones**: Position contracts use minimal proxies via PositionFactory, but these are immutable clones — they delegate to a fixed implementation and cannot be upgraded
- **No admin-controlled pause/upgrade**: The system relies on governance (nDEPS quorum) for denial/veto, not admin upgrades

**Trade-off acknowledged**: The system favors immutability over upgradeability. New functionality requires deploying new contracts and registering them as minters through governance. This is the recommended approach per Trail of Bits guidelines ("Favor contract migration over upgradeability").

---

## 4. Delegatecall Proxy Pattern

### Assessment: N/A

No delegatecall proxy patterns present. The ERC-1167 minimal proxies in PositionFactory use `delegatecall` under the hood at the EVM level, but this is the standard immutable clone pattern — no storage layout concerns, no initialization races, no upgrade paths.

**Verified**: PositionFactory._createClone() at `PositionFactory.sol:58-68` uses canonical ERC-1167 bytecode. The `initialize()` function on Position is guarded by `AlreadyInitialized` error preventing re-initialization.

---

## 5. Function Composition

### Assessment: Excellent

**Function size**: No function exceeds 60 lines. The largest public function is `MintingHub.openPosition()` at ~59 lines including its validation block. Position's internal `_adjust()` is ~30 lines. All within acceptable limits.

**Separation of concerns**: Strong pattern observed:
- **Validation**: Modifiers (`alive`, `noChallenge`, `noCooldown`, `backed`, `onlyHub`, `onlyOwner`, `ownerOrRoller`) handle precondition checks
- **Business logic**: Pure calculation functions (`_calculateInterest`, `_virtualPrice`, `getCollateralRequirement`, `calculateInterest` in Savings)
- **Side effects**: State-mutating functions (`_mint`, `_repayInterest`, `_accrueInterest`) are cleanly separated

**Parameter counts**: Some functions have high parameter counts justified by domain complexity:
- Position constructor: 12 params (factory-created, acceptable)
- MintingHub.openPosition(): 10 params (primary user API, well-documented)
- PositionRoller.roll(): 7 params (flash loan operation, semantically distinct)

**Recommendation**: Consider struct-based parameters for `openPosition()` in future versions to improve API ergonomics, but current implementation is acceptable.

---

## 6. Inheritance

### Assessment: Clean and Well-Structured

**Hierarchy depth** (max 4 levels):
```
DecentralizedEURO → ERC20Permit → ERC20 → Context  (+ ERC3009, IDecentralizedEURO, ERC165)
Equity            → ERC20Permit → ERC20 → Context  (+ ERC3009, MathUtil, IReserve, ERC165)
Position          → Ownable                          (+ IPosition, MathUtil)
MintingHub        → Leadrate                         (+ IMintingHub, ERC165)
Savings           → Leadrate
```

**No diamond problems**: Multiple inheritance paths don't create diamonds. Interface inheritance is clean.

**Overrides are intentional and correct**:
- `DecentralizedEURO.allowance()`: Extends ERC20 with implicit system allowances
- `Equity._update()`: Hooks into ERC20 transfers for vote tracking
- Both are marked `override` with clear semantic purpose

**MathUtil**: Used as a mixin by both `Equity` and `Position`. Contains pure math functions (`_fifthRoot`, `_mulD18`, `_divD18`, `_ceilDivPPM`). No state, no diamond risk.

**ERC3009**: Custom implementation at `contracts/impl/ERC3009.sol` shared by `DecentralizedEURO` and `Equity`. Clean abstract contract with no storage layout implications.

**No issues found.**

---

## 7. Events

### Assessment: Good with Specific Gaps

**Well-covered contracts**:

| Contract | Events | Coverage |
|----------|--------|----------|
| MintingHub | 6 events | Excellent — all critical operations (position creation, challenges, bids, force sales, postponed returns) |
| DecentralizedEURO | 5 events | Excellent — minter lifecycle, losses, profits, distributions |
| Savings | 4 events | Good — deposits, withdrawals, interest collection, claims |
| Equity | 2 events | Adequate — Trade (invest/redeem) and Delegation |

**Gaps identified**:

| Gap | Contract | Severity | Detail |
|-----|----------|----------|--------|
| **No events for challenge state changes on Position** | Position.sol | **HIGH** | `notifyChallengeStarted()`, `notifyChallengeAverted()`, `notifyChallengeSucceeded()` modify Position state but emit no events. MintingHub emits its own events, but Position-level state changes (challengedAmount, challengedPrice, debt reduction) are invisible from Position's event log. |
| **No event for position closure** | Position.sol | **MEDIUM** | When collateral drops below minimum and `closed` is set to true (in `_sendCollateral()`), no event is emitted. Off-chain monitors cannot detect position closures. |
| **No event for vote destruction** | Equity.sol | **MEDIUM** | `kamikaze()` destroys votes but emits no event. This is a governance-critical action. |
| **`Trade.who` not indexed** | Equity.sol:92 | **LOW** | The `who` parameter in `Trade(address who, ...)` is not indexed, making it harder to filter investment/redemption events by address. |
| **No event for compounding mode change** | Savings.sol | **LOW** | `save(uint192, bool)` changes compounding preference silently. |

### Recommendations

- **HIGH**: Add events to Position's challenge notification functions, or document that MintingHub's events are the canonical source for challenge tracking
- **MEDIUM**: Add a `PositionClosed` event when `closed` transitions to true
- **MEDIUM**: Add an event to `kamikaze()` for vote destruction tracking
- **LOW**: Index `Trade.who` in Equity.sol

---

## 8. Common Pitfalls

### 8.1 Reentrancy

**Assessment**: No ReentrancyGuard used. The protocol relies on a trust model:
1. dEURO is a known, non-reentrant ERC-20 (custom implementation based on OZ)
2. Collateral tokens are validated at admission (`MintingHub.sol:148-155` verifies revert-on-failure)
3. Position functions are owner-gated, limiting reentrancy surface

**Residual risks**:
- `Position._adjust()` sends native ETH via `target.call{value}` before completing state writes. Protected by `onlyOwner` (owner reenters own position — no additional privilege gained).
- If an ERC-777 token passed the admission check as collateral, transfer hooks could trigger reentry. No explicit ERC-777 guard exists.
- `Position.rescueToken()` reads balance before external transfer, then checks balance hasn't changed. This is the intended defense for double-entry-point tokens and works correctly.

**Recommendation**: Document the trust model explicitly. Consider adding `nonReentrant` to `_adjust()` as defense-in-depth, or document why it's unnecessary.

### 8.2 Integer Overflow/Underflow

**Assessment**: Safe. Solidity 0.8.26 provides checked arithmetic by default. No `unchecked` blocks in production code.

**Precision concerns**:
- `minterReserveE6` uses 6 extra decimal digits to avoid rounding loss during PPM calculations
- `MathUtil._ceilDivPPM` provides ceiling division for reserve calculations
- Interest calculation uses `(1M - reserveContribution)` factor correctly

### 8.3 Access Control

**Assessment**: Well-designed. Comprehensive modifier coverage verified in `03-secure-workflow.md`:
- Position: 8 modifiers covering all critical state transitions
- MintingHub: `validPos` for position-dependent functions
- DecentralizedEURO: `minterOnly` for all mint/burn/reserve operations
- Governance: `checkQualified` with 2% quorum

**One concern**: `PositionFactory` has no access control. Anyone can call `createNewPosition()` or `clonePosition()`. Verified safe: orphan positions (not registered via MintingHub) cannot mint dEURO, and the `deuro.getPositionParent(msg.sender) != hub` check prevents abuse of original position's `notifyMint`/`notifyRepaid`.

### 8.4 Front-Running

**Assessment**: Medium risk.

| Area | Protection | Gap |
|------|-----------|-----|
| Equity investment | `_minShares` parameter | None |
| Equity redemption | `_minProceeds` via `redeemExpected()` | None |
| Challenge bidding (Phase 2) | Declining price (front-runner pays more) | **No `_maxPrice` parameter on `bid()`** |
| Position cloning | None | **No slippage protection on `clone()`** |
| Force sale | `_maxCosts` via `expiredPurchasePrice` | None |
| Rate changes | 7-day delay | None |

**Recommendation**: Add `_maxPrice` parameter to `MintingHub.bid()` for Phase 2 front-running protection.

### 8.5 Timestamp Dependence

**Assessment**: Acceptable.

Position.sol uses `block.timestamp` in 13 locations for:
- Expiration checks
- Cooldown enforcement
- Challenge period timing
- Interest accrual

All uses are for permission gates and state transitions — not for direct value calculations or price feeds. Miner timestamp manipulation (±15 seconds on Ethereum) has negligible impact on multi-day periods (minimum 3-day init, 1-day challenge period).

### 8.6 Other Pitfalls

| Pitfall | Status | Detail |
|---------|--------|--------|
| `tx.origin` | Not used | All auth uses `msg.sender` |
| `selfdestruct` | Not used | Safe |
| `delegatecall` | Not used in production | Only in ERC-1167 bytecode |
| Fee-on-transfer tokens | **Not blocked** | `openPosition` validates revert-on-failure but not fee-on-transfer. A fee-on-transfer collateral could cause accounting discrepancies in `_adjust()`. |
| Rebasing tokens | **Not blocked** | No protection against collateral tokens that change balance without transfers. |
| Magic numbers | Minor | `980` (2% fee) in Equity.sol should be a named constant. `10**14` minimum price undocumented. |

---

## 9. Dependencies

### Assessment: Well-Managed

| Dependency | Version | Status | Notes |
|------------|---------|--------|-------|
| @openzeppelin/contracts | 5.1.0 | Current | Latest OZ v5 major release |
| forge-std | latest | Current | Standard Foundry test library |
| Hardhat | 2.26.3 | Current | Latest stable |
| Solidity | 0.8.26 | Current | Latest stable |
| solidity-coverage | 0.8.4 | Current | Standard coverage tool |
| solhint | 5.0.5 | Current | Configured with recommended rules |

**No copied/vendored code detected**: All external code comes from npm packages.

**Custom implementations**:
- `ERC3009.sol`: Custom meta-transaction implementation. Not from OpenZeppelin. Has been reviewed in prior audits but is a maintenance burden.
- `MathUtil.sol`: Custom fixed-point math (5th root, decimal operations). Domain-specific, no standard library available.
- `PositionFactory._createClone()`: Inline assembly for ERC-1167. Matches canonical pattern.

**Pragma versions**: Most contracts use `^0.8.0` which is very permissive. All compile against 0.8.26.

### Recommendations

- **MEDIUM**: Tighten pragma versions from `^0.8.0` to `>=0.8.25 <0.9.0` to match the actual minimum required features (custom errors with parameters require 0.8.4+, user-defined value types in some patterns require 0.8.8+)
- **LOW**: Consider monitoring OpenZeppelin v5 for updates — the 5.x series may still receive minor patches

---

## 10. Testing & Verification

### 10.1 Test Infrastructure

| Framework | Files | Lines | Purpose |
|-----------|-------|-------|---------|
| Hardhat (TypeScript) | 15 | ~9,000 | Unit tests, integration tests |
| Foundry (Solidity) | 8 | ~1,500 | Invariant/fuzz testing |
| **Total** | **23** | **~10,500** | |

**Test-to-source ratio**: ~4.8:1 (10,500 test lines / 2,200 source lines). This is excellent.

### 10.2 Invariant Testing (Foundry)

**13 invariants tested** (via `foundry-test/invariant/Invariants.t.sol`):

| ID | Invariant | Status |
|----|-----------|--------|
| 1 | No trapped dEURO in positions | Tested |
| 2 | Positions sufficiently collateralized | Tested |
| 3 | Nonzero interest implies nonzero principal | Tested |
| 4 | Zero principal implies zero interest | Tested |
| 5 | Active positions have minimum collateral | Tested |
| 6 | Debt = principal + interest | Tested |
| 7 | Minting limit not exceeded | Tested |
| 8 | Minter reserve consistency | Tested |
| 9 | Virtual price >= actual price (when debt exists) | Tested |
| 10 | Total supply consistency | Tested |
| 11 | Fixed rate >= risk premium | Tested |

**Handler coverage**: 11 fuzzed actions (mint, repay, addCollateral, withdrawCollateral, adjustPrice, passCooldown, warpTime, expirePosition, challenge, bid, buyExpiredCollateral).

### 10.3 Missing Invariants

From the audit context (01-context.md), the following critical invariants are **NOT yet fuzzed**:

| ID | Missing Invariant | Priority |
|----|-------------------|----------|
| MISS-1 | `balanceOf(reserve) >= minterReserve()` (reserve solvency) | **CRITICAL** |
| MISS-2 | `equity() = balanceOf(reserve) - minterReserve()` | **CRITICAL** |
| MISS-3 | `challengedAmount <= collateralBalance` per position | **HIGH** |
| MISS-4 | Savings interest <= equity() | **HIGH** |
| MISS-5 | Flash loan net-to-zero in PositionRoller | **HIGH** |
| MISS-6 | Leadrate ticks monotonically non-decreasing | MEDIUM |
| MISS-7 | nDEPS supply <= type(uint96).max | MEDIUM |
| MISS-8 | Same-block challenge avert prevented | MEDIUM |

### 10.4 Handler Coverage Gaps

The fuzzing handler exercises Position + MintingHub operations but **does not cover**:

| Module | Missing Actions |
|--------|----------------|
| Savings | save, withdraw, claimInterest, refreshBalance, rate changes |
| Equity | invest, redeem, kamikaze |
| PositionRoller | roll, rollNative |
| StablecoinBridge | mint, burn |
| Governance | denyMinter, deny (position), proposeChange |
| Multi-position | Multiple concurrent positions, multiple concurrent challenges |
| Challenge Phase 1 | Aversion bidding (marked TODO in handler) |

### 10.5 Unit Test Coverage

**Strengths**:
- 244+ revert/throw assertions across all test files
- PositionTests.ts alone is 2,518 lines covering full position lifecycle
- NativeCoinTests.ts (758 lines) and NativeChallengeTests.ts (713 lines) provide thorough ETH path testing
- Strong access control violation testing
- Boundary condition testing present

**Gaps**:
- **No multi-position orchestration**: Tests typically use one position at a time
- **No stress/load tests**: No tests of system under extreme minting/debt loads
- **Limited governance testing**: PluginVetoTests is only 109 lines
- **No cross-collateral flows**: Tests use single collateral tokens

### 10.6 CI/CD

- `.github/workflows/test.yml`: Runs Hardhat tests on push/PR to dev/main
- **No Foundry tests in CI**: The invariant suite runs locally but is not in the GitHub Actions pipeline
- **No Slither in CI**: Static analysis is run manually
- **No coverage enforcement**: Coverage tool exists but no minimum threshold enforced

### 10.7 Linting & Formatting

- **solhint**: Configured with recommended rules + max-line-length (140), compiler-version warning, func-visibility warning
- **prettier + prettier-plugin-solidity**: Configured for formatting
- **solidity-coverage**: Configured, skips test/ and utils/

### Recommendations

- **CRITICAL**: Add the reserve solvency invariant (MISS-1) to the Foundry test suite
- **CRITICAL**: Add flash loan net-to-zero invariant (MISS-5)
- **HIGH**: Expand the invariant handler to cover Savings, Equity, and PositionRoller
- **HIGH**: Add Foundry invariant tests to CI (GitHub Actions)
- **HIGH**: Add Slither to CI with `--fail-on high` threshold
- **MEDIUM**: Add challenge Phase 1 (aversion) to the fuzz handler
- **MEDIUM**: Add multi-position scenarios to invariant testing
- **MEDIUM**: Enforce coverage thresholds in CI
- **LOW**: Add mutation testing (e.g., Gambit) to validate test effectiveness

---

## 11. Platform-Specific Guidance (Solidity)

### Compiler Version

- **Current**: 0.8.26 — this is a recent stable release
- **Recommendation**: Acceptable. Monitor for 0.8.27+ patches if any EVM-level changes affect the protocol.

### Pragma Versions

- **Issue**: Most contracts use `^0.8.0` which is very permissive
- **Recommendation**: Tighten to `>=0.8.25 <0.9.0` to prevent accidental compilation with older versions that lack features the code implicitly relies on

### Inline Assembly

- **Only in PositionFactory.sol:58-68**: Standard ERC-1167 clone creation bytecode
- **Assessment**: Acceptable. Well-audited pattern. No custom assembly logic.

### Compiler Warnings

- **Optimizer**: Enabled with 200 runs (consistent across Hardhat and Foundry)
- **Via-IR**: Not enabled (not required, potential marginal optimization)
- **solhint warnings**: Configured but not enforced as errors in CI

### SafeERC20

- **Current state**: `SafeERC20` is used in `StablecoinBridge` but **not** in `Position` or `MintingHub`
- **Mitigated by**: Collateral validation at admission (MintingHub.sol:148-155 verifies tokens revert on failure)
- **Recommendation**: The current approach is acceptable given the admission check, but `SafeERC20` would provide defense-in-depth for the 31 unchecked transfer instances flagged by Slither

---

## Prioritized Recommendations

### CRITICAL (Address Immediately)

| # | Finding | Location | Action |
|---|---------|----------|--------|
| C-1 | Reserve solvency invariant not fuzzed | foundry-test/invariant/ | Add `invariant_reserveCoversMiniterReserve(): balanceOf(reserve) >= minterReserve()` |
| C-2 | Flash loan net-to-zero not tested under fuzzing | foundry-test/invariant/ | Add PositionRoller actions to handler; verify Roller never holds dEURO |
| C-3 | Savings.sol public API lacks NatSpec | Savings.sol:45-165 | Add @notice/@param/@return to all 8 public functions |

### HIGH (Address Before Deployment)

| # | Finding | Location | Action |
|---|---------|----------|--------|
| H-1 | Implicit allowance override undocumented | DecentralizedEURO.sol:114-131 | Add comprehensive @dev explaining the trust model |
| H-2 | No Slither or Foundry tests in CI | .github/workflows/test.yml | Add Slither `--fail-on high` and `forge test` to CI pipeline |
| H-3 | Invariant handler missing Savings/Equity/Roller | foundry-test/invariant/Handler.t.sol | Expand handler with save/withdraw/invest/redeem/roll actions |
| H-4 | No events for challenge state changes on Position | Position.sol:858-906 | Add events or document MintingHub events as canonical source |
| H-5 | No front-running protection on bid() | MintingHub.sol:270 | Add `_maxPrice` parameter for Phase 2 bidding |
| H-6 | Fee-on-transfer / rebasing tokens not blocked | MintingHub.sol:130 | Either validate in openPosition or document as accepted limitation |
| H-7 | No deployment/initialization documentation | — | Document deployment sequence, constructor parameters, and post-deployment verification |

### MEDIUM (Address for Production Quality)

| # | Finding | Location | Action |
|---|---------|----------|--------|
| M-1 | No event for position closure | Position.sol ~L760 | Emit event when `closed` transitions to true |
| M-2 | No event for kamikaze vote destruction | Equity.sol:285 | Emit event for governance tracking |
| M-3 | Magic number `980` (2% fee) in Equity | Equity.sol:353,414 | Extract to named constant |
| M-4 | Pragma versions too permissive | All contracts | Tighten from `^0.8.0` to `>=0.8.25 <0.9.0` |
| M-5 | Interest formula undocumented | Position.sol ~L520 | Add @dev explaining the accrual formula |
| M-6 | Challenge Phase 1 aversion not fuzzed | Handler.t.sol | Add Phase 1 bid action to invariant handler |
| M-7 | Coverage thresholds not enforced | CI | Add minimum coverage gate to GitHub Actions |
| M-8 | Reentrancy in _adjust() documented but unguarded | Position.sol:365-394 | Add `nonReentrant` or document accepted risk |

### LOW (Nice to Have)

| # | Finding | Location | Action |
|---|---------|----------|--------|
| L-1 | `Trade.who` not indexed in Equity events | Equity.sol:92 | Add `indexed` to `who` parameter |
| L-2 | No event for compounding mode change | Savings.sol:114 | Emit event when preference changes |
| L-3 | Bonding curve math undocumented | Equity.sol | Add @dev explaining the 5th-root economic rationale |
| L-4 | Vote anchor time-shifting undocumented | Equity.sol ~L170 | Add @dev for the 20-bit sub-second resolution |
| L-5 | Mutation testing not set up | — | Consider Gambit for test effectiveness validation |
| L-6 | Min nDEPS price magic number | Equity.sol:116 | Document or name `10**14` constant |

---

## Overall Assessment

### Strengths

1. **Clean architecture**: No upgradeability complexity, no delegatecall, no oracle dependencies. The system is fully on-chain and self-contained.
2. **Excellent function composition**: Small focused functions, clean separation of validation/logic/effects, disciplined modifier usage with no state-mutating modifiers.
3. **Strong inheritance design**: Shallow hierarchies (max 4 levels), no diamond problems, intentional and correct overrides.
4. **Comprehensive access control**: 8 modifiers on Position, `minterOnly` on dEURO, governance quorum gates. All critical state transitions are guarded.
5. **Advanced gas optimization**: Tight variable packing (uint40 timestamps, uint24 rates, uint192+uint64 slot pairs), custom errors throughout, lazy interest accrual.
6. **Good dependency management**: OpenZeppelin v5, no vendored code, consistent compiler settings across Hardhat and Foundry.
7. **Substantial test suite**: ~10,500 lines of tests (4.8:1 ratio), 13 invariants, 11 fuzzed handler actions, 244+ revert assertions.

### Areas for Improvement

1. **Testing gaps**: The invariant suite does not cover Savings, Equity, PositionRoller, or multi-position scenarios. The 8 missing critical invariants (especially reserve solvency) need to be added.
2. **CI/CD incomplete**: Foundry tests and Slither not in CI pipeline. No coverage enforcement.
3. **Documentation gaps**: Savings.sol lacks NatSpec. The implicit allowance mechanism is the most critical undocumented behavior. No deployment docs.
4. **Event gaps**: Position challenge state changes and position closure lack events.
5. **Token safety**: Fee-on-transfer and rebasing tokens are not explicitly blocked as collateral.

### Production Readiness Score

| Category | Score | Notes |
|----------|-------|-------|
| Documentation | 7/10 | Good high-level docs, gaps in NatSpec and specifications |
| Architecture | 9/10 | Clean, immutable, no upgradeability complexity |
| Implementation | 9/10 | Professional quality, disciplined patterns |
| Testing | 7/10 | Strong foundation but missing critical invariants and module coverage |
| CI/CD | 5/10 | Only Hardhat unit tests in CI; no static analysis, no Foundry, no coverage gates |
| Dependencies | 9/10 | Current versions, well-managed, minimal custom code |
| **Overall** | **7.5/10** | Solid codebase with excellent architecture. Primary gaps are in test coverage breadth and CI automation. |

---

## Path to Production

### Phase 1: Critical (1-2 weeks)
1. Add reserve solvency + flash loan net-zero invariants
2. Add NatSpec to Savings.sol
3. Document implicit allowance mechanism
4. Add Slither + Foundry tests to CI

### Phase 2: High Priority (2-4 weeks)
5. Expand invariant handler (Savings, Equity, Roller)
6. Add front-running protection to bid()
7. Document deployment procedure
8. Address fee-on-transfer collateral decision

### Phase 3: Polish (4-6 weeks)
9. Add missing events (challenge state, position closure, kamikaze)
10. Tighten pragma versions
11. Extract magic numbers to constants
12. Add mutation testing

---

*This assessment follows the [Trail of Bits Building Secure Contracts](https://github.com/crytic/building-secure-contracts) development guidelines framework. It covers all 11 assessment areas: Documentation, On-chain/Off-chain Computation, Upgradeability, Delegatecall Proxies, Function Composition, Inheritance, Events, Common Pitfalls, Dependencies, Testing, and Platform-Specific Guidance.*
