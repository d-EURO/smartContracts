import '@nomicfoundation/hardhat-ethers';
import '@nomicfoundation/hardhat-verify';
import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-network-helpers';
import '@nomicfoundation/hardhat-ignition-ethers';
import 'hardhat-deploy';
import 'hardhat-abi-exporter';
import 'hardhat-contract-sizer';
import { HardhatUserConfig } from 'hardhat/config';

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

// Pre-compile hook to ensure ABI directories exist
// This prevents hardhat-abi-exporter from failing on fresh clones where abi/ is gitignored
import fs from 'fs';
import path from 'path';

task('compile').setAction(async (args, hre, runSuper) => {
  // Ensure ABI base directories exist before compilation
  const abiPaths = [
    path.join(__dirname, 'abi'),
    path.join(__dirname, 'abi', 'signature')
  ];

  for (const dir of abiPaths) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Run the original compile task
  return runSuper();
});

import dotenv from 'dotenv';
dotenv.config();

// Get deployer private key (optional - only required when deploying)
// Allows compilation without deployment credentials
const deployerPk = process.env.DEPLOYER_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001';

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
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 1337,
    },
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
      timeout: 300_000,
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  etherscan: {
    apiKey: {
      citreaTestnet: 'no-api-key-needed',
    },
    customChains: [
      {
        network: "citreaTestnet",
        chainId: 5115,
        urls: {
          apiURL: "https://explorer.testnet.citrea.xyz/api",
          browserURL: "https://explorer.testnet.citrea.xyz"
        }
      }
    ]
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
    deployments: './deployments',
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
