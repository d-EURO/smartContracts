# JuiceDollar Citrea Deployment - TODO List

> **Status:** Pre-Deployment Phase - Simplified Architecture
> **Target Network:** Citrea Mainnet (Chain ID: 62831)
> **Testnet:** Citrea Testnet (Chain ID: 5115)
> **Last Updated:** 2025-10-18
> **Collateral Strategy:** WcBTC (Wrapped cBTC) only

---

## ✅ Completed Items

### ✅ 1. Simplify Collateral Strategy

**File:** `scripts/deployment/config/positionsConfig.ts`
**Status:** ✅ **COMPLETED**

**What Was Done:**
- Removed all Ethereum Mainnet token positions (11 tokens: LsETH, WETH, WBTC, cbBTC, kBTC, USDT, USDC, LINK, UNI, DAI, XAUt)
- Removed legacy ZCHF, WFPS, DEPS position references from upstream forks
- Simplified to **single collateral type: WcBTC (Wrapped cBTC)**
- File reduced from 227 lines → 43 lines

**Current Configuration:**
```typescript
{
  name: 'WcBTC-Position',
  collateralAddress: '0x0000000000000000000000000000000000000000', // ⚠️ TODO: Update
  minCollateral: '0.01', // 0.01 BTC (~$1,000 at $100k/BTC)
  initialCollateral: '0.01',
  mintingMaximum: '10000000', // 10M JUSD
  initPeriodSeconds: 259200, // 3 days
  expirationSeconds: 15552000, // 180 days
  challengeSeconds: 172800, // 2 days
  riskPremiumPPM: 30000, // 3% risk premium
  liqPrice: '90000', // $90k liquidation price
  reservePPM: 150000, // 15% reserve
  deploy: true
}
```

**Remaining Action:**
- [ ] Replace `collateralAddress` with actual Wrapped cBTC address on Citrea

---

## 🚨 Critical - Must Complete Before Deployment

### 1. Update WcBTC Address

**File:** `scripts/deployment/config/positionsConfig.ts`
**Line:** 29
**Status:** ❌ **Not Started**

**Action Required:**
Find the official Wrapped cBTC contract address on Citrea and update:

```typescript
collateralAddress: '0x0000000000000000000000000000000000000000', // Current
collateralAddress: '0x...', // TODO: Add real WcBTC address
```

**Research Required:**
- [ ] Contact Citrea team for official WcBTC address
- [ ] Verify WcBTC is ERC20 compatible (18 decimals expected)
- [ ] Confirm WcBTC liquidity on JuiceSwap DEX
- [ ] Test WcBTC transfer/approve functions on testnet

---

### 2. Update DEX/Infrastructure Addresses

**File:** `constants/addresses.ts`
**Lines:** 1-7
**Status:** ❌ **Not Started**

**Current State:**
```typescript
export const citrea = {
  WBTC: '', // ❌ Empty - Should be WcBTC
  JUICESWAP_ROUTER: '', // ❌ Empty - JuiceSwap Router
  JUICESWAP_FACTORY: '', // ❌ Empty - JuiceSwap Factory
};
```

**Action Required:**
```typescript
export const citrea = {
  WBTC: '0x...', // TODO: Add WcBTC (Wrapped cBTC) address
  JUICESWAP_ROUTER: '0x...', // TODO: Add JuiceSwap V3 Router
  JUICESWAP_FACTORY: '0x...', // TODO: Add JuiceSwap V3 Factory
};
```

**Research Required:**
- [ ] Get official JuiceSwap V3 Router address
- [ ] Get official JuiceSwap V3 Factory address
- [ ] Verify JuiceSwap uses Uniswap V3 compatible interfaces
- [ ] Same WcBTC address as in positionsConfig.ts

---

### 3. Configure CoinLendingGateway Addresses

**File:** `scripts/deployment/deployCoinLendingGateway.ts`
**Lines:** 12-25
**Status:** ❌ **Not Started**

**Current State:**
```typescript
const networkConfig: Record<number, NetworkConfig> = {
  62831: { // Citrea Mainnet
    mintingHubGateway: "0x...", // ❌ Empty
    weth: "0x...", // ❌ Empty - Should be WcBTC
    jusd: "0x...", // ❌ Empty
  },
  5115: { // Citrea Testnet
    mintingHubGateway: "0x...", // ❌ Empty
    weth: "0x...", // ❌ Empty - Should be WcBTC
    jusd: "0x...", // ❌ Empty
  }
};
```

**Action Required:**
- [ ] Update `weth` → `wcbtc` (rename parameter for clarity)
- [ ] Add WcBTC address (same as positionsConfig.ts and constants/addresses.ts)
- [ ] Fill in `jusd` address after JuiceDollar deployment
- [ ] Fill in `mintingHubGateway` address after MintingHubGateway deployment

**Note:** This gateway enables native cBTC lending (gas token) with custom liquidation prices.

**Important:** On Citrea, the native coin is **cBTC** (used for gas), not ETH. Users can wrap cBTC → WcBTC.

---

### 4. Configure SavingsVault Addresses

**File:** `scripts/deployment/config/savingsVaultConfig.ts`
**Lines:** 10-20
**Status:** ❌ Not Started

**Current State:**
```typescript
export const networkConfig: Record<number, SavingsVaultConfig> = {
  62831: { // Citrea Mainnet
    jusd: '0x...', // ❌ Empty
    frontendGateway: '0x...', // ❌ Empty
    name: 'Savings Vault JUSD',
    symbol: 'svJUSD',
  },
  // ... testnet config also empty
};
```

**Action Required:**
- [ ] Fill in `jusd` address after JuiceDollar deployment
- [ ] Fill in `frontendGateway` address after FrontendGateway deployment
- [ ] Verify ERC4626 vault naming convention (svJUSD)

---

### 5. ~~Review Flashbots Configuration~~ ✅ COMPLETED

**File:** ~~`scripts/deployment/config/flashbotsConfig.ts`~~ → **`deploymentConfig.ts`**
**Status:** ✅ **COMPLETED**

**What Was Done:**
- ✅ Confirmed Citrea does NOT support Flashbots (Ethereum-specific feature)
- ✅ Renamed `flashbotsConfig.ts` → `deploymentConfig.ts` (removed misleading naming)
- ✅ Renamed interface `FlashbotsConfig` → `DeploymentConfig`
- ✅ Removed unused `coinbasePayment` field
- ✅ Updated all import references across codebase
- ✅ Renamed env var `FLASHBOTS_DEPLOYMENT_PATH` → `DEPLOYMENT_FILE_PATH`
- ✅ Removed `@flashbots/ethers-provider-bundle` dependency from package.json

**Rationale:**
Flashbots is an Ethereum Mainnet-specific MEV protection service. Citrea:
- Is a Layer 2 rollup on Bitcoin (not Ethereum)
- Uses a centralized sequencer (less MEV risk)
- Does not support Flashbots RPC endpoints
- Has lower transaction volume (lower front-running incentive)

The config file was never actually using Flashbots - just legacy naming from Ethereum days.

**Security Alternatives for Citrea:**
- Deploy during low network activity periods
- Use multi-sig for critical admin functions
- Implement time-delays for sensitive operations
- Monitor transactions post-deployment

---

## 🔄 Post-Deployment - Complete After Contracts Are Deployed

### 6. Update Deployed Contract Addresses

**File:** `exports/address.config.ts`
**Lines:** 20-47
**Status:** ⏳ Waiting for Deployment

**Current State:**
All addresses are `zeroAddress` for both Citrea Mainnet (62831) and Testnet (5115).

**Action Required:**
After deploying each contract, update the following addresses:

**Citrea Mainnet (62831):**
```typescript
{
  juiceDollar: '0x...', // ✅ Deploy first
  equity: '0x...', // ✅ Deploy with JuiceDollar
  frontendGateway: '0x...', // Deploy after core contracts
  savingsGateway: '0x...', // Deploy after core contracts
  savingsVaultJUSD: '0x...', // Deploy after SavingsGateway
  mintingHubGateway: '0x...', // Deploy after core contracts
  coinLendingGateway: '0x...', // Deploy after MintingHubGateway
  bridgeStartUSD: '0x...', // Bootstrap bridge (deployed in deployProtocol.ts)
  roller: '0x...', // Deploy after MintingHub
  positionFactoryV2: '0x...', // Deploy with MintingHub
}
```

**Citrea Testnet (5115):**
- [ ] Same addresses as mainnet (deploy to testnet first for testing)

---

### 7. Export Updated ABIs

**Status:** ⏳ After Deployment

**Action Required:**
```bash
# After all contracts are deployed and verified
yarn run ts:export:abis
```

This will regenerate TypeScript ABI exports in `exports/abis/`.

---

### 8. Update NPM Package

**File:** `package.json`
**Current Version:** `1.0.16`
**Status:** ⏳ After Deployment

**Action Required:**
1. [ ] Update version to `1.1.0` (minor version for Citrea deployment)
2. [ ] Build package: `yarn run build`
3. [ ] Publish: `yarn run publish`

```json
{
  "name": "@juicedollar/jusd",
  "version": "1.1.0", // ← Update here
  "description": "JuiceDollar (JUSD) - Oracle-free stablecoin on Citrea"
}
```

---

## 🧪 Testing - Complete Before Mainnet Deployment

### 9. Testnet Deployment & Testing

**Network:** Citrea Testnet (Chain ID: 5115)
**Status:** ❌ Not Started

**Test Sequence:**
1. [ ] Deploy protocol using `deployProtocol.ts` on testnet (includes StartUSD bootstrap)
2. [ ] Deploy MintingHub and PositionFactory on testnet
3. [ ] Deploy at least 2 test positions (cBTC, test collateral)
4. [ ] Deploy Gateway contracts (Frontend, Savings, MintingHub)
5. [ ] Test complete user flow:
   - [ ] Verify bootstrap: 1000 SUSD → 1000 JUSD minted
   - [ ] Challenge and liquidate a position
   - [ ] Deposit JUSD in savings vault
   - [ ] Withdraw from savings vault
   - [ ] Frontend gateway referral rewards
6. [ ] Monitor gas costs on Citrea (vs Ethereum)
7. [ ] Verify all contracts on Citrea block explorer
8. [ ] Test PositionRoller (roll positions to new interest rate)
10. [ ] Integration test: Run full test suite against testnet

**Test Script:**
```bash
# Set network to testnet
export NETWORK=citreaTestnet

# Run integration tests
yarn run test test/integration/integrationTest.ts

# Monitor deployed contracts
yarn run monitor --network citreaTestnet
```

---

### 11. Security Checks

**Status:** ❌ Not Started

**Pre-Deployment Checklist:**
- [ ] Review all TODO comments in contracts (run: `grep -r "TODO" contracts/`)
- [ ] Ensure no test/mock contracts are included in deployment
- [ ] Verify all SafeERC20 uses (check MintingHub.sol:129, 157)
- [ ] Confirm reserve initial funding amount
- [ ] Verify initial mint amount to close initialization phase (FullDeployment.ts:39)
- [ ] Review interest rate parameters (Leadrate)
- [ ] Confirm opening fee amount (positionsConfig.ts:26)
- [ ] Verify collateral requirements for each position type
- [ ] Check liquidation price parameters are correct for Citrea market conditions
- [ ] Ensure access control is properly configured (deployer, admin roles)

---

### 12. Documentation Updates

**Status:** ❌ Not Started

**Files to Update:**
- [ ] `README.md` - Add Citrea deployment addresses after mainnet launch
- [ ] Create `CITREA_DEPLOYMENT.md` - Document Citrea-specific considerations
- [ ] Update frontend integration docs with Citrea RPC endpoints
- [ ] Document differences from dEURO (EUR→USD, Ethereum→Citrea)
- [ ] Add Citrea block explorer links to documentation
- [ ] Update deployment instructions with Citrea-specific steps

---

## 📝 Additional Considerations

### 13. Network Configuration Verification

**File:** `hardhat.config.ts`
**Status:** ⚠️ Needs Verification

**Current Config:**
```typescript
citrea: {
  url: 'https://rpc.juiceswap.com', // ⚠️ Verify this RPC endpoint
  chainId: 62831,
  gas: 'auto',
  gasPrice: 'auto',
  accounts: [deployerPk],
  timeout: 50_000,
}
```

**Action Required:**
- [ ] Verify `https://rpc.juiceswap.com` is the correct Citrea RPC endpoint
- [ ] Test RPC endpoint connectivity and rate limits
- [ ] Determine if a dedicated/paid RPC endpoint is needed for deployment
- [ ] Verify timeout is sufficient for Citrea block times
- [ ] Consider adding block explorer API key for contract verification
- [ ] Add etherscan config for Citrea explorer (if available)

---

### 14. Cleanup Legacy Code

**Status:** ✅ **COMPLETED**

**What Was Done:**
- ✅ Removed commented-out DEPS/WFPS/ZCHF positions from `positionsConfig.ts`
- ✅ Verified no active Base/Optimism network references remain
- ✅ All EUR stablecoin references removed (EURC, EURS, EURT, VEUR)
- ✅ File structure simplified from 227 → 43 lines in positionsConfig.ts

**Remaining (Optional):**
- [ ] Review test files for outdated comments mentioning Ethereum mainnet
- [ ] Remove unused imports in test files (if any)

---

### 15. Initial Liquidity Planning

**Status:** ❌ Not Started

**Action Required:**
- [ ] Determine initial JUSD supply to mint
- [ ] Plan JUSD/cBTC liquidity pool on JuiceSwap
- [ ] Calculate liquidity incentives (if any)
- [ ] Identify liquidity providers / initial market makers
- [ ] Document oracle-free liquidation mechanism for users

---

### 16. Governance & Multisig Setup

**Status:** ❌ Not Started

**Action Required:**
- [ ] Set up multisig wallet for protocol admin/owner (if needed)
- [ ] Configure initial minters (MintingHub, bridges, etc.)
- [ ] Set initial parameters:
  - [ ] Interest rates (Leadrate)
  - [ ] Reserve ratio
  - [ ] Equity valuation factor (currently 5, see Equity.sol)
  - [ ] Minimum application period (MIN_APPLICATION_PERIOD)
  - [ ] Minimum fee (MIN_FEE = 1000 JUSD)
- [ ] Plan governance transition (if moving from deployer to DAO)

---

### 17. Monitoring & Analytics Setup

**Status:** ❌ Not Started

**Action Required:**
- [ ] Set up monitoring dashboard for deployed contracts
- [ ] Configure alerts for:
  - [ ] Low reserve levels
  - [ ] Large liquidations
  - [ ] Abnormal minting activity
  - [ ] Interest rate changes
- [ ] Set up analytics for:
  - [ ] Total JUSD supply
  - [ ] Collateralization ratio by position type
  - [ ] Active positions count
  - [ ] Savings vault TVL
  - [ ] Frontend gateway referral volume
- [ ] Document monitoring commands:
  ```bash
  yarn run monitor --network citrea
  yarn run positions --network citrea --sort created
  yarn run monitor-jusd --network citrea
  ```

---

### 18. Bug Bounty Program

**Status:** 📋 Planned

**Action Required:**
- [ ] Contact security firms for post-deployment audit (ChainSecurity, Trail of Bits, etc.)
- [ ] Set up bug bounty program (Immunefi, Code4rena, HackenProof)
- [ ] Determine bounty amounts based on severity
- [ ] Prepare documentation for security researchers
- [ ] Announce bug bounty after mainnet deployment

---

## 🎯 Deployment Sequence (Simplified)

### Recommended Order:

**Phase 1: Core Infrastructure (Testnet)**
1. ❌ Complete items 1-6 (address updates, WcBTC config)
2. ❌ Deploy JuiceDollar + Equity
3. ❌ Deploy MintingHub + PositionFactory
4. ❌ Deploy PositionRoller
5. ❌ Deploy WcBTC position (single collateral type)

**Phase 2: Gateway Contracts (Testnet)**
6. ❌ Deploy FrontendGateway
7. ❌ Deploy SavingsGateway
8. ❌ Deploy SavingsVaultJUSD
9. ❌ Deploy MintingHubGateway
10. ❌ Deploy CoinLendingGateway (native cBTC lending)
11. ✅ Deploy StartUSD Bootstrap Bridge (handled by deployProtocol.ts)

**Phase 3: Testing (Testnet)**
12. ❌ Complete full integration testing (item 10)
13. ❌ Security audit review (item 11)
14. ❌ Test user flow: mint JUSD with WcBTC → savings vault → withdraw

**Phase 4: Mainnet Deployment**
15. ❌ Repeat Phase 1-2 on Citrea Mainnet
16. ❌ Update address config (item 7)
17. ❌ Export ABIs (item 8)
18. ❌ Publish NPM package v1.1.0 (item 9)

**Phase 5: Post-Launch**
19. ❌ Update documentation (item 12)
20. ❌ Set up initial liquidity (item 15)
21. ❌ Configure monitoring (item 17)
22. ❌ Launch bug bounty (item 18)

**Key Difference from Original Plan:**
- ✅ Single collateral type (WcBTC) instead of 11 tokens
- ✅ No Ethereum/Base/Optimism complexity
- ✅ Simplified testing matrix
- ✅ StartUSD (SUSD) bootstrap bridge for initialization

---

## 📞 Key Contacts & Resources

- **Citrea Documentation:** [citrea.xyz/docs](https://citrea.xyz/docs)
- **JuiceSwap:** [juiceswap.com](https://juiceswap.com)
- **Citrea RPC:** https://rpc.juiceswap.com
- **Citrea Testnet RPC:** https://rpc.testnet.juiceswap.com
- **Citrea Block Explorer:** [TBD - Add when available]
- **Bridge Documentation:** [TBD - Add Citrea bridge docs]

---

## ✅ Completion Checklist

**Before Testnet Deployment:**
- [ ] **Item 1:** WcBTC address added to `positionsConfig.ts`
- [ ] **Item 2:** JuiceSwap Router/Factory addresses added
- [ ] **Item 3:** CoinLendingGateway WcBTC config updated
- [ ] **Item 4:** SavingsVault config updated (post-deployment)
- [x] **Item 5:** StartUSD (SUSD) bootstrap bridge configured ✅
- [x] **Item 6:** Flashbots config removed for Citrea ✅
- [ ] **Item 11:** Security checks completed
- [ ] **Item 13:** Network RPC endpoints verified

**Before Mainnet Deployment:**
- [ ] **Item 10:** Full testnet testing completed
- [ ] **Item 15:** Liquidity plan finalized (JUSD/WcBTC pool)
- [ ] **Item 16:** Governance/multisig setup completed

**After Mainnet Deployment:**
- [ ] **Item 7:** All contract addresses updated in `exports/address.config.ts`
- [ ] **Item 8:** ABIs regenerated and exported
- [ ] **Item 9:** NPM package v1.1.0 published
- [ ] **Item 12:** Documentation updated with Citrea specifics
- [ ] **Item 17:** Monitoring dashboard configured
- [ ] **Item 18:** Bug bounty program launched

---

## 📊 Progress Summary

**Completed:** 4/18 items ✅
- ✅ Simplified collateral strategy (WcBTC only)
- ✅ Cleaned up legacy code (Base/Optimism/EUR tokens)
- ✅ Removed Flashbots integration (not compatible with Citrea)
- ✅ StartUSD (SUSD) bootstrap bridge configured

**Critical Remaining:** 3 items ❌
- ❌ WcBTC address (Item 1)
- ❌ JuiceSwap addresses (Item 2)
- ❌ CoinLendingGateway config (Item 3)
- ❌ Security audit (Item 11)
- ❌ Testnet testing (Item 10)

---

**Last Updated:** 2025-10-18
**Maintainer:** JuiceDollar Team
**Status:** 🟡 Pre-Deployment - Simplified architecture complete, addresses pending
**Next Step:** Obtain WcBTC and JuiceSwap contract addresses from Citrea team
