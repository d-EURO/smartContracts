import '@nomicfoundation/hardhat-ethers';
import '@nomicfoundation/hardhat-verify';
import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-network-helpers';
import '@nomicfoundation/hardhat-ignition-ethers';
import 'hardhat-deploy';
import 'hardhat-abi-exporter';
import 'hardhat-contract-sizer';
import { HardhatUserConfig } from 'hardhat/config';
import { getChildFromSeed } from './helper/wallet';

// Import tasks
import './tasks/getPositions';
import './tasks/getContracts';

import dotenv from 'dotenv';
dotenv.config();

const seed = process.env.DEPLOYER_ACCOUNT_SEED;
if (!seed) throw new Error('Failed to import the seed string from .env');
const w0 = getChildFromSeed(seed, 0); // deployer
const deployerPk = process.env.DEPLOYER_PRIVATE_KEY ?? w0.privateKey;

const alchemy = process.env.ALCHEMY_RPC_KEY;
if (alchemy?.length == 0 || !alchemy) console.log('WARN: No Alchemy Key found in .env');

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.26',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      outputSelection: {
        '*': {
          '*': ['storageLayout'],
        },
      },
    },
  },
  networks: {
    hardhat:
      process.env.USE_FORK === 'true'
        ? {
            forking: {
              url: `https://eth-mainnet.g.alchemy.com/v2/${alchemy}`,
            },
            chainId: 1,
            accounts: [{ privateKey: deployerPk, balance: '10000000000000000000000' }],
          }
        : {},
    mainnet: {
      url: `https://eth-mainnet.g.alchemy.com/v2/${alchemy}`,
      chainId: 1,
      gas: 'auto',
      gasPrice: 'auto',
      accounts: [deployerPk],
      timeout: 50_000,
    },
    polygon: {
      url: `https://polygon-mainnet.g.alchemy.com/v2/${alchemy}`,
      chainId: 137,
      gas: 'auto',
      gasPrice: 'auto',
      accounts: [deployerPk],
      timeout: 50_000,
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  sourcify: {
    enabled: true,
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
    deploy: './scripts/deployment/deploy',
    deployments: './scripts/deployment/deployments',
  },
  contractSizer: {
    alphaSort: false,
    runOnCompile: false,
    disambiguatePaths: false,
  },
  gasReporter: {
    enabled: true,
    currency: 'USD',
  },
  abiExporter: [
    {
      path: './abi',
      clear: true,
      runOnCompile: true,
      flat: false,
      spacing: 4,
      pretty: false,
    },
    {
      path: './abi/signature',
      clear: true,
      runOnCompile: true,
      flat: false,
      spacing: 4,
      pretty: true,
    },
  ],
  mocha: {
    timeout: 120000,
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v6',
  },
};

export default config;
