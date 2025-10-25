# JuiceDollar (JUSD)

> An oracle-free, collateralized stablecoin forked from dEURO

This repository contains the smart contracts for JuiceDollar (JUSD), a decentralized stablecoin system with native protocol shares (JUICE).

**Links:**
- [Public Frontend](https://app.juicedollar.com)
- [Documentation](https://docs.juicedollar.com)
- [Upstream Repository](https://github.com/d-EURO/smartContracts) (d-EURO)
- [Original Frankencoin](https://github.com/Frankencoin-ZCHF/FrankenCoin) (dEURO was forked from Frankencoin commit [a2ce625](https://github.com/Frankencoin-ZCHF/FrankenCoin/commit/a2ce625c554bbd3465a31e7d8b7360a054339dd2), December 2, 2024)

---

## Table of Contents

- [Smart Contracts Overview](#smart-contracts-overview)
- [Fork History](#fork-history)
- [Key Differences](#key-differences)
- [Audit Reports](#audit-reports)
- [Development Setup](#development-setup)
- [Testing](#testing)
- [Deployment](#deployment)
- [NPM Package](#npm-package)
- [Foundry Fuzzing Tests](#foundry-fuzzing-tests)

---

## Smart Contracts Overview

All source code is located in the [contracts](contracts) folder.

### Core Contracts

| Contract | Description |
|----------|-------------|
| **JuiceDollar.sol** | The JUSD ERC20 stablecoin token |
| **Equity.sol** | The JUICE ERC20 token (Juice Protocol) |
| **Leadrate.sol** | Leading interest rate module for the system |

### Minting Hub V2

| Contract | Description |
|----------|-------------|
| **MintingHub.sol** | Oracle-free collateralized minting system |
| **Position.sol** | Individual collateralized loan position |
| **PositionFactory.sol** | Factory to create new positions |
| **PositionRoller.sol** | Roll positions into new ones |

### Savings & Bridges

| Contract | Description |
|----------|-------------|
| **Savings.sol** | Interest distribution to JUSD holders |
| **SavingsVaultJUSD.sol** | ERC4626 vault for JUSD savings |
| **StablecoinBridge.sol** | 1:1 swaps with external stablecoins (StartUSD for bootstrap) |

### Gateway Contracts (Frontend Rewards)

| Contract | Description |
|----------|-------------|
| **FrontendGateway.sol** | Rewards frontend providers for referrals |
| **MintingHubGateway.sol** | Minting with frontend provider rewards |
| **SavingsGateway.sol** | Savings with frontend provider rewards |
| **CoinLendingGateway.sol** | Native coin (cBTC) lending with custom liquidation |

---

## Fork History

JuiceDollar is part of a three-generation fork chain:

```
Frankencoin-ZCHF (Original)
    ↓
d-EURO (December 2024 fork)
    ↓
JuiceDollar (Current repository)
```

**Upstream**: [`d-EURO/smartContracts`](https://github.com/d-EURO/smartContracts)
**Origin**: [`Frankencoin-ZCHF/FrankenCoin`](https://github.com/Frankencoin-ZCHF/FrankenCoin)

**Deployment Networks:**
- **Frankencoin-ZCHF**: Ethereum Mainnet (native currency: ETH)
- **dEURO**: Ethereum Mainnet (native currency: ETH) | Testnet: Sepolia
- **JuiceDollar**: Citrea Mainnet (native currency: cBTC) | Testnet: Citrea Testnet

d-EURO forked from Frankencoin at commit [a2ce625](https://github.com/Frankencoin-ZCHF/FrankenCoin/commit/a2ce625c554bbd3465a31e7d8b7360a054339dd2) (December 2, 2024), introducing significant protocol improvements. JuiceDollar continues this evolution with deployment on Citrea, using cBTC as the native currency.

---

## Audit Reports

JuiceDollar inherits security audits from its upstream repositories:

### Frankencoin Audits

| Date | Auditor | Report |
|------|---------|--------|
| 2023-02-10 | Blockbite | [Report](https://github.com/Frankencoin-ZCHF/FrankenCoin/blob/main/audits/blockbite-audit.pdf) |
| 2023-06-09 | Code4rena | [Report](https://code4rena.com/reports/2023-04-frankencoin) |
| 2023-10-30 | ChainSecurity | [Report](https://github.com/Frankencoin-ZCHF/FrankenCoin/blob/main/audits/V1/blockbite-audit.pdf) |
| 2024-09-25 | Decurity | [Report](https://github.com/Decurity/audits/blob/master/Frankencoin/frankencoin-audit-report-2024-1.1.pdf) |
| 2024-11-28 | ChainSecurity | [Report](https://cdn.prod.website-files.com/65d35b01a4034b72499019e8/674873bff5163fea0b1d9faa_ChainSecurity_Frankencoin_Frankencoin_v2024_audit.pdf) |

### dEURO-Specific Audits

| Auditor | Scope | Report |
|---------|-------|--------|
| ChainSecurity | dEURO fork changes (Interest Accrual, Auction, Accounting) | [Audit](https://www.chainsecurity.com/security-audit/deuro-smart-contracts) |
| Audit Boutique | dEURO smart contracts | [Report PDF](https://github.com/d-EURO/landingPage/blob/develop/audits/deuro_audit_report.pdf) |

### Bug Bounty

- **JuiceDollar Bug Bounty**: Program details will be announced soon
- **Upstream Bug Bounty Programs**:
  - [Frankencoin Bug Bounty](https://bugbounty.compass-security.com/service-details.html?id=18)
  - [dEURO Bug Bounty](https://bugbounty.compass-security.com/service-details.html?id=23)

---

## Development Setup

### Prerequisites

- Node.js & Yarn
- Hardhat
- (Optional) Foundry for fuzzing tests

### 1. Install Dependencies

```bash
yarn install
```

### 2. Environment Configuration

Create a `.env` file (see `.env.example`):

```bash
ALCHEMY_RPC_KEY=your_alchemy_key
DEPLOYER_SEED="test test test test test test test test test test test junk"
DEPLOYER_SEED_INDEX=1              # optional: select deployer index
DEPLOYER_PRIVATE_KEY=0x...         # optional: replaces deployer seed
ETHERSCAN_API_KEY=your_etherscan_key
USE_FORK=false
CONFIRM_DEPLOYMENT=false
```

### 3. Compile Contracts

```bash
yarn run compile
```

---

## Testing

### Run Tests

```bash
yarn run test                        # Run all tests
yarn run test test/TESTSCRIPT.ts    # Run specific test
yarn run coverage                   # Generate coverage report
```

### Auto-refresh Testing

```bash
npx tsc-watch --onCompilationComplete "npx hardhat test ./test/RollerTests.ts"
```

---

## Deployment

### Target Networks

- **Mainnet**: Citrea (native currency: cBTC)
- **Testnet**: Citrea Testnet

### Manual Deployment (Hardhat Deploy)

Deploy to Citrea Testnet:

```bash
hh deploy --network citreaTestnet --tags MockTokens
hh deploy --network citreaTestnet --tags JuiceDollar
hh deploy --network citreaTestnet --tags PositionFactory
hh deploy --network citreaTestnet --tags MintingHub
hh deploy --network citreaTestnet --tags positions
```

**Testing on local fork:**
```bash
# Set USE_FORK=true in .env, then:
npx hardhat node
```

### Deploy Stablecoin Bridges

**NOTE:** The bootstrap bridge (StartUSD → JUSD) is deployed automatically via `deployProtocol.ts`

For additional bridges:
```bash
# 1. Add bridge config to scripts/deployment/config/stablecoinBridgeConfig.ts
# 2. Deploy using BRIDGE_KEY environment variable:
BRIDGE_KEY=<KEY> npx hardhat run scripts/deployment/deploy/deployBridge.ts --network citrea

# Test on forked network
USE_FORK=true BRIDGE_KEY=<KEY> npx hardhat run scripts/deployment/deploy/deployBridge.ts --network hardhat
```

Bridge configurations: `scripts/deployment/config/stablecoinBridgeConfig.ts`

### Hardhat Ignition Deployment

```bash
# Deploy single module with verification
npm run deploy ignition/modules/MODULE --network citrea --verify --deployment-id MODULE_ID_01

# Deploy all modules
npm run deploy -- --network citrea --verify
```

**Output:**
- `ignition/deployments/[deployment]/deployed_addresses.json`
- `ignition/deployments/[deployment]/journal.jsonl`
- `ignition/constructor-args/*.js`

### Manual Verification

```bash
npx hardhat verify --network citrea \
  --constructor-args ./ignition/constructor-args/$FILE.js \
  $ADDRESS

# Verify unrelated contracts
npx hardhat ignition verify $DEPLOYMENT --include-unrelated-contracts
```

---

## NPM Package

### Package Info

- **Name**: `@juicedollar/jusd`
- **Version**: `1.0.16` (see `package.json`)
- **Registry**: https://registry.npmjs.org

### Build & Publish

```bash
# 1. Update version in package.json
# "version": "1.0.17"

# 2. Build TypeScript package
yarn run build

# 3. Login to NPM
npm login

# 4. Publish package
yarn run publish
```

**Note:** The publish command may execute twice; the second will fail with a version conflict (expected behavior).

### Package Exports

**TypeScript ABIs** (`exports/abis/`):
```typescript
export const JuiceDollarABI = [...] as const;
```

**Address Config** (`exports/address.config.ts`):
```typescript
export const ADDRESS: Record<number, ChainAddress> = {
  [citrea.id]: { juiceDollar: '0x...', equity: '0x...' }
};
```

---

## Foundry Fuzzing Tests

### Overview

Invariant/stateful fuzzing tests verify system integrity under random operations.

**Location:** `foundry-test/invariant/`
- `Invariants.t.sol` - Defines system invariants
- `Handler.t.sol` - Defines random actions

**Configuration:** `foundry.toml`
**Remappings:** `remappings.txt`

### Setup

```bash
# Install Foundry: https://book.getfoundry.sh/
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install dependencies
forge install
```

### Run Fuzzing Tests

```bash
# Clean artifacts
forge clean

# Run tests
forge test

# Verbose output (filter noise)
forge test -vvv | grep -v "Bound result"

# Show progress
forge test --show-progress

# Re-run failed test (enable snapshots in foundry.toml)
forge test --rerun
```

### Debug Handler Reverts

Set in `foundry.toml`:
```toml
[invariant]
fail_on_revert = true
```

---

## License

MIT License - See [LICENSE](LICENSE) file

Copyright (c) 2024 DistributedCollective

---

## Contributing

This project is a fork of [d-EURO](https://github.com/d-EURO/smartContracts), which itself is a fork of [Frankencoin-ZCHF](https://github.com/Frankencoin-ZCHF/FrankenCoin).

For contribution guidelines, please open an issue in this repository or refer to the upstream dEURO repository.

---

**Built with ❤️ by the JuiceDollar team**
