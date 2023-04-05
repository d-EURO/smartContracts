# FrankenCoin

This is the source code repository for the smart contracts of the oracle-free, collateralized stablecoin Frankencoin.

There also is a [public frontend](https://frankencoin.com), a [documentation page](https://docs.frankencoin.com), and a slightly outdated [Frankencoin Research Paper](https://www.snb.ch/n/mmr/reference/sem_2022_06_03_maire/source/sem_2022_06_03_maire.n.pdf).

## Source Code

The source code can be found in the [contracts](contracts) folder. The following are the most important contracts.

| Contract      | Description |
| ----------- | ----------- |
| Frankencoin.sol       | The Frankencoin (ZCHF) ERC20 token |
| Equity.sol            | The Frankencoin Pool Shares (FPS) ERC20 token |
| MintingHub.sol        | Plugin for oracle-free collateralized minting |
| Position.sol          | A borrowed minting position holding collateral |
| StablecoinBridge.sol  | Plugin for 1:1 swaps with other CHF stablecoins |

## Compiling and Testing
The project is setup to be compiled and tested with hardhat. Assuming [node.js](https://heynode.com/tutorial/install-nodejs-locally-nvm/) is already present, try commands like these to get ready:

```shell
npm install --save-dev hardhat
npm install
```

Once all is there, you can compile or compile & test using these two commands:

```shell
npx hardhat compile
npx hardhat test
```

## Deployment
Define the private key from your deployer address as an environment variable, and then run a script with
a parameter (e.g., `sepolia` that specifies the network:

`$ export PK=322...` 
'$ export APIKEY=A231...`
`$ npx hardhat deploy --network sepolia --tags MockTokens`
or
`$ npx hardhat deploy --network sepolia --tags main` (potentially add  `--reset` undo deletion of MockTokens)

The networks are configured in `package.json`, the command is specified in `hardhat.config.ts`.

`npx hardhat verify "0x..." --network sepolia`
