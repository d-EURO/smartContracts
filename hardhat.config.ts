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
import './tasks/getContracts';
// Only import monitoring tasks if not in CI environment
// Prevents errors when typechain hasn't been generated yet
if (!process.env.CI) {
  require('./tasks/monitorPositions');
  require('./tasks/monitorBridges');
  require('./tasks/monitorDecentralizedEuro');
  require('./tasks/monitorEquity');
  require('./tasks/monitorDEPSWrapper');
  require('./tasks/monitorSavingsGateway');
  require('./tasks/monitorAll');
}

import dotenv from 'dotenv';
dotenv.config();

const seed = process.env.DEPLOYER_ACCOUNT_SEED;
if (!seed) throw new Error('Failed to import the seed string from .env');
const w0 = getChildFromSeed(seed, 0); // deployer
const deployerPk = process.env.DEPLOYER_PRIVATE_KEY ?? w0.privateKey;

const alchemyEthereumRpcUrl = process.env.ALCHEMY_ETHEREUM_RPC_KEY;
if (alchemyEthereumRpcUrl?.length == 0 || !alchemyEthereumRpcUrl) console.log('WARN: No Alchemy Key found in .env');

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
              url: alchemyEthereumRpcUrl || 'NO_RPC_URL',
            },
            chainId: 1,
            accounts: [{ privateKey: deployerPk, balance: '10000000000000000000000' }],
          }
        : {},
    mainnet: {
      url: alchemyEthereumRpcUrl || 'NO_RPC_URL',
      chainId: 1,
      gas: 'auto',
      gasPrice: 'auto',
      accounts: [deployerPk],
      timeout: 50_000,
    },
    polygon: {
      url: process.env.ALCHEMY_POLYGON_RPC_URL,
      chainId: 137,
      gas: 'auto',
      gasPrice: 'auto',
      accounts: [deployerPk],
      timeout: 50_000,
    },
    optimism: {
      url: process.env.ALCHEMY_OPTIMSM_RPC_URL,
      chainId: 10,
      accounts: [deployerPk],
      timeout: 50_000,
    },
    base: {
      url: process.env.ALCHEMY_BASE_RPC_URL,
      chainId: 8453,
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
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY || '',
      polygon: process.env.POLYGONSCAN_API_KEY || '',
      optimisticEthereum: process.env.OPTIMISM_API_KEY || '',
      base: process.env.BASESCAN_API_KEY || '',
    },
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
