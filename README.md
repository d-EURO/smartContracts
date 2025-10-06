# dEURO

This repository is a friendly fork of Frankencoin-ZCHF.

This is the source code repository for the smart contracts of the oracle-free, collateralized stablecoin dEURO.

There also is a [public frontend](https://app.dEURO.com) and a [documentation page](https://docs.dEURO.com).

### Source Code

The source code can be found in the [contracts](contracts) folder. The following are the most important contracts.

| Contract              | Description                                                                       |
|-----------------------|-----------------------------------------------------------------------------------|
| DecentralizedEURO.sol | The DecentralizedEURO (dEURO) ERC20 token                                         |
| Equity.sol            | The Native Decentralized Euro Protocol Share (nDEPS) ERC20 token                  |
| MintingHub.sol        | Plugin for oracle-free collateralized minting                                     |
| Position.sol          | A borrowed minting position holding collateral                                    |
| PositionRoller.sol    | A module to roll positions into new ones                                          |
| StablecoinBridge.sol  | Plugin for 1:1 swaps with other EUR stablecoins                                   |
| BridgedToken.sol      | Generic bridged token contract for L2 deployments, e.g. dEURO on [Optimism](https://optimistic.etherscan.io/address/0x1B5F7fA46ED0F487F049C42f374cA4827d65A264) & [Base](https://basescan.org/address/0x1B5F7fA46ED0F487F049C42f374cA4827d65A264), DEPS on [Base](https://basescan.org/address/0x5F674bF6d559229bDd29D642d2e0978f1E282722) |
| Savings.sol           | A module to pay out interest to ZCHF holders                                      |
| Leadrate.sol          | A module that can provide a leading interest rate for the system                  |
| PositionFactory.sol   | Create a completely new position in a newly deployed contract                     |
| DEPSWrapper.sol       | Enables nDEPS to be wrapped in DEPS                                               |
| FrontendGateway.sol    | A module that rewards frontend providers for referrals into the dEURO Ecosystem   |
| MintingHubGateway.sol  | Plugin for oracle-free collateralized minting with rewards for frontend providers |
| SavingsGateway.sol     | A module to pay out interest to ZCHF holders and reward frontend providers        |
| CoinLendingGateway.sol | Gateway for native coin (ETH/MATIC) lending with custom liquidation prices        |

# Code basis and changes after the fork

The last status adopted by Frankencoin was Commit [a2ce625c554bbd3465a31e7d8b7360a054339dd2](https://github.com/Frankencoin-ZCHF/FrankenCoin/commit/a2ce625c554bbd3465a31e7d8b7360a054339dd2) on December 2, 2024. The following things were built on it as a fork.

## DecentralizedEURO Core module
1. ZCHF was renamed to dEURO  
2. Frankencoin was renamed to DecentralizedEURO  
3. FPS was renamed to nDEPS (native Decentralized Protocol Share)  
4. nDEPS now cost 10_000 times less than the FPS for Frankencoin
5. In the Equity SmartContract, the valuation factor was adjusted from 3 to 5. 
6. ERC20 token has been completely converted to standard Open Zeppelin V5  
7. ERC165 token standard has been added  
8. ERC3009 added  
9. SmartContract internal exchange fee (can also be called issuance fee) increased from 0.3% to 2%
10. Minters are no longer authorized to execute SendFrom and BurnFrom from any address. https://github.com/d-EURO/smartContracts/pull/108

## Savings
The lock-up of 3 days has been removed without replacement. 

## DEPS Wrapper
1. FPS has been renamed to nDEPS  
2. WFPS has been renamed DEPS  
(so “w” is no longer used for “wrapped” but the non-wrapped version is now called “native”)  

## Bridges
Frankencoin had a single bridge to XCHF from Bitcoin Suisse  
dEURO has 4 bridges to   
1. Tether EUR  
2. Circle EUR  
3. VNX EUR  
4. Stasis EUR  
The new tokens in the bridges have different decimal places. 


## Minting module v1
In contrast to Frankencoin, dEURO does not use the minting module v1 at all  

## Minting module v2

Interest is no longer paid when a position is opened but is credited as a debt on an ongoing basis and only has to be paid when a position is closed or modified. 

## Front-end gateway
It is possible to use the SmartContracts through a gateway and thus obtain a refferal commission. This module is completely new. 

# Audit Reports
2023-02-10 [Blockbite](https://github.com/Frankencoin-ZCHF/FrankenCoin/blob/main/audits/blockbite-audit.pdf)  
2023-06-09 [code4rena](https://code4rena.com/reports/2023-04-frankencoin)  
2023-10-30 [chainsecurity Report 1](https://github.com/Frankencoin-ZCHF/FrankenCoin/blob/main/audits/V1/blockbite-audit.pdf)  
2024-09-25 [Decurity](https://github.com/Decurity/audits/blob/master/Frankencoin/frankencoin-audit-report-2024-1.1.pdf)  
2024-11-28 [ChainSecurity Report 2](https://cdn.prod.website-files.com/65d35b01a4034b72499019e8/674873bff5163fea0b1d9faa_ChainSecurity_Frankencoin_Frankencoin_v2024_audit.pdf)  

# Development

### Yarn Package Scripts

```json
// yarn run <command> args...

"wallet": "npx ts-node helper/wallet.info.ts",

"compile": "npx hardhat compile",
"test": "npx hardhat test",
"coverage": "npx hardhat coverage",

"deploy": "npx hardhat ignition deploy",
"verify": "npx hardhat verify",

"build": "tsup",
"publish": "npm publish --access public"
```

### 1. Install dependencies

`yarn install`

### 2. Set Environment

> See .env.example

```JSON
file: .env

ALCHEMY_RPC_KEY=...
DEPLOYER_SEED="test test test test test test test test test test test junk"
DEPLOYER_SEED_INDEX=1 // optional, select deployer
DEPLOYER_PRIVATE_KEY=... // optional, replaces deployer seed
ETHERSCAN_API_KEY=...
USE_FORK=false
CONFIRM_DEPLOYMENT=false
```

> Create new session or re-navigate to the current directory, to make sure environment is loaded from `.env`

### 3. Develop Smart Contracts

> Develop your contracts in the `/contracts` directory and compile with:

```Bash
yarn run compile					# Compiles all contracts
```

### 4. Testing

> All test files are located in /test directory. Run tests using:

```Bash
yarn run test                    	# Run all tests
yarn run test test/TESTSCRIPT.ts 	# Run specific test file
yarn run coverage               	# Generate test coverage report
```

With tsc-watch (auto refresh commands)

```shell
npx tsc-watch --onCompilationComplete "npx hardhat test ./test/RollerTests.ts"
```

### 5.0 Deploy Contract (manual)

Then run a deployment script with tags and network params (e.g., `sepolia` that specifies the network)

```shell
hh deploy --network sepolia --tags MockTokens
hh deploy --network sepolia --tags DecentralizedEURO
hh deploy --network sepolia --tags PositionFactory
hh deploy --network sepolia --tags MintingHub
hh deploy --network sepolia --tags MockEURToken
hh deploy --network sepolia --tags XEURBridge
hh deploy --network sepolia --tags positions
```

> Recommanded commands for `sepolia` network.
> Test deployments on a local Mainnet fork using `npx hardhat node` with `USE_FORK=true` in `.env`.
> The networks are configured in `hardhat.config.ts`, including the Mainnet fork.
> Set `CONFIRM_DEPLOYMENT=true` to enable confirmation prompts before each deployment.

#### Deploy Stablecoin Bridges

Deploy bridges for EUR stablecoins using the dedicated deployment script:

```shell
# Deploy bridge for specific stablecoin, e.g. EUROP
BRIDGE_KEY=EUROP npx hardhat run scripts/deployment/deploy/deployBridge.ts --network mainnet

# Test on forked mainnet
USE_FORK=true BRIDGE_KEY=EUROP npx hardhat run scripts/deployment/deploy/deployBridge.ts --network hardhat
```

Bridge keys and configurations are defined in `scripts/deployment/config/stablecoinBridgeConfig.ts`

### 5. Write Deployment Scripts (via ignition deploy and verify)

> Deployment modules are located in /ignition/modules. Deploy your contracts:

```Bash
# deploy and verify a contract (increase deployment-id)
npm run deploy ignition/modules/MODULE --network polygon --verify --deployment-id MODULE_ID_01

# deploy and verify all contracts
npm run deploy -- --network polygon --verify
```

This will:

- Compile and deploy contracts
- Verify on Etherscan and Sourcify
- Generate deployment artifacts in /ignition/deployments

Verify:

- verifies contract on etherscan
- verifies contract on sourcify

Key deployment files:

- deployed_addresses.json: Contains contract addresses
- journal.json: Detailed deployment logs

- creates deployment artifacts in /ignition`/deployments` directory
- creates ./ignition/deployments/[deployment]/`deployed_addresses.json`
- creates ./ignition/deployments/[deployment]/`journal.jsonl`
- creates constructor-args in /ignition`/constructor-args` directory, as JS module export

### 5.1 Example

```Bash
✔ Confirm deploy to network polygon (137)? … yes
{
  message: 'Config Info: Deploying Module with accounts',
  admin: '0xb687FE7E47774B22F10Ca5E747496d81827167E3',
  executor: '0xBdae8D35EDe5bc5174E805DcBe3F7714d142DAAb',
  member: '0x2ACf17C04F1d8BE7E9D5529894DCee86bf2fcdC3'
}
Constructor Args
[
  '0xb687FE7E47774B22F10Ca5E747496d81827167E3',
  '0xBdae8D35EDe5bc5174E805DcBe3F7714d142DAAb',
  '0x2ACf17C04F1d8BE7E9D5529894DCee86bf2fcdC3'
]
Hardhat Ignition 🚀

Deploying [ MembershipModule ]

Batch #1
  Executed MembershipModule#Membership

Batch #2
  Executed MembershipModule#Storage

[ MembershipModule ] successfully deployed 🚀

Deployed Addresses

MembershipModule#Membership - 0x72950A0A9689fCA941Ddc9E1a58dcD3fb792E3D2
MembershipModule#Storage - 0x8A7e8091e71cCB7D1EbDd773C26AD82AAd323328

Verifying deployed contracts

Verifying contract "contracts/Membership.sol:Membership" for network polygon...
Contract contracts/Membership.sol:Membership already verified on network polygon:
  - https://polygonscan.com/address/0x72950A0A9689fCA941Ddc9E1a58dcD3fb792E3D2#code

Verifying contract "contracts/Storage.sol:Storage" for network polygon...
Contract contracts/Storage.sol:Storage already verified on network polygon:
  - https://polygonscan.com/address/0x8A7e8091e71cCB7D1EbDd773C26AD82AAd323328#code

✨  Done in 69.96s.
```

### 5.2 Manual Verify

`npx hardhat verify --network polygon --constructor-args ./ignition/constructor-args/$FILE.js $ADDRESS`

or manually include unrelated contracts

`npx hardhat ignition verify $DEPLOYMENT --include-unrelated-contracts`

### 6 Prepare NPM Package Support

- [x] Export ready to use TypeScript ABIs
- [x] Export ready to use TypeScript deployed address config
- [ ] ...

### 6.1 TypeScript ABIs

Export contract ABIs for npm package usage by copying the JSON into dedicated TypeScript files:

```TS
file: exports/abis/...

export const StorageABI = [
...
JSON
...
] as const;
```

### 6.2 TypeScript Address Config

Provides a mapping of contract addresses for the Membership and Storage contracts deployed on different blockchain networks.

The `ADDRESS` object contains the contract addresses for the `mainnet` and `polygon` networks, with the network ID as the key.
The `zeroAddress` is used as a placeholder for the `mainnet` network, as the contracts have not been deployed there yet.

```TS
file: exports/address.config.ts

import { mainnet, polygon } from 'viem/chains';
import { Address, zeroAddress } from 'viem';

export interface ChainAddress {
	membership: Address;
	storage: Address;
}

export const ADDRESS: Record<number, ChainAddress> = {
	[mainnet.id]: {
		membership: zeroAddress, // if not available
		storage: zeroAddress,
	},
	[polygon.id]: {
		membership: '0x72950A0A9689fCA941Ddc9E1a58dcD3fb792E3D2',
		storage: '0x8A7e8091e71cCB7D1EbDd773C26AD82AAd323328',
	},
};
```

# 7. TSUP and npm package

### 7.1 TSUP

> Config: /tsup.config.ts

TSUP bundles TypeScript code into optimized JavaScript packages. This package uses TSUP to create production-ready builds.

`yarn run build`

### 7.2 NPM Package

> **Increase Version:** Update version number in package.json using semantic versioning (e.g. 0.0.1 -> 0.0.2) before publishing new changes.

```
file: /package.json

"name": "@frankencoin/zchf",
"version": "0.2.16", <-- HERE
```

Login to your NPM account

`npm login`

This will publish your package to NPM with public access, making it **available for anyone to install and use**.

`yarn run publish`

To publish new version. `publish: "npm publish --access public"`

> **Note**: During npm package publishing, the command may execute twice. The second execution will fail with a version conflict since the package is already published. This is expected behavior and the first publish will have succeeded.

### 7.3 How to transpile package into bundled apps

(not needed, since its already a true JS bundled module)

E.g. for `NextJs` using the `next.config.js` in root of project.

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@.../core", "@.../api"],
};

module.exports = nextConfig;
```

# 8. Updates (January 2025)

### DecentralizedEURO.sol

- `allowance`: Added `address(reserve))` to the spender addresses with unlimited dEURO allowance.
- `burnWithReserve`: Removed unused function.
- `burnFromWithReserve`: Use `_spendAllowance` to control spending power of `minters` based on `allowance`.
- `burnFromWithReserveNet`: Renamed from `burnWithReserve`.
- `distributeProfits`: New function to distinguish between reserve withdrawals due to losses vs interest payouts (e.g. to savings) -> `Loss` vs `ProfitDistributed` event.
- `_withdrawFromReserve`: New helper function used by `coverLoss` and `distributeProfits`.
- `supportsInterface`: Added `IDecentralizedEURO` support.

### Equity.sol

- `BelowMinimumHoldingPeriod`: New custom error for failed `!canRedeem(owner)` check.

### MintingHub.sol

- `_finishChallenge`: The `Position.notifyChallengeSucceeded` call now returns both the required prinicipal `repayment` amount and `interest` payment amount necessry to liquidate the challenged collateral. In `_finishChallenge`, the `interest` amount is then added separately to the funds taken from the `msg.sender` (liquidator/bidder): `DEURO.transferFrom(msg.sender, address(this), offer + interest);`. Both the challenger reward payout and subsequent principal repayment is done using the `repayment` funds. Even in the case of insufficient funds and a system loss, the `interest` funds remain untouched, as they are dedicated solely to the required interest payment which is done at the very end: `DEURO.collectProfits(address(this), interest);`.
Also note that an additionl `maxInterest` function parameter was added to `_finishChallenge`. This sets a limit on the `interest` amount that can be charged, resulting in a `revert` if exceeded.
The updates to this function cleanly separate principal and interest logic. For more details on the required `repayment` and `interest` amounts, refer to `Position.notifyChallengeSucceeded` below.
- `_calculateOffer`: New helper function used by `_finishChallenge` (basic code refactoring).
- `buyExpiredCollateral`: Similar to the update to `_finishChallenge`, we make a clean separation of funds used for the `principal` repayment and funds used for the `interest` payment. That is, `propInterest` becomes a new parameter which is passed to the `Position.forceSale` function call. The purpose of `propInterest` is to ensure that the liquidator covers a proportional part of the outstanding interest to the amount of the expired collateral they wish to buy. See `Position.forceSale` below for more details.

### Position.sol

- `fixedAnnualRatePPM`: The interest rate for a position is synced with the lead rate (`Leadrate.currentRatePPM`) at creation time (in the `constructor` or, in the case of cloning, in the `initialize` function) using the `_fixRateToLeadrate` function. From this point onwards, the interest rate for a particular position instance is fixed unless new tokens are minted (the loan is increased), at which point it is re-synced with the lead rate. It is expected that in the case of lowered interest rates, position owners will roll their current positions into new ones (for free) to benefit from it.
- `availableForClones`: This function now only considers the `principal` amount in its calculations. This is because the (accrued) `interest` does not belong to the minted dEURO tokens of a position and therefore do not belong in this calculation.
- `adjust`: The `newDebt` parameter was changed to `newPrincipal`. Consequently, owners are able to control their `principal` amount without having the outstanding interest amount tied to it. Naturally, if they wish to reduce their principal, they must first pay any outstanding interest. This is handled automatically by the `adjust` function.
- `MintingUpdate`: The last paramter of this `event` now only reports the new `principal` amount and not the entire `debt` amount which would include the outstanding `interest`. This is more in line with the overall purpose of this event.
- `_adjustPrice`: The accrued `interest` is removed from the `bounds` paramter passed to `_setPrice`. This is because the `interest` does not belong in the collateral "sanity check" logic.
- `_accrueInterest`: Refactored
- `_calculateInterest`: Renamed and refactored from `getDebtAtTime`.
- `getDebt`: Refactored
- `getInterest`: New public function to get the currently outstanding (unpaid) interest on the position.
- `_mint`: Updated to manage interest accrual and the syncing of the interest rate to the lead rate.
- `_notifyRepaid`: Refactored, including sanity check.
- `_notifyInterestPaid`: Refactored, including sanity check.
- `forceSale`: As mentioned in `MintingHub.buyExpiredCollateral` above, the `forceSale` function was equipped with a fourth function parameter `propInterest` which specifies the amount to be used to pay off the proportional amount of `interest` to the expired collateral being acquired. This is done in the line `_repayInterest(buyer, propInterest);`. Subsequently, the `proceeds` are used to repay the `principal` using the `_repayPrincipalNet` function (see `Position._repayPrincipalNet` below for more details). This function only returns a remaining amount, if the entire `principal` has been repaid. In the case of such a remainder, it is used to pay off any remaining `interest`, `proceeds = _repayInterest(buyer, proceeds);`.
The order of first repaying the `principal` before paying of any remaining `interest` with the `proceeds` is important to guarantee that in the case of a shortfall, is is not due to a "misspending" of the `proceeds` funds on the outstanding `interest`.
Finally, in the case that no collateral remains, any remainining `principal` is repayed at the expense of the system (as no more `proceeds` remain). If this isn't the case, the remaining `proceeds` are transferred to the position `owner` as profit.
- `_payDownDebt`: Refactored
- `_repayInterest`: New helper function to pay off outstanding interest by some `amount`. Returns the remainder in the case that `amount` exceeds the outstanding `interest`.
- `_repayPrincipal`: New helper function to repay principal by some _exact_ `amount` using `burnFromWithReserve`. Returns the remaining funds.
- `_repayPrincipalNet`: New function to repay principal by some `amount`, where `amount` specifies the amount to be burned from the `payer`. This is done using the `DecentralizedEURO.burnFromWithReserveNet` function. As `_repayPrincipalNet` is used by the `forceSale` function, `repayPrincipalNet(buyer, proceeds);`, where `proceeds` may exceed `getUsableMint(principal)` amount (the maximum amount claimable by a particular position) we cap `repayWithReserve` at said maximal claimable amount. If funds remain thereafter, they are burned directly in order to pay of any remaining principal. The final remainder is returned.
- `notifyChallengeSucceeded`: Now computes and returns the proportional amount of interest that must be paid in order to successfully challenge a position.

### PositionRoller.sol

- `rollFullyWithExpiration`: Fix logic to compute the amount to mint in the target Position.
- `roll`: Refactor and send any remaining flash loan from the debt repayment (reserve portion returned by `source.repay(totRepayment)` > `Position._repayPrincipal > DecentralizedEURO.burnFromWithReserve`) to `msg.sender` for the flash loan repayment.
- `_cloneTargetPosition`: New helper function used to clone the target position. Used only by `PositionRoller.roll`.

### Savings.sol

- `refresh`: Replace the use of `DecentralizedEURO.coverLoss` with `DecentralizedEURO.distributeProfits`. This replaces the `Loss` event with the `ProfitDistributed` event.

### StablecoinBridge.sol

- `mintTo`: Replace standard `transfer` functions with OppenZeppelin's `SafeERC20` variants for the source stablecoin.

### Gateway Contracts

The gateway contracts (FrontendGateway.sol, SavingsGateway.sol, MintingHubGateway.sol) provide a way to generously reward frontend providers or referrer, paid for by DEPS Holder. These Contracts are not present in the Frankencoin Ecosystem. 


# Invariant/Stateful Fuzzing Tests with Foundry:

The _fuzzing_ tests are written in Solidity and made of two main contracts located in the `foundry-test/invariant` folder: `Invariants.t.sol` which contains the _invariants_ and `Handler.t.sol` which contains the _actions_ of the fuzzing test. During each _run_ the functions in `Handler.t.sol` are called by the fuzzing engine in a random order and with random inputs starting with the initial state of the system as defined by `Invariants.setUp()`. After each run the invariants defined in `Invariants.t.sol` are checked to ensure that the system is still in a valid state. 

### Running the Fuzzing Tests:

After installing [foundry](https://book.getfoundry.sh/) on your machine and running `forge install` to install the required dependencies, you can use the following command to run the fuzzing tests:

```shell
# remove build artifacts & cache
forge clean

# run the fuzzing tests
forge test

# more verbose output (with grep to omit some logs)
forge test -vvv | grep -v "Bound result"

# show progress
forge test --show-progress

# re-run a failed test
# Tip: Set .profile.logging.snapshot=true in foundry.toml to log snapshots
forge test --rerun
```

The configuration for the fuzzing tests can be found in the `foundry.toml` file. Furthermore, the `remappings.txt` file contains the remappings for the fuzzing test contracts. In order to debug handler reverts, you can set `.invariant.fail_on_revert=true` in the `foundry.toml` file.