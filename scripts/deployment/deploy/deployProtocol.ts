import { TransactionRequest, TransactionResponse, TransactionReceipt } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getGasConfig, deploymentConstants, contractsParams } from '../config/deploymentConfig';
import StartUSDArtifact from '../../../artifacts/contracts/StartUSD.sol/StartUSD.json';
import JuiceDollarArtifact from '../../../artifacts/contracts/JuiceDollar.sol/JuiceDollar.json';
import PositionFactoryArtifact from '../../../artifacts/contracts/MintingHubV2/PositionFactory.sol/PositionFactory.json';
import PositionRollerArtifact from '../../../artifacts/contracts/MintingHubV2/PositionRoller.sol/PositionRoller.json';
import StablecoinBridgeArtifact from '../../../artifacts/contracts/StablecoinBridge.sol/StablecoinBridge.json';
import FrontendGatewayArtifact from '../../../artifacts/contracts/gateway/FrontendGateway.sol/FrontendGateway.json';
import SavingsGatewayArtifact from '../../../artifacts/contracts/gateway/SavingsGateway.sol/SavingsGateway.json';
import MintingHubGatewayArtifact from '../../../artifacts/contracts/gateway/MintingHubGateway.sol/MintingHubGateway.json';
import SavingsVaultJUSDArtifact from '../../../artifacts/contracts/SavingsVaultJUSD.sol/SavingsVaultJUSD.json';
import CoinLendingGatewayArtifact from '../../../artifacts/contracts/gateway/CoinLendingGateway.sol/CoinLendingGateway.json';
import EquityArtifact from '../../../artifacts/contracts/Equity.sol/Equity.json';
import { ADDRESSES } from '../../../constants/addresses';

dotenv.config();

interface DeployedContract {
  address: string;
  constructorArgs?: any[];
}

interface DeployedContracts {
  startUSD: DeployedContract;
  juiceDollar: DeployedContract;
  equity: DeployedContract;
  positionFactory: DeployedContract;
  positionRoller: DeployedContract;
  bridgeStartUSD: DeployedContract;
  frontendGateway: DeployedContract;
  savingsGateway: DeployedContract;
  mintingHubGateway: DeployedContract;
  savingsVaultJUSD: DeployedContract;
  coinLendingGateway: DeployedContract;
}

/**
 * Waits for a transaction with retry logic to handle RPC timeouts. Uses exponential backoff 
 * and falls back to manual receipt query if .wait() times out. This handles Citrea testnet 
 * RPC reliability issues.
 *
 * @param txResponse - The transaction response to wait for
 * @param confirmations - Number of confirmations to wait for (default: 1)
 * @param maxRetries - Maximum number of retry attempts (default: 5)
 * @param baseDelayMs - Base delay in ms for exponential backoff (default: 2000)
 * @returns Transaction receipt if confirmed
 * @throws Error if transaction fails after all retries and fallback
 */
async function waitForTransactionWithRetry(
  txResponse: TransactionResponse,
  confirmations: number = 1,
  maxRetries: number = 5,
  baseDelayMs: number = 2000
): Promise<TransactionReceipt | null> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const receipt = await txResponse.wait(confirmations);
      return receipt;
    } catch (error: any) {
      lastError = error;

      const nonRetryableErrors = ['CALL_EXCEPTION', 'INSUFFICIENT_FUNDS', 'NONCE_EXPIRED', 'TRANSACTION_REPLACED'];
      if (error.code && nonRetryableErrors.includes(error.code)) {
        throw error;
      }

      if (attempt < maxRetries - 1) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.warn(`Retry ${attempt + 1}/${maxRetries} for ${txResponse.hash} after ${delayMs}ms (${error.message})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
    }
  }

  console.warn(`.wait() failed after ${maxRetries} attempts, querying receipt manually...`);
  try {
    const receipt = await txResponse.provider.getTransactionReceipt(txResponse.hash);
    if (receipt && (await receipt.confirmations()) >= confirmations) {
      console.log(`Transaction confirmed despite .wait() error: ${txResponse.hash}`);
      return receipt;
    } else {
      console.error(`Transaction not found or insufficient confirmations: ${txResponse.hash}`);
    }
  } catch (receiptError: any) {
    console.error(`Could not get receipt for ${txResponse.hash}: ${receiptError.message}`);
  }

  throw lastError || new Error(`Failed to get receipt for ${txResponse.hash} after ${maxRetries} retries`);
}

async function main(hre: HardhatRuntimeEnvironment) {
  // Validate deployment credentials are provided
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error('DEPLOYER_PRIVATE_KEY must be set in .env for deployment');
  }

  const { ethers } = hre;
  const provider = ethers.provider;
  const network = await provider.getNetwork();
  const chainId = network.chainId;
  const isLocal = hre.network.name === 'localhost' || hre.network.name === 'hardhat';
  const gasConfig = getGasConfig(hre.network.name);

  // For local testing, accept WCBTC address from environment variable
  let wcbtcAddress: string;
  if (isLocal && process.env.WCBTC_ADDRESS) {
    try {
      wcbtcAddress = ethers.getAddress(process.env.WCBTC_ADDRESS);
      console.log(`Using WCBTC address from environment for local testing: ${wcbtcAddress}`);
    } catch (error) {
      throw new Error(`Invalid WCBTC_ADDRESS environment variable: ${process.env.WCBTC_ADDRESS}. Must be a valid Ethereum address.`);
    }
  } else {
    const addressConfig = ADDRESSES[Number(chainId)];
    if (!addressConfig) {
      throw new Error(`No address configuration found for chainId ${chainId}. Add it to constants/addresses.ts`);
    }
    wcbtcAddress = addressConfig.WCBTC;
    if (!wcbtcAddress) {
      throw new Error(`WCBTC address not configured for chainId ${chainId} in ADDRESSES. ${isLocal ? 'For local testing, set WCBTC_ADDRESS environment variable.' : ''}`);
    }
  }

  console.log('Starting protocol deployment with the following configuration:');

  console.log(`Deploying on ${hre.network.name} (chainId: ${chainId})`);
  if ('url' in hre.network.config) console.log(`RPC URL: ${hre.network.config.url}`);
  console.log(`Deployment method: Rapid sequential (atomic-style)`);

  const [deployer] = await ethers.getSigners();
  console.log(`Using deployer address: ${deployer.address}`);

  const blockNumber = await provider.getBlockNumber();
  const targetBlock = blockNumber + deploymentConstants.targetBlockOffset;
  let nonce = await provider.getTransactionCount(deployer.address);
  console.log(`Starting deployment targeting block ${targetBlock}`);
  console.log(`Current nonce: ${nonce}`);

  // Verify gas price configuration
  const feeData = await provider.getFeeData();
  const configMaxFee = ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei');

  console.log(`Network max fee: ${feeData.maxFeePerGas ? ethers.formatUnits(feeData.maxFeePerGas, 'gwei') : 'N/A'} gwei`);
  console.log(`Configured max fee: ${gasConfig.maxFeePerGas} gwei\n`);

  if (feeData.maxFeePerGas && feeData.maxFeePerGas > configMaxFee) {
    console.error('WARNING: Configured gas price may be too low for current network conditions\n');
  }

  const transactionBundle: TransactionRequest[] = [];

  // Track contract deployment metadata
  async function createDeployTx(contractName: string, artifact: any, constructorArgs: any[] = []) {
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
    const txRequest = await factory.getDeployTransaction(...constructorArgs);

    const deployTx: TransactionRequest = {
      to: null,
      data: txRequest.data,
      value: txRequest.value || 0,
      gasLimit: ethers.parseUnits(deploymentConstants.contractDeploymentGasLimit, 'wei'),
      chainId: chainId,
      type: 2, // EIP-1559
      maxFeePerGas: ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits(gasConfig.maxPriorityFeePerGas, 'gwei'),
      nonce: nonce++,
    };

    transactionBundle.push(deployTx);

    // Calculate deployed contract address
    const address = ethers.getCreateAddress({
      from: deployer.address,
      nonce: deployTx.nonce!,
    });

    console.log(`${contractName} will be deployed at: ${address}`);
    return {
      address,
      constructorArgs,
    };
  }

  // Track contract call metadata
  async function createCallTx(contractAddress: string, abi: any, functionName: string, args: any[]) {
    const contract = new ethers.Contract(contractAddress, abi, deployer);
    const data = contract.interface.encodeFunctionData(functionName, args);

    const callTx: TransactionRequest = {
      to: contractAddress,
      data,
      value: 0,
      gasLimit: ethers.parseUnits(deploymentConstants.contractCallGasLimit, 'wei'),
      chainId: chainId,
      type: 2, // EIP-1559
      maxFeePerGas: ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits(gasConfig.maxPriorityFeePerGas, 'gwei'),
      nonce: nonce++,
    };

    transactionBundle.push(callTx);
    return callTx;
  }

  // Deploy all contracts
  console.log('Setting up contract deployment transactions...');

  // Deploy StartUSD genesis token (10,000 SUSD)
  const startUSD = await createDeployTx('StartUSD', StartUSDArtifact);

  const juiceDollar = await createDeployTx('JuiceDollar', JuiceDollarArtifact, [
    contractsParams.juiceDollar.minApplicationPeriod,
  ]);

  // Calculate equity address (first contract deployed internally => nonce = 1)
  const equity = {
    address: ethers.getCreateAddress({ from: juiceDollar.address, nonce: 1 }),
    constructorArgs: [juiceDollar.address],
  };
  console.log('Equity address will be deployed at: ', equity.address);

  const positionFactory = await createDeployTx('PositionFactory', PositionFactoryArtifact);

  const positionRoller = await createDeployTx('PositionRoller', PositionRollerArtifact, [juiceDollar.address]);

  // Deploy StablecoinBridge for StartUSD → JUSD
  const bridgeStartUSD = await createDeployTx('StablecoinBridgeStartUSD', StablecoinBridgeArtifact, [
    startUSD.address,
    juiceDollar.address,
    contractsParams.bridges.startUSD.limit,
    contractsParams.bridges.startUSD.weeks,
  ]);

  // Deploy FrontendGateway
  const frontendGateway = await createDeployTx('FrontendGateway', FrontendGatewayArtifact, [
    juiceDollar.address,
  ]);

  // Deploy SavingsGateway
  const savingsGateway = await createDeployTx('SavingsGateway', SavingsGatewayArtifact, [
    juiceDollar.address,
    contractsParams.savingsGateway.initialRatePPM,
    frontendGateway.address,
  ]);

  // Deploy MintingHubGateway
  const mintingHubGateway = await createDeployTx('MintingHubGateway', MintingHubGatewayArtifact, [
    juiceDollar.address,
    savingsGateway.address,
    positionRoller.address,
    positionFactory.address,
    frontendGateway.address,
  ]);

  // Deploy SavingsVaultJUSD
  const savingsVaultJUSD = await createDeployTx('SavingsVaultJUSD', SavingsVaultJUSDArtifact, [
    juiceDollar.address,
    savingsGateway.address,
    'Savings Vault JUSD', // name
    'svJUSD', // symbol
  ]);

  // Deploy CoinLendingGateway
  const coinLendingGateway = await createDeployTx('CoinLendingGateway', CoinLendingGatewayArtifact, [
    mintingHubGateway.address,
    wcbtcAddress,
    juiceDollar.address,
  ]);

  const deployedContracts: DeployedContracts = {
    startUSD,
    juiceDollar,
    equity,
    positionFactory,
    positionRoller,
    bridgeStartUSD,
    frontendGateway,
    savingsGateway,
    mintingHubGateway,
    savingsVaultJUSD,
    coinLendingGateway,
  };

  // Setup initialization transactions
  console.log('Setting up initialization transactions...');

  // Initialize FrontendGateway
  createCallTx(frontendGateway.address, FrontendGatewayArtifact.abi, 'init', [
    savingsGateway.address,
    mintingHubGateway.address,
  ]);

  // Initialize minters in JuiceDollar
  createCallTx(juiceDollar.address, JuiceDollarArtifact.abi, 'initialize', [
    mintingHubGateway.address,
    'MintingHubGateway',
  ]);

  createCallTx(juiceDollar.address, JuiceDollarArtifact.abi, 'initialize', [
    positionRoller.address,
    'PositionRoller',
  ]);

  createCallTx(juiceDollar.address, JuiceDollarArtifact.abi, 'initialize', [
    savingsGateway.address,
    'SavingsGateway',
  ]);

  createCallTx(juiceDollar.address, JuiceDollarArtifact.abi, 'initialize', [
    frontendGateway.address,
    'FrontendGateway',
  ]);

  createCallTx(juiceDollar.address, JuiceDollarArtifact.abi, 'initialize', [
    bridgeStartUSD.address,
    'StablecoinBridgeStartUSD',
  ]);

  // Approve and mint 1000 JUSD through the StartUSD bridge to close initialization phase
  const startUSDAmount = ethers.parseUnits('1000', 18);
  createCallTx(
    startUSD.address,
    StartUSDArtifact.abi,
    'approve',
    [bridgeStartUSD.address, startUSDAmount],
  );

  createCallTx(bridgeStartUSD.address, StablecoinBridgeArtifact.abi, 'mint', [startUSDAmount]);

  // Approve and invest 1000 JUSD in Equity to mint the initial 100,000,000 JUICE
  const jusdInvestAmount = ethers.parseUnits('1000', 18);
  const expectedShares = ethers.parseUnits('100000000', 18);

  createCallTx(juiceDollar.address, JuiceDollarArtifact.abi, 'approve', [equity.address, jusdInvestAmount]);

  createCallTx(
    equity.address,
    EquityArtifact.abi,
    'invest',
    [jusdInvestAmount, expectedShares],
  );

  // Rapid sequential deployment
  console.log(`\nSubmitting ${transactionBundle.length} transactions rapidly in sequence...`);
  console.log('NOTE: Transactions will be sent sequentially to Citrea sequencer.');
  console.log('SECURITY: Use a fresh, unknown deployer address to minimize front-running risk.\n');

  let deploymentSuccessful = false;

  try {
    const txResponses: TransactionResponse[] = [];
    const startTime = Date.now();

    for (let i = 0; i < transactionBundle.length; i++) {
      const tx = transactionBundle[i];
      const txResponse: TransactionResponse = await deployer.sendTransaction(tx);
      txResponses.push(txResponse);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[${i + 1}/${transactionBundle.length}] TX submitted: ${txResponse.hash} (${elapsed}s elapsed)`);
    }

    console.log(`\nAll ${transactionBundle.length} transactions submitted in ${((Date.now() - startTime) / 1000).toFixed(2)} seconds`);
    console.log('Waiting for transaction confirmations sequentially with retry logic...\n');

    // Wait for transactions sequentially with retry logic to handle RPC timeouts
    const receipts = [];
    const confirmations = isLocal ? 1 : 6;
    for (let i = 0; i < txResponses.length; i++) {
      try {
        const receipt = await waitForTransactionWithRetry(txResponses[i], confirmations, 5, 2000);
        if (receipt) {
          console.log(`[${i + 1}/${txResponses.length}] TX confirmed: ${txResponses[i].hash} (block ${receipt.blockNumber})`);
          receipts.push(receipt);
        } else {
          console.error(`[${i + 1}/${txResponses.length}] TX failed to confirm: ${txResponses[i].hash}`);
          receipts.push(null);
        }
      } catch (error: any) {
        console.error(`[${i + 1}/${txResponses.length}] TX confirmation error: ${txResponses[i].hash} - ${error.message}`);
        receipts.push(null);
      }
    }

    const nullReceipts = receipts.filter((receipt) => receipt === null);
    const failedTxs = receipts.filter((receipt) => receipt && receipt.status === 0);

    if (nullReceipts.length > 0) {
      console.error(`\n${nullReceipts.length} transaction(s) failed to confirm`);
      deploymentSuccessful = false;
    } else if (failedTxs.length > 0) {
      console.error(`\n${failedTxs.length} transaction(s) reverted`);
      deploymentSuccessful = false;
    } else {
      console.log('\nAll transactions confirmed successfully!');
      deploymentSuccessful = true;
    }
  } catch (error) {
    console.error('Error during rapid sequential deployment:', error);
  }

  if (!deploymentSuccessful) {
    console.error('Failed to deploy protocol. Exiting...');
    process.exit(1);
  }

  const networkFolder = hre.network.name === 'hardhat' ? 'localhost' : hre.network.name;

  const deploymentInfo = {
    schemaVersion: '1.0',
    network: {
      name: hre.network.name,
      chainId: Number(chainId)
    },
    deployment: {
      deployedAt: new Date().toISOString(),
      deployedBy: deployer.address,
      blockNumber: targetBlock
    },
    contracts: deployedContracts,
    metadata: {
      deployer: 'JuiceDollar/smartContracts',
      deploymentMethod: 'rapid-sequential',
      scriptVersion: '1.0.0'
    }
  };

  const deploymentDir = path.join(__dirname, '../../../deployments', networkFolder);
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  const filename = 'protocol.json';
  fs.writeFileSync(
    path.join(deploymentDir, filename),
    JSON.stringify(deploymentInfo, null, 2),
  );
  console.log(`\nDeployment metadata saved to: deployments/${networkFolder}/${filename}`);

  console.log('\nDeployed Contracts:');
  console.log(JSON.stringify(deployedContracts, null, 2));
}

// Hardhat script export
export default main;

// Allow running as standalone script
if (require.main === module) {
  const hre = require('hardhat');
  main(hre)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Deployment error:', error);
      process.exit(1);
    });
}
