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

// Lazy load monitoring tasks to avoid circular dependency with typechain
// These tasks will only import their dependencies when actually executed
import { task } from 'hardhat/config';

// Define monitoring tasks with lazy loading
task('monitor-positions', 'Monitor positions in the JuiceDollar Protocol')
  .addOptionalParam('sort', 'Column to sort by')
  .setAction(async (args, hre) => {
    const { monitorPositionsAction } = await import('./tasks/monitorPositions');
    return monitorPositionsAction(args, hre);
  });

task('monitor-bridges', 'Monitor bridges in the JuiceDollar Protocol')
  .setAction(async (args, hre) => {
    const { monitorBridgesAction } = await import('./tasks/monitorBridges');
    return monitorBridgesAction(args, hre);
  });

task('monitor-jusd', 'Monitor the JuiceDollar token')
  .addFlag('includeEventTxs', 'Include detailed transaction events')
  .setAction(async (args, hre) => {
    const { monitorJuiceDollarAction } = await import('./tasks/monitorJuiceDollar');
    return monitorJuiceDollarAction(args, hre);
  });

task('monitor-equity', 'Monitor the Equity contract')
  .addFlag('includeEventTxs', 'Include detailed transaction events')
  .setAction(async (args, hre) => {
    const { monitorEquityAction } = await import('./tasks/monitorEquity');
    return monitorEquityAction(args, hre);
  });

task('monitor-savings', 'Monitor the Savings Gateway')
  .addFlag('includeEventTxs', 'Include detailed transaction events')
  .setAction(async (args, hre) => {
    const { monitorSavingsGatewayAction } = await import('./tasks/monitorSavingsGateway');
    return monitorSavingsGatewayAction(args, hre);
  });

task('monitor-all', 'Monitor all JuiceDollar Protocol contracts')
  .setAction(async (args, hre) => {
    const { monitorAllAction } = await import('./tasks/monitorAll');
    return monitorAllAction(args, hre);
  });

import dotenv from 'dotenv';
dotenv.config();

const seed = process.env.DEPLOYER_ACCOUNT_SEED;
if (!seed) throw new Error('Failed to import the seed string from .env');
const w0 = getChildFromSeed(seed, 0); // deployer
const deployerPk = process.env.DEPLOYER_PRIVATE_KEY ?? w0.privateKey;
const alchemyApiKey = process.env.ALCHEMY_API_KEY;
if (alchemyApiKey?.length == 0 || !alchemyApiKey) console.log('WARN: No Alchemy Key found in .env');

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
    hardhat: {},
    citrea: {
      url: 'https://rpc.juiceswap.com',
      chainId: 62831,
      gas: 'auto',
      gasPrice: 'auto',
      accounts: [deployerPk],
      timeout: 50_000,
    },
    citreaTestnet: {
      url: 'https://rpc.testnet.juiceswap.com',
      chainId: 5115,
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
    apiKey: process.env.ETHERSCAN_API_KEY || '',
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
