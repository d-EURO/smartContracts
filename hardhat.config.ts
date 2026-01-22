import '@nomicfoundation/hardhat-ethers';
import '@nomicfoundation/hardhat-verify';
import '@nomicfoundation/hardhat-network-helpers';
import '@nomicfoundation/hardhat-chai-matchers';
import '@typechain/hardhat';
import 'hardhat-gas-reporter';
import 'solidity-coverage';
import 'hardhat-deploy';
import 'hardhat-abi-exporter';
import 'hardhat-contract-sizer';
import { HardhatUserConfig } from 'hardhat/config';

// Import tasks
import './tasks/getContracts';

import { task } from 'hardhat/config';

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

// Get deployer mnemonic (optional - only required when deploying)
// Allows compilation without deployment credentials
// Uses standard Hardhat test mnemonic as fallback for local development
const deployerMnemonic = process.env.DEPLOYER_MNEMONIC || "test test test test test test test test test test test junk";

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
      chainId: process.env.FORK_ENABLED === 'true' ? 5115 : 31337,
      forking: process.env.FORK_ENABLED === 'true' ? {
        url: process.env.RPC_URL || 'https://rpc.testnet.citrea.xyz',
        enabled: true,
      } : undefined,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 1337,
    },
    citrea: {
      url: process.env.RPC_URL || 'https://rpc.mainnet.citrea.xyz',
      chainId: 4114,
      gas: 'auto',
      gasPrice: 'auto',
      accounts: { mnemonic: deployerMnemonic },
      timeout: 300_000,
    },
    citreaTestnet: {
      url: process.env.RPC_URL || 'https://rpc.testnet.citrea.xyz',
      chainId: 5115,
      gas: 'auto',
      gasPrice: 'auto',
      accounts: { mnemonic: deployerMnemonic },
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
      citrea: 'no-api-key-needed',
      citreaTestnet: 'no-api-key-needed',
    },
    customChains: [
      {
        network: "citrea",
        chainId: 4114,
        urls: {
          apiURL: "https://explorer.mainnet.citrea.xyz/api",
          browserURL: "https://explorer.mainnet.citrea.xyz"
        }
      },
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
