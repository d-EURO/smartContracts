import { TransactionRequest, TransactionResponse } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { deploymentConfig, contractsParams } from '../config/deploymentConfig';
import StartUSDArtifact from '../../../artifacts/contracts/StartUSD.sol/StartUSD.json';
import JuiceDollarArtifact from '../../../artifacts/contracts/JuiceDollar.sol/JuiceDollar.json';
import PositionFactoryArtifact from '../../../artifacts/contracts/MintingHubV2/PositionFactory.sol/PositionFactory.json';
import PositionRollerArtifact from '../../../artifacts/contracts/MintingHubV2/PositionRoller.sol/PositionRoller.json';
import StablecoinBridgeArtifact from '../../../artifacts/contracts/StablecoinBridge.sol/StablecoinBridge.json';
import FrontendGatewayArtifact from '../../../artifacts/contracts/gateway/FrontendGateway.sol/FrontendGateway.json';
import SavingsGatewayArtifact from '../../../artifacts/contracts/gateway/SavingsGateway.sol/SavingsGateway.json';
import MintingHubGatewayArtifact from '../../../artifacts/contracts/gateway/MintingHubGateway.sol/MintingHubGateway.json';
import EquityArtifact from '../../../artifacts/contracts/Equity.sol/Equity.json';

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
}

async function main(hre: HardhatRuntimeEnvironment) {
  const { ethers } = hre;
  const provider = ethers.provider;
  const network = await provider.getNetwork();
  const chainId = network.chainId;

  console.log(`Deploying on ${hre.network.name} (chainId: ${chainId})`);
  if ('url' in hre.network.config) console.log(`RPC URL: ${hre.network.config.url}`);
  console.log(`Deployment method: Rapid sequential (atomic-style)`);

  const [deployer] = await ethers.getSigners();
  console.log(`Using deployer address: ${deployer.address}`);

  const blockNumber = await provider.getBlockNumber();
  const targetBlock = blockNumber + deploymentConfig.targetBlockOffset;
  let nonce = await provider.getTransactionCount(deployer.address);
  console.log(`Starting deployment targeting block ${targetBlock}`);
  console.log(`Current nonce: ${nonce}`);

  const transactionBundle: TransactionRequest[] = [];

  // Track contract deployment metadata
  async function createDeployTx(contractName: string, artifact: any, constructorArgs: any[] = []) {
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
    const txRequest = await factory.getDeployTransaction(...constructorArgs);

    const deployTx: TransactionRequest = {
      to: null,
      data: txRequest.data,
      value: txRequest.value || 0,
      gasLimit: ethers.parseUnits(deploymentConfig.contractDeploymentGasLimit, 'wei'),
      chainId: chainId,
      type: 2, // EIP-1559
      maxFeePerGas: ethers.parseUnits(deploymentConfig.maxFeePerGas, 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits(deploymentConfig.maxPriorityFeePerGas, 'gwei'),
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
      gasLimit: ethers.parseUnits(deploymentConfig.contractCallGasLimit, 'wei'),
      chainId: chainId,
      type: 2, // EIP-1559
      maxFeePerGas: ethers.parseUnits(deploymentConfig.maxFeePerGas, 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits(deploymentConfig.maxPriorityFeePerGas, 'gwei'),
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

  // Approve and invest 1000 JUSD in Equity to mint the initial 10,000,000 JUICE
  const jusdInvestAmount = ethers.parseUnits('1000', 18);
  const expectedShares = ethers.parseUnits('10000000', 18);

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

    console.log(`\n✅ All ${transactionBundle.length} transactions submitted in ${((Date.now() - startTime) / 1000).toFixed(2)} seconds`);
    console.log('Waiting for transaction confirmations...\n');

    // Wait for all transactions to be mined
    const receipts = await Promise.all(
      txResponses.map((txResponse, idx) => {
        return txResponse.wait(1).then((receipt) => {
          if (receipt) {
            console.log(`[${idx + 1}/${txResponses.length}] TX confirmed: ${txResponse.hash} (block ${receipt.blockNumber})`);
          }
          return receipt;
        });
      })
    );

    const failedTxs = receipts.filter((receipt) => receipt && receipt.status === 0);
    if (failedTxs.length > 0) {
      console.error(`\n${failedTxs.length} transactions failed!`);
      failedTxs.forEach((receipt, idx) => {
        console.error(`Failed TX ${idx + 1}: ${receipt?.hash}`);
      });
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

  // Save deployment metadata to file using standard schema
  console.log('Saving deployment metadata to file...');

  // Determine network folder name
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

  console.log(`\n✅ Deployment metadata saved to: deployments/${networkFolder}/${filename}`);
  console.log('\n📋 Deployed Contracts:');
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
