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

// Get deployer credentials (optional - only required when deploying)
// Supports either DEPLOYER_PRIVATE_KEY or DEPLOYER_MNEMONIC
// Uses standard Hardhat test mnemonic as fallback for local development
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
const deployerMnemonic = process.env.DEPLOYER_MNEMONIC || "test test test test test test test test test test test junk";
const deployerAccounts = deployerPrivateKey ? [deployerPrivateKey] : { mnemonic: deployerMnemonic };
// Hardhat network requires { privateKey, balance } objects instead of plain strings
const hardhatAccounts = deployerPrivateKey
  ? [{ privateKey: deployerPrivateKey, balance: "10000000000000000000000" }]
  : { mnemonic: deployerMnemonic };

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
      chainId: process.env.FORK_MAINNET ? 4114 : 31337,
      allowUnlimitedContractSize: true,
      // Use deployer mnemonic when forking, default Hardhat accounts otherwise
      accounts: process.env.FORK_MAINNET
        ? hardhatAccounts
        : undefined,
      forking: process.env.FORK_MAINNET ? {
        url: process.env.CITREA_MAINNET_RPC || "https://rpc.citreascan.com",
        enabled: true,
      } : undefined,
      chains: {
        4114: { hardforkHistory: { shanghai: 0 } },
      },
    },
    // Localhost networks for persistent forked nodes (optional use)
    forkMainnet: {
      url: "http://127.0.0.1:8545",
      chainId: 4114,
      timeout: 300_000,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 1337,
    },
    citrea: {
      url: process.env.CITREA_MAINNET_RPC || 'https://rpc.citreascan.com',
      chainId: 4114,
      gas: 'auto',
      gasPrice: 'auto',
      accounts: deployerAccounts,
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
    },
    customChains: [
      {
        network: "citrea",
        chainId: 4114,
        urls: {
          apiURL: "https://citreascan.com/api",
          browserURL: "https://citreascan.com"
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
