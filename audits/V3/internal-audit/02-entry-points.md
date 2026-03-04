# Entry Point Analysis: dEuro Smart Contracts

**Analyzed**: 2026-03-03
**Scope**: `contracts/` (excluding `contracts/test/`)
**Languages**: Solidity ^0.8.0
**Focus**: State-changing functions only (view/pure excluded)
**Method**: Slither `--print entry-points` + manual access control verification

---

## Summary

| Category | Count |
|----------|-------|
| Public (Unrestricted) | 64 |
| Role-Restricted: Minter | 10 |
| Role-Restricted: Position Owner | 8 |
| Role-Restricted: Owner or Roller | 2 |
| Role-Restricted: Position Owner (via Roller) | 6 |
| Role-Restricted: Governance (2% quorum) | 5 |
| Role-Restricted: Governance (crisis) | 1 |
| Role-Restricted: Governance (10% quorum) | 1 |
| Restricted (Review Required) | 3 |
| Contract-Only | 12 |
| **Total** | **112** |

---

## Public Entry Points (Unrestricted)

State-changing functions callable by anyone — prioritize for attack surface analysis.

### Core Protocol Functions

| Function | File | Notes |
|----------|------|-------|
| `suggestMinter(address,uint256,uint256,string)` | `DecentralizedEURO.sol:95` | Pays 1000 dEURO fee + application period. Registers new minter candidate. |
| `burn(uint256)` | `DecentralizedEURO.sol:196` | Burns caller's own dEURO |
| `openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24)` | `MintingHub.sol:130` | Creates new CDP. Pays 1000 dEURO fee. Payable (WETH). |
| `clone(address,address,uint256,uint256,uint40,uint256)` | `MintingHub.sol:195` | Clones existing position. `validPos(parent)`. Caller sets `owner` param. Payable. |
| `challenge(address,uint256,uint256)` | `MintingHub.sol:233` | Starts Dutch auction challenge. `validPos`. Payable. Challenger provides collateral. |
| `bid(uint32,uint256,bool,bool)` | `MintingHub.sol:270` | Bids on challenge. Averts (phase 1) or buys collateral (phase 2). |
| `bid(uint32,uint256,bool)` | `MintingHub.sol:277` | Backward-compatible bid overload. |
| `returnPostponedCollateral(address,address,bool)` | `MintingHub.sol:424` | Withdraws caller's own postponed collateral. |
| `returnPostponedCollateral(address,address)` | `MintingHub.sol:431` | Backward-compatible overload. |
| `buyExpiredCollateral(IPosition,uint256,bool)` | `MintingHub.sol:498` | Buys collateral from expired position. `validPos`. |
| `buyExpiredCollateral(IPosition,uint256)` | `MintingHub.sol:505` | Backward-compatible overload. `validPos`. |
| `applyChange()` | `MintingHub.sol` (via Leadrate:55) | Applies pending leadrate change. Anyone can trigger after delay. |
| `repay(uint256)` | `Position.sol:617` | Anyone can repay debt on any position. |
| `repayFull()` | `Position.sol:623` | Repays all debt. |

### Savings Functions

| Function | File | Notes |
|----------|------|-------|
| `refreshMyBalance()` | `Savings.sol:45` | Triggers interest accrual for caller. |
| `refreshBalance(address)` | `Savings.sol:55` | Triggers interest accrual for any account. |
| `save(uint192)` | `Savings.sol:105` | Deposits dEURO into savings. Requires `currentRatePPM > 0`. |
| `save(uint192,bool)` | `Savings.sol:114` | Deposits + sets compounding mode. Mode applied BEFORE settling pending interest. |
| `save(address,uint192)` | `Savings.sol:131` | Deposits dEURO on behalf of another address. |
| `adjust(uint192)` | `Savings.sol:119` | Sets target savings balance (deposits or withdraws). |
| `withdraw(address,uint192)` | `Savings.sol:146` | Withdraws caller's savings. |
| `claimInterest(address)` | `Savings.sol:159` | Claims non-compounding interest. |
| `applyChange()` | `Savings.sol` (via Leadrate:55) | Applies pending savings rate change. |

### Equity Investment/Redemption

| Function | File | Notes |
|----------|------|-------|
| `invest(uint256,uint256)` | `Equity.sol:318` | Buys nDEPS shares. 2% fee. Min 1000 dEURO equity. |
| `redeem(address,uint256)` | `Equity.sol:365` | Sells nDEPS. 90-day avg holding period enforced. |
| `redeemExpected(address,uint256,uint256)` | `Equity.sol:373` | Redeem with front-running protection. |
| `redeemFrom(address,address,uint256,uint256)` | `Equity.sol:383` | Redeem via allowance. |
| `delegateVoteTo(address)` | `Equity.sol:259` | Delegates voting power. |
| `kamikaze(address[],uint256)` | `Equity.sol:285` | Destroys own votes + targets' votes. |

### Stablecoin Bridge

| Function | File | Notes |
|----------|------|-------|
| `mint(uint256)` | `StablecoinBridge.sol:60` | Converts source stablecoin to dEURO. Checks `!stopped`, `!expired`, `<= limit`. |
| `mintTo(address,uint256)` | `StablecoinBridge.sol:69` | Mint to specific target. |
| `burn(uint256)` | `StablecoinBridge.sol:89` | Burns dEURO, returns source stablecoin. |
| `burnAndSend(address,uint256)` | `StablecoinBridge.sol:96` | Burns + sends source stablecoin to target. |

### ERC-4626 Vault

| Function | File | Notes |
|----------|------|-------|
| `deposit(uint256,address)` | `SavingsVaultDEURO.sol` (ERC4626) | Deposits dEURO, mints vault shares. |
| `mint(uint256,address)` | `SavingsVaultDEURO.sol` (ERC4626) | Mints exact vault shares. |
| `withdraw(uint256,address,address)` | `SavingsVaultDEURO.sol` (ERC4626) | Withdraws assets from vault. |
| `redeem(uint256,address,address)` | `SavingsVaultDEURO.sol` (ERC4626) | Redeems shares for assets. |

### DEPSWrapper

| Function | File | Notes |
|----------|------|-------|
| `wrap(uint256)` | `DEPSWrapper.sol:24` | Wraps nDEPS into DEPS. Requires allowance. |
| `unwrap(uint256)` | `DEPSWrapper.sol:28` | Unwraps DEPS back to nDEPS. |
| `unwrapAndSell(uint256)` | `DEPSWrapper.sol:48` | Unwraps + redeems nDEPS for dEURO. Bypasses 90-day hold if wrapper contract qualifies. |
| `depositFor(address,uint256)` | `DEPSWrapper.sol` (ERC20Wrapper) | Deposits nDEPS for specified address. |
| `withdrawTo(address,uint256)` | `DEPSWrapper.sol` (ERC20Wrapper) | Withdraws nDEPS to specified address. |

### Standard ERC-20 Token Operations (across all token contracts)

| Function | Contracts | Notes |
|----------|-----------|-------|
| `transfer(address,uint256)` | DecentralizedEURO, Equity, SavingsVaultDEURO, DEPSWrapper, BridgedToken | Standard ERC-20 |
| `approve(address,uint256)` | DecentralizedEURO, Equity, SavingsVaultDEURO, DEPSWrapper, BridgedToken | Standard ERC-20 |
| `transferFrom(address,address,uint256)` | DecentralizedEURO, Equity, SavingsVaultDEURO, DEPSWrapper, BridgedToken | Standard ERC-20. Note: DecentralizedEURO has custom `allowance()` override. |
| `permit(address,address,uint256,uint256,uint8,bytes32,bytes32)` | DecentralizedEURO, Equity, DEPSWrapper, BridgedToken | ERC-2612 |

### ERC-3009 Meta-Transaction Operations

| Function | Contracts | Notes |
|----------|-----------|-------|
| `transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)` | DecentralizedEURO, Equity, BridgedToken | EIP-3009 |
| `receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)` | DecentralizedEURO, Equity, BridgedToken | EIP-3009 |
| `cancelAuthorization(address,bytes32,uint8,bytes32,bytes32)` | DecentralizedEURO, Equity, BridgedToken | EIP-3009 |

### Payable Receive Functions

| Function | File | Notes |
|----------|------|-------|
| `receive()` | `Position.sol:911` | Auto-wraps ETH to WETH. Guard: reverts if collateral is not WETH. |
| `receive()` | `MintingHub.sol:548` | Accepts ETH (for WETH.withdraw callbacks). |
| `receive()` | `PositionRoller.sol:222` | Accepts ETH (for WETH.withdraw callbacks + excess returns). |

---

## Role-Restricted Entry Points

### Minter (registered via governance)

Functions restricted to addresses approved as minters through the `minterOnly` modifier, or inline `isMinter()` checks. Minters include MintingHub, Savings, StablecoinBridge, and PositionRoller.

| Function | File | Restriction | Notes |
|----------|------|-------------|-------|
| `registerPosition(address)` | `DecentralizedEURO.sol:146` | `!isMinter(msg.sender)` inline | Registers position in dEURO |
| `mintWithReserve(address,uint256,uint32)` | `DecentralizedEURO.sol:182` | `minterOnly` | Mints + allocates reserve |
| `mint(address,uint256)` | `DecentralizedEURO.sol:189` | `minterOnly` | Direct mint (no reserve) |
| `burnFrom(address,uint256)` | `DecentralizedEURO.sol:203` | `minterOnly` | Burns from another address |
| `burnWithoutReserve(uint256,uint32)` | `DecentralizedEURO.sol:221` | `minterOnly` | Burns + frees reserve to equity |
| `burnFromWithReserve(address,uint256,uint32)` | `DecentralizedEURO.sol:243` | `minterOnly` | Burns from payer + reserve |
| `coverLoss(address,uint256)` | `DecentralizedEURO.sol:297` | `minterOnly` | Covers bad debt from reserve |
| `distributeProfits(address,uint256)` | `DecentralizedEURO.sol:308` | `minterOnly` | Distributes interest from reserve |
| `collectProfits(address,uint256)` | `DecentralizedEURO.sol:313` | `minterOnly` | Collects profits to reserve |
| `investFor(address,uint256,uint256)` | `Equity.sol:322` | `!dEURO.isMinter()` inline | Invest on behalf of another. Minter-only. |

### Position Owner (`onlyOwner`)

| Function | File | Restriction | Notes |
|----------|------|-------------|-------|
| `adjust(uint256,uint256,uint256,bool)` | `Position.sol:335` | `onlyOwner` + payable | All-in-one: principal, collateral, price |
| `adjustPrice(uint256)` | `Position.sol:344` | `onlyOwner` | Change liquidation price |
| `adjustPriceWithReference(uint256,address)` | `Position.sol:353` | `onlyOwner` | Price change with reference (skip cooldown) |
| `adjustWithReference(uint256,uint256,uint256,address,bool)` | `Position.sol:361` | `onlyOwner` + payable | All-in-one with reference |
| `rescueToken(address,address,uint256)` | `Position.sol:703` | `onlyOwner` | Rescue non-collateral ERC-20 tokens |
| `withdrawCollateralAsNative(address,uint256)` | `Position.sol:730` | `onlyOwner` | Withdraw collateral as ETH |
| `renounceOwnership()` | `Position.sol` (Ownable) | `onlyOwner` | Inherited. Permanently removes owner. |
| `transferOwnership(address)` | `Position.sol` (Ownable) | `onlyOwner` | Inherited. Transfers position ownership. |

### Position Owner or Roller (`ownerOrRoller`)

| Function | File | Restriction | Notes |
|----------|------|-------------|-------|
| `mint(address,uint256)` | `Position.sol:465` | `ownerOrRoller` | Mint dEURO against collateral |
| `withdrawCollateral(address,uint256)` | `Position.sol:716` | `ownerOrRoller` | Withdraw collateral |

### Position Owner (via PositionRoller)

The PositionRoller enforces `own(source)` — the caller must own the source position.

| Function | File | Restriction | Notes |
|----------|------|-------------|-------|
| `rollFully(IPosition,IPosition)` | `PositionRoller.sol:41` | `own(source)` via `roll` | Convenience: rolls entire position |
| `rollFullyWithExpiration(IPosition,IPosition,uint40)` | `PositionRoller.sol:48` | `own(source)` via `roll` | With custom expiration |
| `roll(IPosition,uint256,uint256,IPosition,uint256,uint256,uint40)` | `PositionRoller.sol:68` | `valid(source)`, `valid(target)`, `own(source)` | Full roll with flash loan |
| `rollFullyNative(IPosition,IPosition)` | `PositionRoller.sol:108` | `own(source)` via `rollNative` + payable | Native coin variant |
| `rollFullyNativeWithExpiration(IPosition,IPosition,uint40)` | `PositionRoller.sol:112` | `own(source)` via `rollNative` + payable | Native with custom expiration |
| `rollNative(IPosition,uint256,uint256,IPosition,uint256,uint256,uint40)` | `PositionRoller.sol:122` | `valid(source)`, `valid(target)`, `own(source)` + payable | Full native roll |

### Governance: Qualified nDEPS Holders (2% quorum)

These require `checkQualified(msg.sender, helpers)` which verifies that msg.sender + delegated helpers hold >= 2% of total votes.

| Function | File | Restriction | Notes |
|----------|------|-------------|-------|
| `denyMinter(address,address[],string)` | `DecentralizedEURO.sol:171` | `checkQualified` + `block.timestamp > minters[_minter]` | Veto minter during application period |
| `deny(address[],string)` | `Position.sol:284` | `checkQualified` + `block.timestamp >= start` | Veto position during init period |
| `proposeChange(uint24,address[])` | `MintingHub.sol` (via Leadrate:45) | `equity.checkQualified` | Propose MintingHub leadrate change |
| `proposeChange(uint24,address[])` | `Savings.sol` (via Leadrate:45) | `equity.checkQualified` | Propose Savings leadrate change |
| `halveHoldingDuration(address[])` | `DEPSWrapper.sol:61` | `nDEPS.checkQualified` | Halve wrapper's voting duration |

### Governance: Qualified nDEPS Holders (crisis mode)

| Function | File | Restriction | Notes |
|----------|------|-------------|-------|
| `restructureCapTable(address[],address[])` | `Equity.sol:432` | `equity < 1000 dEURO` + `checkQualified` | Wipes balances during severe loss. Emergency measure. |

### Governance: 10% Quorum

| Function | File | Restriction | Notes |
|----------|------|-------------|-------|
| `emergencyStop(address[],string)` | `StablecoinBridge.sol:112` | `votes * 10000 < 1000 * total` | Permanently stops bridge. Higher quorum than standard governance. |

---

## Restricted (Review Required)

Functions with access control patterns that need manual verification.

| Function | File | Pattern | Why Review |
|----------|------|---------|------------|
| `initialize(address,string)` | `DecentralizedEURO.sol:75` | `require(totalSupply() == 0 && reserve.totalSupply() == 0)` | One-time initializer. No explicit access control — relies on supply being 0. Race condition if not called immediately after deployment. |
| `createNewPosition(...)` | `PositionFactory.sol:12` | None | No access control. Anyone can create positions via factory. Positions not registered in dEURO unless called by a minter (MintingHub). Standalone calls create "orphan" positions. |
| `clonePosition(address)` | `PositionFactory.sol:50` | `parent.assertCloneable()` | No access control beyond parent status checks. Same orphan risk as `createNewPosition`. |

---

## Contract-Only (Internal Integration Points)

Functions only callable by specific contracts — defines trust boundaries.

### Position ← MintingHub (`onlyHub`)

| Function | File | Expected Caller |
|----------|------|-----------------|
| `initialize(address,uint40)` | `Position.sol:226` | MintingHub (during clone) |
| `forceSale(address,uint256,uint256)` | `Position.sol:664` | MintingHub (expired collateral purchase) |
| `transferChallengedCollateral(address,uint256)` | `Position.sol:750` | MintingHub (challenge settlement) |
| `notifyChallengeStarted(uint256,uint256)` | `Position.sol:858` | MintingHub (challenge initiation) |
| `notifyChallengeAverted(uint256)` | `Position.sol:870` | MintingHub (challenge avert) |
| `notifyChallengeSucceeded(uint256)` | `Position.sol:885` | MintingHub (challenge success) |

### Position ← Sibling Positions (registered with same hub)

| Function | File | Expected Caller |
|----------|------|-----------------|
| `notifyMint(uint256)` | `Position.sol:243` | Clone positions (mint tracking on original) |
| `notifyRepaid(uint256)` | `Position.sol:248` | Clone positions (repayment tracking on original) |

### MintingHub ← Positions (`validPos(msg.sender)`)

| Function | File | Expected Caller |
|----------|------|-----------------|
| `emitPositionUpdate(uint256,uint256,uint256)` | `MintingHub.sol:103` | Any registered position |
| `emitPositionDenied(address,string)` | `MintingHub.sol:107` | Any registered position |

### BridgedToken ← L2 Bridge (`onlyBridge`)

| Function | File | Expected Caller |
|----------|------|-----------------|
| `mint(address,uint256)` | `BridgedToken.sol:77` | L2 StandardBridge |
| `burn(address,uint256)` | `BridgedToken.sol:88` | L2 StandardBridge |

---

## Files Analyzed

| File | State-Changing Entry Points | Notes |
|------|----------------------------|-------|
| `contracts/DecentralizedEURO.sol` | 16 | Core stablecoin + minter registry |
| `contracts/Equity.sol` | 13 | nDEPS share token + governance |
| `contracts/MintingHubV3/Position.sol` | 22 | CDP logic (largest attack surface) |
| `contracts/MintingHubV3/MintingHub.sol` | 14 | CDP coordinator + challenges |
| `contracts/Savings.sol` | 11 | Interest-bearing deposits |
| `contracts/SavingsVaultDEURO.sol` | 7 | ERC-4626 vault wrapper |
| `contracts/StablecoinBridge.sol` | 5 | 1:1 bridge |
| `contracts/MintingHubV3/PositionRoller.sol` | 7 | Flash-loan rollover |
| `contracts/utils/DEPSWrapper.sol` | 9 | nDEPS wrapper |
| `contracts/BridgedToken.sol` | 9 | Optimism bridge token |
| `contracts/Leadrate.sol` | 2 | Inherited by MintingHub & Savings |
| `contracts/MintingHubV3/PositionFactory.sol` | 2 | ERC-1167 clone factory |

---

## Key Observations for Audit Prioritization

### 1. Largest Public Attack Surface: MintingHub + Position
- 14 public entry points on MintingHub, 22 on Position (3 public, rest role-restricted)
- Challenge flow (`challenge` → `bid` → settlement) is the most complex public interaction
- `buyExpiredCollateral` allows anyone to buy from expired positions

### 2. Critical Trust Relationship: Implicit Allowances
- `DecentralizedEURO.allowance()` override (L114-131) grants unlimited allowance between all minters/positions
- This means any compromised/malicious minter can drain dEURO from any other minter, position, or the reserve
- The PositionRoller's `ownerOrRoller` access depends on this trust chain

### 3. PositionFactory Has No Access Control
- `createNewPosition` and `clonePosition` are publicly callable with no restrictions
- Positions created directly through the factory are not registered in DecentralizedEURO
- While "orphan" positions can't mint dEURO, they could potentially be used to manipulate state on original positions via `notifyMint`/`notifyRepaid` IF the hub check is bypassed (it's not — the inline check `deuro.getPositionParent(msg.sender) != hub` prevents this)

### 4. Anyone Can Repay Any Position's Debt
- `repay(uint256)` and `repayFull()` on Position.sol have no access control
- This is by design but worth noting: a third party could repay someone's debt

### 5. Governance Quorum Differences
- Standard governance (deny minter, deny position, propose rate change): **2% quorum**
- Emergency bridge stop: **10% quorum** (higher threshold)
- Cap table restructuring: **2% quorum** but only activates when `equity < 1000 dEURO`

### 6. Challenge Array Index: uint256 vs uint32
- `challenge()` returns `uint256` but `bid()` accepts `uint32`
- After 2^32 challenges (~4.3 billion), new challenges cannot be bid on
- Low practical risk but represents an asymmetry in the API

### 7. Compounding Mode Ordering in Savings
- `save(uint192, bool)` sets compounding mode BEFORE settling pending interest
- Unsettled interest from previous period settles under the NEW mode
- A user switching from compounding→non-compounding gets accumulated interest in `claimableInterest` instead of `saved`
