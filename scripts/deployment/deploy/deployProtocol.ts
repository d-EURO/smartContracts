import { ethers, TransactionRequest } from 'ethers';
import { FlashbotsBundleProvider, FlashbotsBundleResolution } from '@flashbots/ethers-provider-bundle';
import dotenv from 'dotenv';
import hardhat from 'hardhat';
import fs from 'fs';
import path from 'path';
import { flashbotsConfig, contractsParams } from '../config/flashbotsConfig';

// Import contract artifacts
import DecentralizedEUROArtifact from '../../../artifacts/contracts/DecentralizedEURO.sol/DecentralizedEURO.json';
import PositionFactoryArtifact from '../../../artifacts/contracts/MintingHubV2/PositionFactory.sol/PositionFactory.json';
import PositionRollerArtifact from '../../../artifacts/contracts/MintingHubV2/PositionRoller.sol/PositionRoller.json';
import StablecoinBridgeArtifact from '../../../artifacts/contracts/StablecoinBridge.sol/StablecoinBridge.json';
import DEPSWrapperArtifact from '../../../artifacts/contracts/utils/DEPSWrapper.sol/DEPSWrapper.json';
import FrontendGatewayArtifact from '../../../artifacts/contracts/gateway/FrontendGateway.sol/FrontendGateway.json';
import SavingsGatewayArtifact from '../../../artifacts/contracts/gateway/SavingsGateway.sol/SavingsGateway.json';
import MintingHubGatewayArtifact from '../../../artifacts/contracts/gateway/MintingHubGateway.sol/MintingHubGateway.json';

dotenv.config();

// Define a type for our bundle transactions
interface FlashbotsBundleTransaction {
  signedTransaction?: string;
  signer: any;
  transaction: TransactionRequest;
}

interface DeployedContracts {
  decentralizedEURO?: string;
  positionFactory?: string;
  positionRoller?: string;
  bridgeEURC?: string;
  bridgeEURT?: string;
  bridgeVEUR?: string;
  bridgeEURS?: string;
  depsWrapper?: string;
  frontendGateway?: string;
  savingsGateway?: string;
  mintingHubGateway?: string;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_RPC_KEY}`, 1);
  const network = await provider.getNetwork();
  const chainId = network.chainId;
  console.log(`Deploying on ${network.name} (chainId: ${chainId})`);

  const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);
  console.log(`Using deployer address: ${deployer.address}`);

  if (!process.env.FLASHBOTS_AUTH_KEY) {
    throw new Error('FLASHBOTS_AUTH_KEY environment variable is required');
  }

  // Setup Flashbots provider and target block
  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    new ethers.Wallet(process.env.FLASHBOTS_AUTH_KEY),
  );
  const blockNumber = await provider.getBlockNumber();
  const targetBlock = blockNumber + flashbotsConfig.targetBlockOffset;
  let nonce = await provider.getTransactionCount(deployer.address);
  console.log(`Starting deployment targeting block ${targetBlock}`);
  console.log(`Current nonce: ${nonce}`);

  const transactionBundle: FlashbotsBundleTransaction[] = [];
  
  // Add coinbase payment transaction if configured
  if (flashbotsConfig.coinbasePayment) {
    const block = await provider.getBlock('latest');
    if (block && block.miner) {
      const coinbasePaymentTx: TransactionRequest = {
        to: block.miner,
        value: ethers.parseEther(flashbotsConfig.coinbasePayment),
        gasLimit: 21000,
        chainId: chainId,
        type: 2, // EIP-1559
        maxFeePerGas: ethers.parseUnits(flashbotsConfig.maxFeePerGas, 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits(flashbotsConfig.maxPriorityFeePerGas, 'gwei'),
        nonce: nonce++,
      };
      
      transactionBundle.push({
        transaction: coinbasePaymentTx,
        signer: deployer,
      });
      
      console.log(`Added coinbase payment of ${flashbotsConfig.coinbasePayment} ETH to ${block.miner}`);
    } else {
      console.warn('Could not get latest block miner, skipping coinbase payment');
    }
  }

  // Track contract deployment metadata
  async function createDeployTx(contractName: string, artifact: any, constructorArgs: any[] = []) {
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
    const txRequest = await factory.getDeployTransaction(...constructorArgs);

    const deployTx: TransactionRequest = {
      to: null,
      data: txRequest.data,
      value: txRequest.value || 0,
      gasLimit: ethers.parseUnits(flashbotsConfig.contractDeploymentGasLimit, 'wei'),
      chainId: chainId,
      type: 2, // EIP-1559
      maxFeePerGas: ethers.parseUnits(flashbotsConfig.maxFeePerGas, 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits(flashbotsConfig.maxPriorityFeePerGas, 'gwei'),
      nonce: nonce++,
    };

    transactionBundle.push({
      transaction: deployTx,
      signer: deployer,
    });

    // Calculate deployed contract address
    const address = ethers.getCreateAddress({
      from: deployer.address,
      nonce: deployTx.nonce!,
    });

    console.log(`${contractName} will be deployed at: ${address}`);
    return address;
  }

  // Track contract initialization metadata
  async function createCallTx(contractAddress: string, abi: any, functionName: string, args: any[]) {
    const contract = new ethers.Contract(contractAddress, abi, deployer);
    const data = contract.interface.encodeFunctionData(functionName, args);

    const callTx: TransactionRequest = {
      to: contractAddress,
      data,
      value: 0,
      gasLimit: ethers.parseUnits(flashbotsConfig.contractCallGasLimit, 'wei'),
      chainId: chainId,
      type: 2, // EIP-1559
      maxFeePerGas: ethers.parseUnits(flashbotsConfig.maxFeePerGas, 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits(flashbotsConfig.maxPriorityFeePerGas, 'gwei'),
      nonce: nonce++,
    };

    transactionBundle.push({
      transaction: callTx,
      signer: deployer,
    });

    return callTx;
  }

  // 1. Deploy all contracts
  console.log('Setting up contract deployment transactions...');

  const decentralizedEURO = await createDeployTx('DecentralizedEURO', DecentralizedEUROArtifact, [
    contractsParams.decentralizedEURO.minApplicationPeriod,
  ]);

  // Calculate equity address
  const equity = ethers.getCreateAddress({
    from: decentralizedEURO,
    nonce: 1, // First contract created by DecentralizedEURO
  });
  console.log('Equity address will be deployed at: ', equity);

  const positionFactory = await createDeployTx('PositionFactory', PositionFactoryArtifact);

  const positionRoller = await createDeployTx('PositionRoller', PositionRollerArtifact, [decentralizedEURO]);

  const depsWrapper = await createDeployTx('DEPSWrapper', DEPSWrapperArtifact, [equity]);

  const bridgeEURC = await createDeployTx('StablecoinBridgeEURC', StablecoinBridgeArtifact, [
    contractsParams.bridges.eurc.other,
    decentralizedEURO,
    contractsParams.bridges.eurc.limit,
    contractsParams.bridges.eurc.weeks,
  ]);

  const bridgeEURT = await createDeployTx('StablecoinBridgeEURT', StablecoinBridgeArtifact, [
    contractsParams.bridges.eurt.other,
    decentralizedEURO,
    contractsParams.bridges.eurt.limit,
    contractsParams.bridges.eurt.weeks,
  ]);

  const bridgeVEUR = await createDeployTx('StablecoinBridgeVEUR', StablecoinBridgeArtifact, [
    contractsParams.bridges.veur.other,
    decentralizedEURO,
    contractsParams.bridges.veur.limit,
    contractsParams.bridges.veur.weeks,
  ]);

  const bridgeEURS = await createDeployTx('StablecoinBridgeEURS', StablecoinBridgeArtifact, [
    contractsParams.bridges.eurs.other,
    decentralizedEURO,
    contractsParams.bridges.eurs.limit,
    contractsParams.bridges.eurs.weeks,
  ]);

  // Deploy FrontendGateway
  const frontendGateway = await createDeployTx('FrontendGateway', FrontendGatewayArtifact, [
    decentralizedEURO,
    depsWrapper,
  ]);

  // Deploy SavingsGateway
  const savingsGateway = await createDeployTx('SavingsGateway', SavingsGatewayArtifact, [
    decentralizedEURO,
    contractsParams.savingsGateway.initialRatePPM,
    frontendGateway,
  ]);

  // Deploy MintingHubGateway
  const mintingHubGateway = await createDeployTx('MintingHubGateway', MintingHubGatewayArtifact, [
    decentralizedEURO,
    savingsGateway,
    positionRoller,
    positionFactory,
    frontendGateway,
  ]);

  const deployedContracts: DeployedContracts = {
    decentralizedEURO,
    positionFactory,
    positionRoller,
    bridgeEURC,
    bridgeEURT,
    bridgeVEUR,
    bridgeEURS,
    depsWrapper,
    frontendGateway,
    savingsGateway,
    mintingHubGateway,
  };

  // 2. Setup initialization transactions
  console.log('Setting up initialization transactions...');

  // Initialize FrontendGateway
  createCallTx(frontendGateway, FrontendGatewayArtifact.abi, 'init', [savingsGateway, mintingHubGateway]);

  // Initialize minters in DecentralizedEURO
  createCallTx(decentralizedEURO, DecentralizedEUROArtifact.abi, 'initialize', [
    mintingHubGateway,
    'MintingHubGateway',
  ]);

  createCallTx(decentralizedEURO!, DecentralizedEUROArtifact.abi, 'initialize', [positionRoller, 'PositionRoller']);

  createCallTx(decentralizedEURO!, DecentralizedEUROArtifact.abi, 'initialize', [savingsGateway, 'SavingsGateway']);

  createCallTx(decentralizedEURO!, DecentralizedEUROArtifact.abi, 'initialize', [frontendGateway, 'FrontendGateway']);

  if (bridgeEURC) {
    createCallTx(decentralizedEURO!, DecentralizedEUROArtifact.abi, 'initialize', [bridgeEURC, 'StablecoinBridgeEURC']);
  }

  if (bridgeEURT) {
    createCallTx(decentralizedEURO!, DecentralizedEUROArtifact.abi, 'initialize', [bridgeEURT, 'StablecoinBridgeEURT']);
  }

  if (bridgeVEUR) {
    createCallTx(decentralizedEURO!, DecentralizedEUROArtifact.abi, 'initialize', [bridgeVEUR, 'StablecoinBridgeVEUR']);
  }

  if (bridgeEURS) {
    createCallTx(decentralizedEURO!, DecentralizedEUROArtifact.abi, 'initialize', [bridgeEURS, 'StablecoinBridgeEURS']);
  }

  // TODO: Mint some dEURO to close initialisation phase (IMPORTANT!)

  // 3. Submit the bundle directly to Flashbots (no need to sign separately)
  console.log(`Preparing to submit ${transactionBundle.length} transactions...`);

  // 4. Submit the bundle to Flashbots
  let retries = 0;
  let bundleSubmitted = false;

  console.log(`Submitting bundle to Flashbots targeting block ${targetBlock}...`);

  while (retries < flashbotsConfig.maxRetries && !bundleSubmitted) {
    try {
      // Send the bundle
      const bundleResponse = await flashbotsProvider.sendBundle(transactionBundle, targetBlock + retries);

      // Check if there's an error with the response
      if ('error' in bundleResponse) {
        console.error(`Error with bundle: ${bundleResponse.error.message}`);
        retries++;
        console.log(`Retrying (${retries}/${flashbotsConfig.maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, flashbotsConfig.retryDelayMs));
        continue;
      }

      // Simulate the bundle to check for issues
      const signedTransactions = await flashbotsProvider.signBundle(transactionBundle);
      const simulation = await flashbotsProvider.simulate(signedTransactions, targetBlock + retries);

      if ('error' in simulation) {
        console.error(`Simulation error: ${simulation.error.message}`);
        retries++;
        console.log(`Retrying (${retries}/${flashbotsConfig.maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, flashbotsConfig.retryDelayMs));
        continue;
      }

      console.log(`Bundle simulated successfully. Estimated gas used: ${simulation.totalGasUsed}`);
      console.log(`Effective gas price: ${simulation.bundleGasPrice}`);

      // Wait for bundle inclusion
      console.log(`Waiting for bundle inclusion...`);
      const waitResponse = await bundleResponse.wait();

      if (waitResponse === FlashbotsBundleResolution.BundleIncluded) {
        console.log('Bundle was included in the target block!');
        bundleSubmitted = true;
      } else if (waitResponse === FlashbotsBundleResolution.BlockPassedWithoutInclusion) {
        console.log('Bundle was not included in the target block');
        retries++;
        console.log(`Retrying (${retries}/${flashbotsConfig.maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, flashbotsConfig.retryDelayMs));
      } else if (waitResponse === FlashbotsBundleResolution.AccountNonceTooHigh) {
        console.error('Bundle not included - account nonce too high');
        process.exit(1);
      }
    } catch (error) {
      console.error('Error submitting Flashbots bundle:', error);
      retries++;
      console.log(`Retrying (${retries}/${flashbotsConfig.maxRetries}) in ${flashbotsConfig.retryDelayMs / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, flashbotsConfig.retryDelayMs));
    }
  }

  if (!bundleSubmitted) {
    console.error('Failed to submit bundle after maximum retries');
    process.exit(1);
  }

  // 5. Save deployment info to file
  console.log('Saving deployment addresses...');
  const deploymentInfo = {
    network: (await provider.getNetwork()).name,
    blockNumber: targetBlock,
    deployer: deployer.address,
    contracts: deployedContracts,
  };

  const deploymentDir = path.join(__dirname, '../../deployments/flashbots');
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  fs.writeFileSync(path.join(deploymentDir, `deployment-${Date.now()}.json`), JSON.stringify(deploymentInfo, null, 2));

  console.log('Deployment completed successfully!');
  console.log('Deployed contract addresses:');
  console.log(JSON.stringify(deployedContracts, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Deployment error:', error);
    process.exit(1);
  });
