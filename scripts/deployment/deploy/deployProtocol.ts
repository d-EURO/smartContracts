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
import EquityArtifact from '../../../artifacts/contracts/Equity.sol/Equity.json';
import PositionArtifact from '../../../artifacts/contracts/MintingHubV2/Position.sol/Position.json';
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
  bridgeUSDC?: DeployedContract;
  bridgeUSDT?: DeployedContract;
  bridgeCTUSD?: DeployedContract;
  frontendGateway: DeployedContract;
  savingsGateway: DeployedContract;
  mintingHubGateway: DeployedContract;
  savingsVaultJUSD: DeployedContract;
  genesisPosition?: DeployedContract;
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
  baseDelayMs: number = 2000,
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
        await new Promise((resolve) => setTimeout(resolve, delayMs));
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
  if (!process.env.DEPLOYER_MNEMONIC) {
    throw new Error('DEPLOYER_MNEMONIC must be set in .env for deployment (12 or 24 word phrase)');
  }

  const { ethers } = hre;
  const provider = ethers.provider;
  const network = await provider.getNetwork();
  const chainId = network.chainId;
  const isLocal = hre.network.name === 'localhost' || hre.network.name === 'hardhat';
  // Fork should use Citrea gas prices, not hardhat's high test prices
  const gasConfig =
    process.env.FORK_ENABLED === 'true' ? getGasConfig('citreaTestnet') : getGasConfig(hre.network.name);

  // Derive deployer wallet from mnemonic using standard BIP44 path
  // Get root node (at path "m") to derive all addresses from absolute BIP44 paths
  const mnemonic = ethers.Mnemonic.fromPhrase(process.env.DEPLOYER_MNEMONIC!);
  const rootNode = ethers.HDNodeWallet.fromMnemonic(mnemonic, 'm');
  const deployerPath = "m/44'/60'/0'/0/0";
  const deployerNode = rootNode.derivePath(deployerPath);
  const deployer = new ethers.Wallet(deployerNode.privateKey, provider);

  console.log('Starting protocol deployment with the following configuration:');
  console.log(`Deploying on ${hre.network.name} (chainId: ${chainId})`);
  if ('url' in hre.network.config) console.log(`RPC URL: ${hre.network.config.url}`);
  console.log(`Deployment method: Rapid sequential (atomic-style)`);
  console.log(`Deployer address: ${deployer.address} (derived from mnemonic at ${deployerPath})`);

  // For local testing, accept WCBTC address from environment variable
  let wcbtcAddress: string;
  let usdcEAddress: string | undefined;
  let usdtEAddress: string | undefined;
  let ctUsdAddress: string | undefined;
  if (isLocal && process.env.WCBTC_ADDRESS) {
    try {
      wcbtcAddress = ethers.getAddress(process.env.WCBTC_ADDRESS);
      console.log(`Using WCBTC address from environment for local testing: ${wcbtcAddress}`);
    } catch (error) {
      throw new Error(
        `Invalid WCBTC_ADDRESS environment variable: ${process.env.WCBTC_ADDRESS}. Must be a valid Ethereum address.`,
      );
    }
  } else {
    const addressConfig = ADDRESSES[Number(chainId)];
    if (!addressConfig) {
      throw new Error(`No address configuration found for chainId ${chainId}. Add it to constants/addresses.ts`);
    }
    wcbtcAddress = addressConfig.WCBTC;
    if (!wcbtcAddress) {
      throw new Error(
        `WCBTC address not configured for chainId ${chainId} in ADDRESSES. ${isLocal ? 'For local testing, set WCBTC_ADDRESS environment variable.' : ''}`,
      );
    }
    // Get USDC.e, USDT.e, and ctUSD addresses for stablecoin bridges (optional)
    usdcEAddress = addressConfig.USDC_E;
    usdtEAddress = addressConfig.USDT_E;
    ctUsdAddress = addressConfig.CT_USD;
    if (usdcEAddress) console.log(`USDC.e address: ${usdcEAddress}`);
    if (usdtEAddress) console.log(`USDT.e address: ${usdtEAddress}`);
    if (ctUsdAddress) console.log(`ctUSD address: ${ctUsdAddress}`);
  }

  const blockNumber = await provider.getBlockNumber();
  const targetBlock = blockNumber + deploymentConstants.targetBlockOffset;
  let nonce = await provider.getTransactionCount(deployer.address);
  console.log(`Starting deployment targeting block ${targetBlock}`);
  console.log(`Current nonce: ${nonce}`);

  // Verify gas price configuration
  const feeData = await provider.getFeeData();
  const configMaxFee = ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei');

  console.log(
    `Network max fee: ${feeData.maxFeePerGas ? ethers.formatUnits(feeData.maxFeePerGas, 'gwei') : 'N/A'} gwei`,
  );
  console.log(`Configured max fee: ${gasConfig.maxFeePerGas} gwei\n`);

  if (feeData.maxFeePerGas && feeData.maxFeePerGas > configMaxFee) {
    console.error('WARNING: Configured gas price may be too low for current network conditions\n');
  }

  // Check deployer has sufficient balance for deployment
  const deployerBalance = await provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(deployerBalance)} cBTC`);

  if (deployerBalance === 0n) {
    throw new Error(`Deployer has zero balance. Please fund ${deployer.address} with cBTC before deployment.`);
  }

  // Rough estimate: 40M gas for main deployment + batch investor funding
  const estimatedGasNeeded = 40_000_000n;
  const estimatedCost = estimatedGasNeeded * configMaxFee;
  console.log(`Estimated deployment cost: ~${ethers.formatEther(estimatedCost)} cBTC (conservative estimate)\n`);

  if (deployerBalance < estimatedCost) {
    console.warn(
      `WARNING: Balance may be insufficient. Have: ${ethers.formatEther(deployerBalance)} cBTC, Estimated need: ~${ethers.formatEther(estimatedCost)} cBTC\n`,
    );
  }

  const transactionBundle: TransactionRequest[] = [];
  const transactionSigners: Array<typeof deployer> = []; // Track which signer should sign each transaction

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
    transactionSigners.push(deployer);

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
    transactionSigners.push(deployer);
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

  // Deploy StablecoinBridge for USDC.e → JUSD (if configured)
  let bridgeUSDC: DeployedContract | undefined;
  if (usdcEAddress) {
    bridgeUSDC = await createDeployTx('StablecoinBridgeUSDC', StablecoinBridgeArtifact, [
      usdcEAddress,
      juiceDollar.address,
      contractsParams.bridges.USDC_E.limit,
      contractsParams.bridges.USDC_E.weeks,
    ]);
  }

  // Deploy StablecoinBridge for USDT.e → JUSD (if configured)
  let bridgeUSDT: DeployedContract | undefined;
  if (usdtEAddress) {
    bridgeUSDT = await createDeployTx('StablecoinBridgeUSDT', StablecoinBridgeArtifact, [
      usdtEAddress,
      juiceDollar.address,
      contractsParams.bridges.USDT_E.limit,
      contractsParams.bridges.USDT_E.weeks,
    ]);
  }

  // Deploy StablecoinBridge for ctUSD → JUSD (if configured)
  let bridgeCTUSD: DeployedContract | undefined;
  if (ctUsdAddress) {
    bridgeCTUSD = await createDeployTx('StablecoinBridgeCTUSD', StablecoinBridgeArtifact, [
      ctUsdAddress,
      juiceDollar.address,
      contractsParams.bridges.CT_USD.limit,
      contractsParams.bridges.CT_USD.weeks,
    ]);
  }

  // Deploy FrontendGateway
  const frontendGateway = await createDeployTx('FrontendGateway', FrontendGatewayArtifact, [juiceDollar.address]);

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
    wcbtcAddress,
  ]);

  // Deploy SavingsVaultJUSD
  const savingsVaultJUSD = await createDeployTx('SavingsVaultJUSD', SavingsVaultJUSDArtifact, [
    juiceDollar.address,
    savingsGateway.address,
    'Savings Vault JUSD', // name
    'svJUSD', // symbol
  ]);

  const deployedContracts: DeployedContracts = {
    startUSD,
    juiceDollar,
    equity,
    positionFactory,
    positionRoller,
    bridgeStartUSD,
    bridgeUSDC,
    bridgeUSDT,
    bridgeCTUSD,
    frontendGateway,
    savingsGateway,
    mintingHubGateway,
    savingsVaultJUSD,
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

  createCallTx(juiceDollar.address, JuiceDollarArtifact.abi, 'initialize', [positionRoller.address, 'PositionRoller']);

  createCallTx(juiceDollar.address, JuiceDollarArtifact.abi, 'initialize', [savingsGateway.address, 'SavingsGateway']);

  createCallTx(juiceDollar.address, JuiceDollarArtifact.abi, 'initialize', [
    frontendGateway.address,
    'FrontendGateway',
  ]);

  createCallTx(juiceDollar.address, JuiceDollarArtifact.abi, 'initialize', [
    bridgeStartUSD.address,
    'StablecoinBridgeStartUSD',
  ]);

  // Initialize USDC.e bridge as minter (if deployed)
  if (bridgeUSDC) {
    createCallTx(juiceDollar.address, JuiceDollarArtifact.abi, 'initialize', [
      bridgeUSDC.address,
      'StablecoinBridgeUSDC',
    ]);
  }

  // Initialize USDT.e bridge as minter (if deployed)
  if (bridgeUSDT) {
    createCallTx(juiceDollar.address, JuiceDollarArtifact.abi, 'initialize', [
      bridgeUSDT.address,
      'StablecoinBridgeUSDT',
    ]);
  }

  // Initialize ctUSD bridge as minter (if deployed)
  if (bridgeCTUSD) {
    createCallTx(juiceDollar.address, JuiceDollarArtifact.abi, 'initialize', [
      bridgeCTUSD.address,
      'StablecoinBridgeCTUSD',
    ]);
  }

  // Mint 2,002,000 SUSD through the StartUSD bridge
  // 1,000 first investment + 2,000,000 batch investments + 1,000 genesis position opening fee
  const totalStartUSDAmount = ethers.parseUnits('2002000', 18);
  createCallTx(startUSD.address, StartUSDArtifact.abi, 'approve', [bridgeStartUSD.address, totalStartUSDAmount]);

  createCallTx(bridgeStartUSD.address, StablecoinBridgeArtifact.abi, 'mint', [totalStartUSDAmount]);

  // Approve and invest 1000 JUSD in Equity to mint the initial 100,000,000 JUICE
  const firstInvestAmount = ethers.parseUnits('1000', 18);
  const expectedShares = ethers.parseUnits('100000000', 18);

  createCallTx(juiceDollar.address, JuiceDollarArtifact.abi, 'approve', [equity.address, firstInvestAmount]);

  createCallTx(equity.address, EquityArtifact.abi, 'invest', [firstInvestAmount, expectedShares]);

  // ============================================================================
  // EXECUTE MAIN DEPLOYMENT TRANSACTIONS
  // ============================================================================
  console.log('\n' + '═'.repeat(80));
  console.log('MAIN DEPLOYMENT EXECUTION');
  console.log('═'.repeat(80));
  console.log(`Executing ${transactionBundle.length} transactions for protocol deployment...`);
  console.log('This includes: contract deployments, initializations, and initial 1000 JUSD investment\n');

  const confirmations = isLocal ? 1 : 6;
  const mainDeploymentResponses: TransactionResponse[] = [];
  const deploymentStartTime = Date.now();

  // Execute main deployment transactions sequentially
  for (let i = 0; i < transactionBundle.length; i++) {
    const tx = transactionBundle[i];
    const signer = transactionSigners[i];

    try {
      const txResponse = await signer.sendTransaction(tx);
      mainDeploymentResponses.push(txResponse);
      console.log(`[${i + 1}/${transactionBundle.length}] ✓ TX sent: ${txResponse.hash}`);
    } catch (error: any) {
      console.error(`[${i + 1}/${transactionBundle.length}] ✗ Failed to send transaction: ${error.message}`);
      throw error;
    }
  }

  console.log(
    `\nAll ${transactionBundle.length} transactions sent in ${((Date.now() - deploymentStartTime) / 1000).toFixed(2)}s`,
  );
  console.log('Waiting for confirmations...\n');

  // Wait for all confirmations
  for (let i = 0; i < mainDeploymentResponses.length; i++) {
    try {
      const receipt = await waitForTransactionWithRetry(mainDeploymentResponses[i], confirmations, 5, 2000);
      if (!receipt || receipt.status !== 1) {
        throw new Error(`Transaction ${mainDeploymentResponses[i].hash} failed or reverted`);
      }
      console.log(
        `[${i + 1}/${mainDeploymentResponses.length}] ✓ Confirmed: ${mainDeploymentResponses[i].hash} (block ${receipt.blockNumber})`,
      );
    } catch (error: any) {
      console.error(`[${i + 1}/${mainDeploymentResponses.length}] ✗ Confirmation failed: ${error.message}`);
      throw error;
    }
  }

  console.log('\n✓ Main deployment completed successfully!\n');

  // Verify equity address matches prediction
  console.log('Verifying equity address...');
  const juiceDollarContract = new ethers.Contract(juiceDollar.address, JuiceDollarArtifact.abi, provider);
  const actualEquityAddress = await juiceDollarContract.reserve();

  if (actualEquityAddress.toLowerCase() !== equity.address.toLowerCase()) {
    throw new Error(
      `Equity address verification failed!\n` +
        `  Predicted: ${equity.address}\n` +
        `  Actual:    ${actualEquityAddress}\n` +
        `  This indicates JuiceDollar's internal nonce changed.`,
    );
  }

  console.log(`✓ Equity address verified: ${actualEquityAddress}`);

  // ============================================================================
  // POST-DEPLOYMENT VERIFICATION
  // ============================================================================
  console.log('\n' + '═'.repeat(80));
  console.log('POST-DEPLOYMENT VERIFICATION');
  console.log('═'.repeat(80));

  // Verify JuiceDollar minters are registered
  const isMinterHubMinter = await juiceDollarContract.isMinter(mintingHubGateway.address);
  const isRollerMinter = await juiceDollarContract.isMinter(positionRoller.address);
  const isSavingsMinter = await juiceDollarContract.isMinter(savingsGateway.address);
  const isFrontendMinter = await juiceDollarContract.isMinter(frontendGateway.address);
  const isBridgeMinter = await juiceDollarContract.isMinter(bridgeStartUSD.address);
  const isBridgeUSDCMinter = bridgeUSDC ? await juiceDollarContract.isMinter(bridgeUSDC.address) : true;
  const isBridgeUSDTMinter = bridgeUSDT ? await juiceDollarContract.isMinter(bridgeUSDT.address) : true;
  const isBridgeCTUSDMinter = bridgeCTUSD ? await juiceDollarContract.isMinter(bridgeCTUSD.address) : true;

  console.log(`MintingHubGateway minter: ${isMinterHubMinter ? '✓' : '✗'}`);
  console.log(`PositionRoller minter: ${isRollerMinter ? '✓' : '✗'}`);
  console.log(`SavingsGateway minter: ${isSavingsMinter ? '✓' : '✗'}`);
  console.log(`FrontendGateway minter: ${isFrontendMinter ? '✓' : '✗'}`);
  console.log(`StablecoinBridge (StartUSD) minter: ${isBridgeMinter ? '✓' : '✗'}`);
  if (bridgeUSDC) console.log(`StablecoinBridge (USDC.e) minter: ${isBridgeUSDCMinter ? '✓' : '✗'}`);
  if (bridgeUSDT) console.log(`StablecoinBridge (USDT.e) minter: ${isBridgeUSDTMinter ? '✓' : '✗'}`);
  if (bridgeCTUSD) console.log(`StablecoinBridge (ctUSD) minter: ${isBridgeCTUSDMinter ? '✓' : '✗'}`);

  if (
    !isMinterHubMinter ||
    !isRollerMinter ||
    !isSavingsMinter ||
    !isFrontendMinter ||
    !isBridgeMinter ||
    !isBridgeUSDCMinter ||
    !isBridgeUSDTMinter ||
    !isBridgeCTUSDMinter
  ) {
    throw new Error('One or more minters not properly registered in JuiceDollar');
  }

  // Verify JUSD total supply
  const jusdSupply = await juiceDollarContract.totalSupply();
  const expectedSupply = ethers.parseUnits('2002000', 18); // 2,002,000 JUSD from bridge
  console.log(
    `JUSD total supply: ${ethers.formatEther(jusdSupply)} JUSD (expected: ${ethers.formatEther(expectedSupply)})`,
  );

  if (jusdSupply !== expectedSupply) {
    throw new Error(`JUSD supply mismatch: ${jusdSupply} vs expected ${expectedSupply}`);
  }

  // Verify Equity (JUICE) supply after initial investment
  const equityContract = new ethers.Contract(equity.address, EquityArtifact.abi, provider);
  const juiceSupply = await equityContract.totalSupply();
  const expectedMinJuice = ethers.parseUnits('100000000', 18); // At least 100M from initial 1000 JUSD investment
  console.log(
    `JUICE total supply: ${ethers.formatEther(juiceSupply)} JUICE (min expected: ${ethers.formatEther(expectedMinJuice)})`,
  );

  if (juiceSupply < expectedMinJuice) {
    throw new Error(`JUICE supply too low: ${juiceSupply} vs minimum ${expectedMinJuice}`);
  }

  // Verify deployer balances
  const deployerJUSD = await juiceDollarContract.balanceOf(deployer.address);
  const deployerJUICE = await equityContract.balanceOf(deployer.address);
  console.log(`Deployer JUSD balance: ${ethers.formatEther(deployerJUSD)} JUSD`);
  console.log(`Deployer JUICE balance: ${ethers.formatEther(deployerJUICE)} JUICE`);

  // Verify FrontendGateway initialization
  const frontendContract = new ethers.Contract(frontendGateway.address, FrontendGatewayArtifact.abi, provider);
  const fgSavingsGateway = await frontendContract.SAVINGS();
  const fgMintingHubGateway = await frontendContract.MINTING_HUB();
  console.log(
    `FrontendGateway initialized: ${fgSavingsGateway === savingsGateway.address && fgMintingHubGateway === mintingHubGateway.address ? '✓' : '✗'}`,
  );

  if (fgSavingsGateway !== savingsGateway.address || fgMintingHubGateway !== mintingHubGateway.address) {
    throw new Error('FrontendGateway not properly initialized');
  }

  console.log('═'.repeat(80));
  console.log('✓ ALL VERIFICATIONS PASSED');
  console.log('═'.repeat(80) + '\n');

  // ============================================================================
  // BATCH INVESTMENTS PREPARATION
  // ============================================================================

  // Batch investments: Each batch from a separate address
  const batchCount = contractsParams.initialInvestment.batchInvestments.count;
  const batchAmount = contractsParams.initialInvestment.batchInvestments.amountPerBatch;

  // Generate batch investor wallets using HD derivation from the same mnemonic
  // Start at index 100 to avoid conflicts with standard wallet usage (indices 0-99)
  const batchInvestors: Array<{ wallet: any; nonce: number }> = [];
  console.log('\nGenerating batch investor wallets via HD derivation...');
  for (let i = 0; i < batchCount; i++) {
    const investorIndex = 100 + i;
    const derivationPath = `m/44'/60'/0'/0/${investorIndex}`;
    const investorNode = rootNode.derivePath(derivationPath);
    const investorWallet = new ethers.Wallet(investorNode.privateKey, provider);

    batchInvestors.push({ wallet: investorWallet, nonce: 0 });
    console.log(`Batch investor ${i + 1}: ${investorWallet.address} (${derivationPath})`);
  }

  // Prepare separate transaction batches for ordered execution
  type TxBatch = { tx: TransactionRequest; signer: any; label: string }[];
  const cbtcFundingBatch: TxBatch = [];
  const jusdTransferBatch: TxBatch = [];
  const approvalBatch: TxBatch = [];
  const investmentBatch: TxBatch = [];

  // Batch 1: Fund investor wallets with cBTC for gas (Citrea native token)
  console.log('\nPreparing cBTC funding transactions for batch investors...');
  // Use configured maxFeePerGas (matches transaction settings)
  const configuredMaxFee = ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei');

  for (let i = 0; i < batchCount; i++) {
    // Use actual gas limits from config (more accurate than estimates)
    const approveGasLimit = BigInt(deploymentConstants.contractCallGasLimit); // 300,000
    const investGasLimit = BigInt(deploymentConstants.investCallGasLimit); // 500,000

    // EIP-1559 max upfront cost = gasLimit × maxFeePerGas
    const totalMaxCost = (approveGasLimit + investGasLimit) * configuredMaxFee;
    const bufferMultiplier = 150n; // 50% safety buffer
    const cbtcAmount = (totalMaxCost * bufferMultiplier) / 100n;

    // Create cBTC transfer transaction (native token via value field)
    const cbtcTransferTx: TransactionRequest = {
      to: batchInvestors[i].wallet.address,
      value: cbtcAmount,
      data: '0x', // Empty data for native transfer
      gasLimit: 21000n, // Standard transfer gas
      chainId: chainId,
      type: 2, // EIP-1559
      maxFeePerGas: ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits(gasConfig.maxPriorityFeePerGas, 'gwei'),
      // nonce will be set at execution time
    };

    cbtcFundingBatch.push({
      tx: cbtcTransferTx,
      signer: deployer,
      label: `cBTC funding for investor ${i + 1}`,
    });

    console.log(`  Investor ${i + 1}: ${ethers.formatUnits(cbtcAmount, 18)} cBTC (gas funding)`);
  }

  // Batch 2: Transfer JUSD from deployer to each investor
  console.log('\nPreparing JUSD transfer transactions to batch investors...');
  for (let i = 0; i < batchCount; i++) {
    const contract = new ethers.Contract(juiceDollar.address, JuiceDollarArtifact.abi, deployer);
    const data = contract.interface.encodeFunctionData('transfer', [batchInvestors[i].wallet.address, batchAmount]);

    const jusdTransferTx: TransactionRequest = {
      to: juiceDollar.address,
      data,
      value: 0,
      gasLimit: ethers.parseUnits(deploymentConstants.contractCallGasLimit, 'wei'),
      chainId: chainId,
      type: 2,
      maxFeePerGas: ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits(gasConfig.maxPriorityFeePerGas, 'gwei'),
      // nonce will be set at execution time
    };

    jusdTransferBatch.push({
      tx: jusdTransferTx,
      signer: deployer,
      label: `JUSD transfer to investor ${i + 1}`,
    });
  }

  // Batch 3: Prepare approval transactions for batch investors
  console.log('\nPreparing approval transactions for batch investors...');
  for (let i = 0; i < batchCount; i++) {
    const investor = batchInvestors[i];
    const contract = new ethers.Contract(juiceDollar.address, JuiceDollarArtifact.abi, investor.wallet);
    const data = contract.interface.encodeFunctionData('approve', [equity.address, batchAmount]);

    const approvalTx: TransactionRequest = {
      to: juiceDollar.address,
      data,
      value: 0,
      gasLimit: ethers.parseUnits(deploymentConstants.contractCallGasLimit, 'wei'),
      chainId: chainId,
      type: 2,
      maxFeePerGas: ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits(gasConfig.maxPriorityFeePerGas, 'gwei'),
      // nonce will be set at execution time
    };

    approvalBatch.push({
      tx: approvalTx,
      signer: investor.wallet,
      label: `Approval by investor ${i + 1}`,
    });
  }

  // Batch 4: Prepare investment transactions for batch investors
  console.log('\nPreparing investment transactions for batch investors...');
  for (let i = 0; i < batchCount; i++) {
    const investor = batchInvestors[i];
    const contract = new ethers.Contract(equity.address, EquityArtifact.abi, investor.wallet);
    const data = contract.interface.encodeFunctionData('invest', [batchAmount, 0]); // 0 = no slippage protection

    const investmentTx: TransactionRequest = {
      to: equity.address,
      data,
      value: 0,
      gasLimit: ethers.parseUnits(deploymentConstants.investCallGasLimit, 'wei'),
      chainId: chainId,
      type: 2,
      maxFeePerGas: ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits(gasConfig.maxPriorityFeePerGas, 'gwei'),
      // nonce will be set at execution time
    };

    investmentBatch.push({
      tx: investmentTx,
      signer: investor.wallet,
      label: `Investment by investor ${i + 1}`,
    });
  }

  // Helper function to execute a batch of transactions with dynamic nonces and retry logic
  async function executeBatch(batch: TxBatch, batchName: string, maxRetries: number = 3): Promise<boolean> {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`${batchName} (${batch.length} transactions)`);
    console.log('═'.repeat(80));

    const confirmations = isLocal ? 1 : 6;
    const txResponses: TransactionResponse[] = [];
    const startTime = Date.now();

    // Local nonce tracker to prevent nonce collisions when multiple TXs from same signer
    const nonceTracker: Record<string, number> = {};

    // PHASE 1: Send all transactions sequentially (no waiting for confirmations between sends)
    for (let i = 0; i < batch.length; i++) {
      const { tx, signer, label } = batch[i];

      // Initialize nonce for this signer on first use
      const signerAddress = await signer.getAddress();
      if (nonceTracker[signerAddress] === undefined) {
        nonceTracker[signerAddress] = await provider.getTransactionCount(signerAddress, 'latest');
      }

      // Assign nonce and increment locally
      tx.nonce = nonceTracker[signerAddress]++;
      console.log(`[${i + 1}/${batch.length}] Nonce ${tx.nonce} for ${signerAddress.slice(0, 8)}...`);

      // Send transaction with retry logic
      let attempt = 0;
      let txResponse: TransactionResponse | null = null;

      while (attempt < maxRetries && !txResponse) {
        try {
          const response = await signer.sendTransaction(tx);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
          console.log(`[${i + 1}/${batch.length}] ✓ ${label}: ${response.hash} (${elapsed}s elapsed)`);
          txResponse = response;
        } catch (error: any) {
          attempt++;
          if (attempt >= maxRetries) {
            console.error(
              `[${i + 1}/${batch.length}] ✗ ${label}: Failed after ${maxRetries} attempts - ${error.message}`,
            );
            return false;
          }
          console.warn(`[${i + 1}/${batch.length}] ⚠ ${label}: Retry ${attempt}/${maxRetries} - ${error.message}`);
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
        }
      }

      if (!txResponse) {
        console.error(`[${i + 1}/${batch.length}] ✗ ${label}: Failed to send transaction`);
        return false;
      }

      txResponses.push(txResponse);
    }

    console.log(
      `\n${batchName}: Phase 1 complete - all ${batch.length} transactions submitted in ${((Date.now() - startTime) / 1000).toFixed(2)}s`,
    );
    console.log(`${batchName}: Phase 2 starting - waiting for confirmations...\n`);

    // PHASE 2: Wait for all confirmations in this batch
    const receipts: (TransactionReceipt | null)[] = [];
    for (let i = 0; i < txResponses.length; i++) {
      try {
        const receipt = await waitForTransactionWithRetry(txResponses[i], confirmations, 5, 2000);
        if (receipt && receipt.status === 1) {
          console.log(
            `[${i + 1}/${txResponses.length}] ✓ Confirmed: ${txResponses[i].hash} (block ${receipt.blockNumber})`,
          );
          receipts.push(receipt);
        } else {
          console.error(`[${i + 1}/${txResponses.length}] ✗ Reverted: ${txResponses[i].hash}`);
          receipts.push(null);
        }
      } catch (error: any) {
        console.error(
          `[${i + 1}/${txResponses.length}] ✗ Confirmation error: ${txResponses[i].hash} - ${error.message}`,
        );
        receipts.push(null);
      }
    }

    const failedCount = receipts.filter((r) => r === null).length;
    if (failedCount > 0) {
      console.error(`\n${batchName}: ${failedCount} transaction(s) failed`);
      return false;
    }

    console.log(`\n${batchName}: All ${batch.length} transactions confirmed successfully!\n`);
    return true;
  }

  // Execute batches in order with proper dependency management
  console.log('\n' + '═'.repeat(80));
  console.log('BATCHED DEPLOYMENT EXECUTION');
  console.log('═'.repeat(80));
  console.log('NOTE: Transactions will be executed in 4 batches to ensure proper dependencies.');
  console.log('SECURITY: Use a fresh, unknown deployer address to minimize front-running risk.');

  let deploymentSuccessful = false;

  try {
    // Batch 1: cBTC funding (must complete before JUSD transfers)
    if (batchCount > 0 && cbtcFundingBatch.length > 0) {
      const success = await executeBatch(cbtcFundingBatch, 'BATCH 1: cBTC Funding');
      if (!success) {
        console.error('Failed at cBTC funding batch. Exiting...');
        process.exit(1);
      }
    }

    // Batch 2: JUSD transfers (must complete before approvals)
    if (batchCount > 0 && jusdTransferBatch.length > 0) {
      const success = await executeBatch(jusdTransferBatch, 'BATCH 2: JUSD Transfers');
      if (!success) {
        console.error('Failed at JUSD transfer batch. Exiting...');
        process.exit(1);
      }
    }

    // Batch 3: Approvals (must complete before investments)
    if (batchCount > 0 && approvalBatch.length > 0) {
      const success = await executeBatch(approvalBatch, 'BATCH 3: JUSD Approvals');
      if (!success) {
        console.error('Failed at approval batch. Exiting...');
        process.exit(1);
      }
    }

    // Batch 4: Investments
    if (batchCount > 0 && investmentBatch.length > 0) {
      const success = await executeBatch(investmentBatch, 'BATCH 4: Equity Investments');
      if (!success) {
        console.error('Failed at investment batch. Exiting...');
        process.exit(1);
      }
    }

    console.log('\n' + '═'.repeat(80));
    console.log('ALL BATCHES COMPLETED SUCCESSFULLY!');
    console.log('═'.repeat(80) + '\n');
    deploymentSuccessful = true;
  } catch (error) {
    console.error('\nError during batched deployment:', error);
    deploymentSuccessful = false;
  }

  if (!deploymentSuccessful) {
    console.error('Failed to deploy protocol. Exiting...');
    process.exit(1);
  }

  // ============================================================================
  // GENESIS POSITION CREATION
  // ============================================================================
  // Create a genesis position that can be cloned via CoinLendingGateway.lendWithCoin()
  // This enables users to open positions without paying the 1000 JUSD opening fee
  console.log('\n' + '═'.repeat(80));
  console.log('GENESIS POSITION CREATION');
  console.log('═'.repeat(80));

  const genesisParams = contractsParams.genesisPosition;
  const openingFee = ethers.parseUnits('1000', 18); // 1000 JUSD opening fee

  // Check deployer has enough JUSD for opening fee
  const jusdContract = new ethers.Contract(juiceDollar.address, JuiceDollarArtifact.abi, deployer);
  const deployerJusdBalance = await jusdContract.balanceOf(deployer.address);
  console.log(`Deployer JUSD balance: ${ethers.formatEther(deployerJusdBalance)} JUSD`);
  console.log(`Opening fee required: ${ethers.formatEther(openingFee)} JUSD`);

  if (deployerJusdBalance < openingFee) {
    console.error('Insufficient JUSD for genesis position opening fee. Skipping genesis position creation.');
  } else {
    // Check deployer has enough cBTC for collateral
    const deployerCbtcBalance = await provider.getBalance(deployer.address);
    const collateralAmount = BigInt(genesisParams.initialCollateral);
    console.log(`Deployer cBTC balance: ${ethers.formatEther(deployerCbtcBalance)} cBTC`);
    console.log(`Collateral required: ${ethers.formatEther(collateralAmount)} cBTC`);

    if (deployerCbtcBalance < collateralAmount) {
      console.error('Insufficient cBTC for genesis position collateral. Skipping genesis position creation.');
    } else {
      console.log('\nCreating genesis position...');

      // WcBTC interface for wrapping
      const wcbtcAbi = [
        'function deposit() external payable',
        'function approve(address spender, uint256 amount) external returns (bool)',
        'function balanceOf(address account) external view returns (uint256)',
      ];
      const wcbtcContract = new ethers.Contract(wcbtcAddress, wcbtcAbi, deployer);

      // Get current nonce
      let genesisNonce = await provider.getTransactionCount(deployer.address, 'latest');

      // Step 1: Wrap cBTC to WcBTC
      console.log('Step 1: Wrapping cBTC to WcBTC...');
      const wrapTx = await deployer.sendTransaction({
        to: wcbtcAddress,
        value: collateralAmount,
        data: wcbtcContract.interface.encodeFunctionData('deposit'),
        gasLimit: ethers.parseUnits(deploymentConstants.contractCallGasLimit, 'wei'),
        maxFeePerGas: ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits(gasConfig.maxPriorityFeePerGas, 'gwei'),
        nonce: genesisNonce++,
      });
      const wrapReceipt = await waitForTransactionWithRetry(wrapTx, confirmations, 5, 2000);
      if (!wrapReceipt || wrapReceipt.status !== 1) {
        throw new Error('Failed to wrap cBTC to WcBTC');
      }
      console.log(`  ✓ Wrapped ${ethers.formatEther(collateralAmount)} cBTC to WcBTC`);

      // Step 2: Approve WcBTC for MintingHubGateway
      console.log('Step 2: Approving WcBTC for MintingHubGateway...');
      const approveWcbtcTx = await deployer.sendTransaction({
        to: wcbtcAddress,
        data: wcbtcContract.interface.encodeFunctionData('approve', [mintingHubGateway.address, collateralAmount]),
        gasLimit: ethers.parseUnits(deploymentConstants.contractCallGasLimit, 'wei'),
        maxFeePerGas: ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits(gasConfig.maxPriorityFeePerGas, 'gwei'),
        nonce: genesisNonce++,
      });
      const approveWcbtcReceipt = await waitForTransactionWithRetry(approveWcbtcTx, confirmations, 5, 2000);
      if (!approveWcbtcReceipt || approveWcbtcReceipt.status !== 1) {
        throw new Error('Failed to approve WcBTC');
      }
      console.log('  ✓ WcBTC approved for MintingHubGateway');

      // Step 3: Approve JUSD for opening fee
      console.log('Step 3: Approving JUSD for opening fee...');
      const approveJusdTx = await deployer.sendTransaction({
        to: juiceDollar.address,
        data: jusdContract.interface.encodeFunctionData('approve', [mintingHubGateway.address, openingFee]),
        gasLimit: ethers.parseUnits(deploymentConstants.contractCallGasLimit, 'wei'),
        maxFeePerGas: ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits(gasConfig.maxPriorityFeePerGas, 'gwei'),
        nonce: genesisNonce++,
      });
      const approveJusdReceipt = await waitForTransactionWithRetry(approveJusdTx, confirmations, 5, 2000);
      if (!approveJusdReceipt || approveJusdReceipt.status !== 1) {
        throw new Error('Failed to approve JUSD');
      }
      console.log('  ✓ JUSD approved for opening fee');

      // Step 4: Open genesis position
      console.log('Step 4: Opening genesis position...');
      const mintingHubContract = new ethers.Contract(
        mintingHubGateway.address,
        MintingHubGatewayArtifact.abi,
        deployer,
      );
      const frontendCode = ethers.ZeroHash; // No frontend code

      const openPositionTx = await deployer.sendTransaction({
        to: mintingHubGateway.address,
        data: mintingHubContract.interface.encodeFunctionData(
          'openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24,bytes32)',
          [
            wcbtcAddress, // collateral address
            genesisParams.minCollateral, // min collateral
            genesisParams.initialCollateral, // initial collateral
            genesisParams.mintingMaximum, // minting maximum
            genesisParams.initPeriodSeconds, // init period
            genesisParams.expirationSeconds, // expiration
            genesisParams.challengeSeconds, // challenge period
            genesisParams.riskPremiumPPM, // risk premium
            genesisParams.liquidationPrice, // liquidation price
            genesisParams.reservePPM, // reserve PPM
            frontendCode, // frontend code
          ],
        ),
        gasLimit: ethers.parseUnits(deploymentConstants.openPositionGasLimit, 'wei'),
        maxFeePerGas: ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits(gasConfig.maxPriorityFeePerGas, 'gwei'),
        nonce: genesisNonce++,
      });

      const openPositionReceipt = await waitForTransactionWithRetry(openPositionTx, confirmations, 5, 2000);
      if (!openPositionReceipt || openPositionReceipt.status !== 1) {
        throw new Error('Failed to open genesis position');
      }

      // Extract position address from PositionOpened event
      // Event: PositionOpened(address indexed owner, address indexed position, address original, address collateral)
      const positionOpenedTopic = ethers.id('PositionOpened(address,address,address,address)');
      const positionLog = openPositionReceipt.logs.find((log) => log.topics[0] === positionOpenedTopic);

      if (positionLog) {
        const genesisPositionAddress = ethers.getAddress('0x' + positionLog.topics[2].slice(26));
        console.log(`  ✓ Genesis position created at: ${genesisPositionAddress}`);

        // Add to deployed contracts
        deployedContracts.genesisPosition = {
          address: genesisPositionAddress,
          constructorArgs: [
            deployer.address, // owner
            mintingHubGateway.address, // hub
            juiceDollar.address, // jusd
            wcbtcAddress, // collateral
            genesisParams.minCollateral,
            genesisParams.mintingMaximum,
            genesisParams.initPeriodSeconds,
            genesisParams.expirationSeconds,
            genesisParams.challengeSeconds,
            genesisParams.riskPremiumPPM,
            genesisParams.liquidationPrice,
            genesisParams.reservePPM,
          ],
        };

        // Step 5: Mint initial JUSD loan on the genesis position
        console.log('Step 5: Minting initial JUSD loan...');
        const positionContract = new ethers.Contract(genesisPositionAddress, PositionArtifact.abi, deployer);
        const mintAmount = BigInt(genesisParams.initialMintAmount);

        const mintTx = await deployer.sendTransaction({
          to: genesisPositionAddress,
          data: positionContract.interface.encodeFunctionData('mint', [deployer.address, mintAmount]),
          gasLimit: ethers.parseUnits(deploymentConstants.contractCallGasLimit, 'wei'),
          maxFeePerGas: ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei'),
          maxPriorityFeePerGas: ethers.parseUnits(gasConfig.maxPriorityFeePerGas, 'gwei'),
          nonce: genesisNonce++,
        });

        const mintReceipt = await waitForTransactionWithRetry(mintTx, confirmations, 5, 2000);
        if (!mintReceipt || mintReceipt.status !== 1) {
          throw new Error('Failed to mint initial JUSD loan on genesis position');
        }
        console.log(`  ✓ Minted ${ethers.formatEther(mintAmount)} JUSD loan on genesis position`);

        console.log('\n  Genesis Position Details:');
        console.log(`    Address: ${genesisPositionAddress}`);
        console.log(`    Collateral: ${ethers.formatEther(genesisParams.initialCollateral)} WcBTC`);
        console.log(`    Liquidation Price: ${ethers.formatEther(genesisParams.liquidationPrice)} JUSD/cBTC`);
        console.log(`    Minting Maximum: ${ethers.formatEther(genesisParams.mintingMaximum)} JUSD`);
        console.log(`    Initial Loan: ${ethers.formatEther(mintAmount)} JUSD`);
        console.log(`    Expiration: ${genesisParams.expirationSeconds / 86400} days`);
      } else {
        console.error('  ✗ Could not extract genesis position address from logs');
      }

      console.log('\n' + '═'.repeat(80));
      console.log('GENESIS POSITION CREATED SUCCESSFULLY!');
      console.log('═'.repeat(80) + '\n');
    }
  }

  const networkFolder = hre.network.name === 'hardhat' ? 'localhost' : hre.network.name;

  const deploymentInfo = {
    schemaVersion: '1.0',
    network: {
      name: hre.network.name,
      chainId: Number(chainId),
    },
    deployment: {
      deployedAt: new Date().toISOString(),
      deployedBy: deployer.address,
      blockNumber: targetBlock,
    },
    contracts: deployedContracts,
    batchInvestors: batchInvestors.map((investor, index) => ({
      index: index + 1,
      address: investor.wallet.address,
      investmentAmount: ethers.formatUnits(batchAmount, 18) + ' JUSD',
    })),
    metadata: {
      deployer: 'JuiceDollar/smartContracts',
      deploymentMethod: 'rapid-sequential',
      scriptVersion: '1.0.0',
      batchInvestmentStrategy: 'separate-addresses',
    },
  };

  const deploymentDir = path.join(__dirname, '../../../deployments', networkFolder);
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  const filename = 'protocol.json';
  fs.writeFileSync(path.join(deploymentDir, filename), JSON.stringify(deploymentInfo, null, 2));
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
