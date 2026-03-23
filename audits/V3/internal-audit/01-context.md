# dEuro Smart Contracts — Deep Audit Context

---

## Phase 1: Initial Orientation (Bottom-Up Scan)

### 1.1 System Overview

The dEuro system is a decentralized stablecoin protocol tracking the Euro, architecturally similar to Frankencoin (ZCHF). It implements:

- **Collateralized Debt Positions (CDPs):** Users deposit collateral, mint dEURO against it
- **Governance via equity shares (nDEPS):** Time-weighted voting with veto power
- **Interest rate system:** System-wide "leadrate" plus per-position risk premiums
- **Savings module:** Depositors earn interest from the reserve
- **Challenge mechanism:** Dutch auction liquidations for undercollateralized positions
- **Stablecoin bridge:** 1:1 bridging with trusted Euro stablecoins

### 1.2 Major Modules & Files

| Module | Contract | Role |
|---|---|---|
| Core Token | DecentralizedEURO.sol | ERC-20 stablecoin with minter registry, reserve accounting |
| Equity/Governance | Equity.sol | nDEPS share token, bonding curve, time-weighted voting |
| MintingHub | MintingHub.sol | Central CDP coordinator, challenge management |
| Position | Position.sol | Individual CDP logic, collateral/debt management |
| PositionFactory | PositionFactory.sol | ERC-1167 clone factory for positions |
| PositionRoller | PositionRoller.sol | Flash-loan-based position rollover |
| Savings | Savings.sol | Interest-bearing deposits (inherits Leadrate) |
| SavingsVaultDEURO | SavingsVaultDEURO.sol | ERC-4626 vault wrapper for Savings |
| Leadrate | Leadrate.sol | System-wide interest rate with tick accumulation |
| StablecoinBridge | StablecoinBridge.sol | 1:1 bridge to trusted stablecoins |
| BridgedToken | BridgedToken.sol | Optimism-compatible bridged token |
| DEPSWrapper | DEPSWrapper.sol | ERC-20 wrapper for nDEPS |
| MathUtil | MathUtil.sol | 5th root, decimal math, PPM ceiling division |
| ERC3009 | ERC3009.sol | Meta-transaction support (transferWithAuthorization) |

### 1.3 Actors

| Actor | Description | Entry Points |
|---|---|---|
| Position Owner | Opens positions, deposits collateral, mints/repays dEURO | adjust, mint, repay, withdrawCollateral, adjustPrice |
| Challenger | Provides collateral to challenge undercollateralized positions | challenge, bid (to cancel own challenge) |
| Bidder | Bids on challenged collateral during Dutch auctions | bid |
| Equity Investor | Buys/redeems nDEPS shares | invest, redeem |
| Saver | Deposits dEURO into savings for interest | save, withdraw, claimInterest |
| Governance (Qualified nDEPS holder) | Vetoes minters/positions, proposes rate changes | denyMinter, deny (on Position), proposeChange |
| Minter (Contract) | Approved contract that can mint dEURO | mintWithReserve, burnFromWithReserve, etc. |
| Bridge User | Swaps between trusted stablecoin and dEURO | mint, burn on StablecoinBridge |
| Anyone | Buys expired collateral, applies rate changes | buyExpiredCollateral, applyChange |

### 1.4 Important State Variables

| Variable | Contract | Purpose |
|---|---|---|
| minterReserveE6 | DecentralizedEURO | Minter's share of reserve (6 extra digits) |
| minters | DecentralizedEURO | Map: address → validityStart timestamp |
| positions | DecentralizedEURO | Map: position → registering minter |
| totalVotesAtAnchor / totalVotesAnchorTime | Equity | Global vote tracking |
| voteAnchor | Equity | Per-address vote anchor timestamps |
| challenges[] | MintingHub | Array of active challenges |
| pendingReturns | MintingHub | Postponed collateral returns |
| price | Position | Liquidation price per unit of collateral |
| principal / interest | Position | Outstanding debt components |
| challengedAmount / challengedPrice | Position | Active challenge state |
| totalMinted | Position (original only) | Global mint tracking across clone family |
| cooldown / expiration / closed | Position | Position lifecycle state |
| fixedAnnualRatePPM | Position | Locked-in interest rate |
| currentRatePPM / nextRatePPM / nextChange | Leadrate | Rate governance state |
| ticksAnchor / anchorTime | Leadrate | Tick accumulation anchors |
| savings | Savings | Map: address → Account{saved, ticks} |
| nonCompounding / claimableInterest | Savings | Interest distribution preferences |

### 1.5 Preliminary Architecture

```
                    ┌──────────────────┐
                    │ DecentralizedEURO│ (ERC-20 stablecoin)
                    │  minters registry│
                    │  reserve acctng  │
                    └────────┬─────────┘
                             │ creates
                    ┌────────▼─────────┐
                    │     Equity       │ (nDEPS share token)
                    │ bonding curve    │ ← holds dEURO reserve
                    │ voting/governance│
                    └──────────────────┘
                             ▲
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────┴───┐  ┌──────┴──────┐  ┌───┴───────────┐
     │ MintingHub │  │   Savings   │  │StablecoinBridge│
     │ (minter)   │  │  (minter)   │  │   (minter)     │
     │ challenges │  │  interest   │  │   1:1 swap     │
     └──────┬─────┘  └─────────────┘  └────────────────┘
            │
     ┌──────▼─────┐
     │  Position   │ ←─ ERC-1167 clones from PositionFactory
     │  (per CDP)  │
     │  collateral │
     │  debt mgmt  │
     └─────────────┘
```

---

## Phase 2: Ultra-Granular Analysis — Synthesis

All four deep-analysis subagents have completed. Here is the integrated summary of critical findings organized by contract, cross-contract interactions, and system-wide invariants.

### Completed Analyses

| Contract(s) | Functions Analyzed | Key Invariants Found | Open Questions |
|---|---|---|---|
| Position.sol | 10 functions: initialize, \_mint, \_adjustPrice/\_setPrice, \_checkCollateral, notifyChallengeSucceeded, forceSale, \_payDownDebt/\_repayInterest/\_repayPrincipal/\_repayPrincipalNet, \_accrueInterest/\_calculateInterest, \_virtualPrice/\_getCollateralRequirement, \_adjust | 15+ invariants documented | 6 open questions |
| MintingHub.sol | 10 functions: openPosition, clone, challenge, \_bid, \_finishChallenge, \_avertChallenge, \_returnChallengerCollateral, \_returnCollateral/\_returnPostponedCollateral, \_buyExpiredCollateral/expiredPurchasePrice, \_calculatePrice | 10+ invariants documented | 7 open questions |
| DecentralizedEURO.sol + Equity.sol | 16+ functions across both contracts, full vote tracking analysis, bonding curve mechanics, reserve accounting | Cross-contract coupling map, fundamental accounting identity | Vote tracking transition analysis verified |
| Savings.sol + Leadrate.sol + PositionRoller.sol | 12+ functions: all Leadrate tick mechanics, all Savings deposit/withdraw/interest, full PositionRoller roll/rollNative with flash loan tracing | 7 key invariants | 6 open questions |

### Critical Cross-Contract Finding: The Implicit Allowance Mechanism

The single most important cross-contract mechanism discovered during this analysis is the `allowance()` override in DecentralizedEURO (L114-L131):

```
If (spender is a minter or a position of a minter)
AND (owner is a minter, a registered position, or the reserve)
=> allowance = type(uint256).max
```

This enables the entire system to function without explicit approvals:

- **PositionRoller** (a minter) can have its dEURO spent by Position contracts (positions of a minter) during `repay()` → `collectProfits()`/`burnFromWithReserve()`
- **MintingHub** (a minter) can transfer dEURO between system entities
- **Positions** can transfer dEURO from the reserve (Equity contract)

The PositionRoller must be a registered minter for the flash mint to work, which then also satisfies the implicit allowance condition (`isMinter(owner)` where `owner = PositionRoller`). This is a critical trust relationship.

### Key Observation: DecentralizedEURO Implicit Allowances (L114-L131)

The `allowance()` override in DecentralizedEURO provides unlimited implicit allowances between system contracts:

```solidity
// Line 120-131
if (spender == address(reserve)) {
    return type(uint256).max;  // Reserve can spend anyone's dEURO
}

if (
    (isMinter(spender) || isMinter(getPositionParent(spender))) &&
    (isMinter(owner) || positions[owner] != address(0) || owner == address(reserve))
) {
    return type(uint256).max;  // Minters/positions have infinite allowance with each other
}
```

This means:

- Any registered minter or position can spend dEURO from any other minter, position, or the reserve without explicit approval
- The PositionRoller (which is a registered minter) gets implicit infinite allowance from positions
- `collectProfits(payer, amount)` calls `_spendAllowance(payer, msg.sender, amount)` where `msg.sender` is a Position (a registered contract) — this works because the PositionRoller is a minter

---

## Phase 3: Global System Understanding

### 3.1 State & Invariant Reconstruction

#### Core System Invariants

**INV-1: Reserve Balance Coverage**
`balanceOf(reserve) >= minterReserve()`
Under normal conditions. Can be violated during severe losses (handled by `_effectiveReservePPM` proportional reduction).

**INV-2: equity() Definition**
`equity() = balanceOf(reserve) - minterReserve()`
When `balanceOf(reserve) > minterReserve()`, else 0.

**INV-3: minterReserveE6 Consistency**
For each minting: `minterReserveE6 += amount * reservePPM`
For each burning: `minterReserveE6 -= amount * reservePPM`
The E6 suffix provides 6 extra digits to avoid rounding when converting to `minterReserve() = minterReserveE6 / 1_000_000`.

**INV-4: Position Collateralization**
`collateralBalance * price >= getCollateralRequirement() * ONE_DEC18`
where `getCollateralRequirement() = principal + ceilDiv(interest, 1 - reserveContribution/1M)`.
Enforced by `_checkCollateral()`, which treats `collateralBalance < minimumCollateral` as zero.

**INV-5: Position Limit**
`Position(original).totalMinted <= limit`
Each mint checks `availableForMinting()`. The original reserves capacity for itself based on its own `collateral * price`.

**INV-6: Challenge Size Tracking**
`challengedAmount` tracks total collateral under challenge.
`challengedAmount` is decremented on avert/succeed.

**INV-7: Total Supply of Shares**
`Equity.totalSupply() <= type(uint96).max`
Enforced in `_invest()` to prevent overflow in vote calculations.

**INV-8: Savings Interest Cap**
`earnedInterest <= equity()`
Savings interest is capped by available equity to prevent draining the system.

#### State Transitions

**Position Lifecycle:**

```
Created → Init Period (can be denied) → Active (can mint/repay/challenge)
  → Cooldown (minting suspended) → Active
  → Challenged (minting blocked) → Active or Liquidated
  → Expired → Force Sale possible
  → Closed (below minimum collateral or denied)
```

**Challenge Lifecycle:**

```
challenge() → Phase 1 (avert period, duration = challengePeriod)
  → bid() during Phase 1 = Avert (buyer pays liqPrice to challenger)
  → Phase 2 (Dutch auction, duration = challengePeriod)
    → bid() during Phase 2 = Succeed (declining price, bidder gets collateral)
  → Price reaches 0 (free collateral)
```

### 3.2 Workflow Reconstruction

#### Workflow 1: Position Creation & Minting

1. User calls `MintingHub.openPosition()` with collateral parameters
2. MintingHub validates parameters (reserve >= 2% challenger reward, challenge >= 1 day, init >= 3 days, decimals <= 24, min value >= 500 dEURO, collateral must revert on failed transfer)
3. `PositionFactory.createNewPosition()` deploys a new Position contract
4. DecentralizedEURO registers the position (`positions[pos] = hub`)
5. Opening fee (1000 dEURO) collected from user
6. Collateral transferred to position
7. Position enters init period (>= 3 days) — can be denied by qualified voters
8. After init period, owner can call `Position.mint()` or `Position.adjust()`
9. Minting: checks no challenge, no cooldown, alive, backed, within limit
10. `deuro.mintWithReserve()`: mints to target `(1 - reservePPM)`, rest to reserve
11. `minterReserveE6 += amount * reservePPM`

#### Workflow 2: Challenge & Liquidation

1. Challenger calls `MintingHub.challenge()` with collateral amount
2. Challenger provides matching collateral (transferred to MintingHub)
3. Position notified: `challengedAmount += size`, `challengedPrice = virtualPrice`
4. **Phase 1 (Avert Period):** Anyone can call `bid()` to avert
   - Averter pays `size * liqPrice / 1e18` in dEURO to challenger
   - Challenger's collateral returned to averter
   - Position gets 1-day cooldown
5. **Phase 2 (Dutch Auction):** Price declines from `liqPrice` to 0
   - Bidder calls `bid()`, pays declining unit price
   - 2% challenger reward deducted from bid proceeds
   - Remaining funds: repay interest (as profit), repay principal (burn with reserve)
   - If funds insufficient: `coverLoss()` from reserve
   - If funds surplus: `reservePPM%` to profits, rest to position owner
   - Challenged collateral transferred to bidder

#### Workflow 3: Interest Accrual & Repayment

1. Interest accrues continuously: `newInterest = principal * (1M - reserveContribution) * fixedAnnualRatePPM * delta / (365 days * 1M * 1M)`
2. Key: Interest is computed on `principal * (1 - reserveContribution/1M)`, not full principal
3. `_accrueInterest()` is called before any state-changing operation
4. On mint, rate is re-fixed to current `leadrate + riskPremium`
5. Repayment priority: interest first (collected as profit), then principal (burned with reserve)
6. `_repayPrincipal`: burns repayment amount, `returnedReserve` comes back from reserve
7. `_repayPrincipalNet`: works with net amounts (excluding reserves), used in `forceSale`

#### Workflow 4: Savings Interest

1. User calls `Savings.save()` to deposit dEURO
2. Savings contract holds the dEURO directly
3. Interest accrues via Leadrate ticks: `interest = (deltaTicks * saved) / 1M / 365 days`
4. On `refresh()`: calls `deuro.distributeProfits()` to get interest from reserve
5. If compounding: interest added to `account.saved`
6. If non-compounding: interest added to `claimableInterest`
7. Interest capped by `equity()` to prevent system drain

#### Workflow 5: Equity Investment/Redemption

1. **Investment:** user sends dEURO, receives nDEPS
   - Shares = f(equity before, investment) using 5th-root bonding curve
   - 2% fee on investment
   - Minimum equity of 1000 dEURO required
2. **Redemption:** user burns nDEPS, receives dEURO
   - Proceeds = `equity * (1 - ((totalShares - shares*0.98) / totalShares)^5)`
   - 2% fee on redemption
   - 90-day average holding requirement
   - Cannot redeem last share (`totalSupply` must stay > 0)

### 3.3 Trust Boundary Mapping

| Boundary | Trust Level | Notes |
|---|---|---|
| Position Owner → Position | Owner-controlled | Can mint, repay, withdraw, adjust price |
| MintingHub → Position | Trusted (onlyHub) | Hub is set at construction, immutable |
| PositionRoller → Position | Semi-trusted (ownerOrRoller) | Can mint and withdrawCollateral |
| DecentralizedEURO → Minters | Governance-gated | Minters approved after application period |
| Challenger → MintingHub | Untrusted | Challenger provides collateral, anyone can be a challenger |
| Bidder → MintingHub | Untrusted | Provides dEURO for challenged collateral |
| Savings → DecentralizedEURO | Minter relationship | Savings calls distributeProfits to get interest |
| StablecoinBridge → DecentralizedEURO | Minter relationship | Mints/burns 1:1 with source stablecoin |
| External Collateral Token → Position | Untrusted | Validated at creation (must revert on failed transfers, decimals <= 24) |

### 3.4 Complexity & Fragility Clusters

**Cluster 1: Reserve Accounting (HIGH)**
- `minterReserveE6` must stay consistent across all mint/burn operations
- `_effectiveReservePPM` handles shortfall proportionally
- `burnFromWithReserve` takes from both payer and reserve
- `_withdrawFromReserve` can mint new dEURO if reserve is depleted
- Multiple entry points modify `minterReserveE6`: `mintWithReserve`, `burnWithoutReserve`, `burnFromWithReserve`

**Cluster 2: Challenge Settlement (HIGH)**
- `_finishChallenge` has complex fund flow: bid → challenger reward → interest repay → principal repay → loss coverage / owner surplus
- `notifyChallengeSucceeded` proportionally reduces debt based on `_size / colBal`
- Rounding in proportional debt reduction
- Interaction between `challengedAmount`, `virtualPrice`, and debt calculations

**Cluster 3: Position Price & Collateral Checks (HIGH)**
- `virtualPrice` is dynamic: `max(floorPrice, collateralRequirement * 1e18 / colBalance)`
- During challenges, `virtualPrice` is frozen at `challengedPrice`
- `_checkCollateral` treats sub-minimum collateral as zero
- `_setPrice` bounds: `price * colBalance <= bounds * 1e18` AND `newPrice <= 2 * oldPrice` (after start)
- Price reference bypass for cooldown

**Cluster 4: Interest Accrual (MEDIUM)**
- Continuous accrual with fixed rate locked at mint time
- Rate re-fixed on each new mint
- Interest overcollateralization via `_ceilDivPPM(interest, reserveContribution)`
- Interaction between interest accrual and challenge proportional settlement

**Cluster 5: Flash Loan in PositionRoller (MEDIUM)**
- Roller flash-mints dEURO, repays source position, mints from target, burns flash loan
- Atomicity assumption: entire roll must complete in one tx
- Collateral handling: source → roller → target or user
- Clone creation within the roll flow

**Cluster 6: Savings Interest Distribution (MEDIUM)**
- Interest capped by `equity()`
- `distributeProfits` can mint if reserve is depleted
- Compounding mode can be changed retroactively (sets mode before settling pending interest)
- SavingsVaultDEURO wraps Savings with ERC-4626 but `_accrueInterest` only updates `totalClaimed` counter (no actual claim)

**Cluster 7: Vote Tracking (MEDIUM)**
- Time-weighted voting with sub-second resolution (20 bits)
- Vote anchor arithmetic during transfers
- Rounding loss tracking in `_adjustRecipientVoteAnchor`
- Recursive delegation in `_canVoteFor` (unbounded depth)
- Kamikaze vote destruction mechanism

---

## System-Wide Invariant Map

| ID | Invariant | Scope | Enforcement |
|---|---|---|---|
| SYS-1 | `balanceOf(reserve) = minterReserve() + equity()` | DecentralizedEURO ↔ Equity | By construction of `equity()` and `minterReserveE6` |
| SYS-2 | `collateral * price >= collateralRequirement * 1e18` | Position | `_checkCollateral()` after every mutation |
| SYS-3 | `Position(original).totalMinted <= limit` | Position family | `availableForMinting()` check in `_mint()` |
| SYS-4 | `interest` is monotonically non-decreasing | Position | `if (newInterest > interest)` guard in `_accrueInterest()` |
| SYS-5 | `challengedAmount` tracks total challenged collateral | Position ↔ MintingHub | Incremented by `notifyChallengeStarted`, decremented by `notifyChallengeAverted`/`notifyChallengeSucceeded` |
| SYS-6 | Flash loans net to zero | PositionRoller | `mint(repay)` at start, `burnFrom(msg.sender, repay)` at end |
| SYS-7 | Savings interest ≤ `equity()` | Savings | `calculateInterest()` caps at equity |
| SYS-8 | Leadrate ticks are monotonically non-decreasing | Leadrate | Piecewise-linear with non-negative rates |
| SYS-9 | `nDEPS supply ≤ type(uint96).max` | Equity | Checked in `_invest()` |
| SYS-10 | Same-block challenge avert prevented | MintingHub | `require(block.timestamp != _challenge.start)` |

---

## Consolidated Open Questions (Requiring Further Investigation)

### High-Priority

1. **Multiple concurrent challenges and challengedPrice locking:** When the first challenge sets `challengedPrice` (Position.sol L863), all subsequent concurrent challenges use this locked price for `virtualPrice`. If the position's economic reality changes between challenges, the locked price may be stale. Settlement of partial challenges does not reset `challengedPrice` until `challengedAmount` reaches 0.

2. **\_repayPrincipalNet under severe reserve depletion:** When `calculateAssignedReserve` returns near-zero due to reserve depletion, `maxRepayment` approaches `principal`, meaning the buyer must cover nearly the full principal. The assert at L842 may fail if `calculateFreedAmount` and `calculateAssignedReserve` become inconsistent under extreme conditions.

3. **save(uint192, bool) compounding mode ordering:** Setting the compounding mode BEFORE settling pending interest means unsettled interest from the previous period is settled under the NEW mode. A user switching from compounding to non-compounding would have their accumulated interest placed in `claimableInterest` rather than added to `saved`.

4. **Challenge array indexing type mismatch:** `challenge()` returns `uint256` but `bid()` accepts `uint32`. After 2^32 challenges, later challenges cannot be bid on.

### Medium-Priority

5. **Fee-on-transfer collateral tokens:** Position `_adjust()` passes `newCollateral` to `_mint()` as the collateral balance, but fee-on-transfer tokens would result in actual balance being less than `newCollateral`. The `openPosition` collateral validation (L148-155) does not explicitly test for fee-on-transfer.

6. **\_checkCollateral not called after forceSale:** Partial force sales may leave the position undercollateralized with no invariant enforcement until the next force sale or complete collateral drain.

7. **Savings refresh ordering within a block:** When multiple accounts are refreshed, each `distributeProfits` call draws from the reserve. The first refresh sees full equity; subsequent refreshes see reduced equity. This creates ordering-dependent interest distribution.

8. **returnPostponedCollateral with zero amount:** If `pendingReturns` is 0, the function transfers 0 tokens. Some ERC20 tokens revert on zero-amount transfers.

9. **\_buyExpiredCollateral native path approval residual:** `DEURO.approve(address(pos), costs)` at MintingHub L523 may leave a non-zero approval after `forceSale`.

10. **Tick overflow:** `uint64` for `ticksAnchor` overflow is theoretically possible over extreme durations. Need to verify against realistic deployment parameters.

---

## Refined Trust Boundary Map

```
                    TRUST LEVEL: FULL
                    ┌─────────────────────────────────────────┐
                    │  DecentralizedEURO (dEURO token)        │
                    │  ├── Equity (reserve/governance)        │
                    │  ├── MintingHub (CDP coordinator)       │
                    │  ├── Savings (interest module)          │
                    │  ├── StablecoinBridge (1:1 bridge)      │
                    │  └── PositionRoller (flash rollover)    │
                    │                                         │
                    │  Implicit max allowance between all ──┐ │
                    │  registered minters & positions       │ │
                    └──────────────────────────────────────┘ │
                                                             │
                    TRUST LEVEL: POSITION-SPECIFIC           │
                    ┌──────────────────────────────────┐     │
                    │  Position contracts (CDPs)        │◄────┘
                    │  - Registered by MintingHub       │
                    │  - hub immutable = MintingHub     │
                    │  - Cloned via ERC-1167 proxies    │
                    │  - Owner can mint/repay/withdraw  │
                    │  - Roller has ownerOrRoller access │
                    └──────────────────────────────────┘

                    TRUST LEVEL: UNTRUSTED
                    ┌──────────────────────────────────┐
                    │  External collateral tokens       │
                    │  Challengers / Bidders             │
                    │  Position owners (EOAs)            │
                    │  Savers                            │
                    └──────────────────────────────────┘
```

---

This completes the deep audit context building across all 13 concrete contracts in the dEuro system. The analysis covers:

- **Phase 1:** Full initial orientation with module map, actor identification, and state variable catalog
- **Phase 2:** Ultra-granular per-function analysis of 48+ critical functions across Position, MintingHub, DecentralizedEURO, Equity, Savings, Leadrate, and PositionRoller
- **Phase 3:** Global system understanding including invariant reconstruction, workflow tracing, trust boundary mapping, and complexity clustering

The context is now ready for the vulnerability discovery phase.
