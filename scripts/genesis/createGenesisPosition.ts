import fs from 'fs';
import path from 'path';
import { ethers } from 'hardhat';
import hre from 'hardhat';
import { TransactionResponse, TransactionReceipt } from 'ethers';
import { getGasConfig, deploymentConstants, contractsParams } from '../deployment/config/deploymentConfig';
import { ADDRESSES } from '../../constants/addresses';

// ============================================================================
// Types
// ============================================================================
interface ProtocolJson {
  contracts: {
    mintingHubGateway: { address: string };
    juiceDollar: { address: string };
    equity: { address: string };
  };
  genesisPosition?: {
    address: string;
    [key: string]: any;
  };
}

// ============================================================================
// ABIs (minimal interfaces needed)
// ============================================================================
const JUSD_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

const WCBTC_ABI = [
  'function deposit() external payable',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
];

const MINTING_HUB_GATEWAY_ABI = [
  `function openPosition(
    address _collateralAddress,
    uint256 _minCollateral,
    uint256 _initialCollateral,
    uint256 _mintingMaximum,
    uint40 _initPeriodSeconds,
    uint40 _expirationSeconds,
    uint40 _challengeSeconds,
    uint24 _riskPremium,
    uint256 _liqPrice,
    uint24 _reservePPM,
    bytes32 _frontendCode
  ) external payable returns (address)`,
  'event PositionOpened(address indexed owner, address indexed position, address original, address collateral)',
];

const POSITION_ABI = [
  'function mint(address target, uint256 amount) external',
  'function principal() external view returns (uint256)',
  'function collateral() external view returns (address)',
  'function owner() external view returns (address)',
  'function start() external view returns (uint40)',
  'function cooldown() external view returns (uint40)',
];

// ============================================================================
// Retry Logic (same as deployProtocol.ts)
// ============================================================================
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

  // Fallback: query receipt manually
  console.warn(`.wait() failed after ${maxRetries} attempts, querying receipt manually...`);
  try {
    const receipt = await txResponse.provider!.getTransactionReceipt(txResponse.hash);
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

// ============================================================================
// Pre-flight Checks
// ============================================================================
async function preflightChecks(
  signer: any,
  deployerAddress: string,
  protocolData: ProtocolJson,
  wcbtcAddress: string,
  collateralAmount: bigint,
  openingFee: bigint
): Promise<void> {
  console.log('\n--- Pre-flight Checks ---\n');

  // 1. Check if genesis position already exists in protocol.json
  if (protocolData.genesisPosition?.address) {
    throw new Error(`Genesis position already exists at ${protocolData.genesisPosition.address}. Aborting.`);
  }
  console.log('  [OK] Genesis position not yet created');

  // 2. Verify MintingHubGateway is deployed
  const mintingHubCode = await signer.provider.getCode(protocolData.contracts.mintingHubGateway.address);
  if (mintingHubCode === '0x') {
    throw new Error(`MintingHubGateway not deployed at ${protocolData.contracts.mintingHubGateway.address}`);
  }
  console.log('  [OK] MintingHubGateway deployed');

  // 3. Check JUSD balance (need >= 1000 JUSD for opening fee)
  const jusd = new ethers.Contract(protocolData.contracts.juiceDollar.address, JUSD_ABI, signer);
  const jusdBalance = await jusd.balanceOf(deployerAddress);
  if (jusdBalance < openingFee) {
    throw new Error(
      `Insufficient JUSD balance. Need ${ethers.formatEther(openingFee)} JUSD, have ${ethers.formatEther(jusdBalance)} JUSD`
    );
  }
  console.log(`  [OK] JUSD balance: ${ethers.formatEther(jusdBalance)} JUSD`);

  // 4. Check cBTC balance (need >= collateral + gas buffer)
  const cbtcBalance = await signer.provider.getBalance(deployerAddress);
  const requiredCbtc = collateralAmount + ethers.parseEther('0.0002'); // small gas buffer
  if (cbtcBalance < requiredCbtc) {
    throw new Error(
      `Insufficient cBTC balance. Need ~${ethers.formatEther(requiredCbtc)} cBTC, have ${ethers.formatEther(cbtcBalance)} cBTC`
    );
  }
  console.log(`  [OK] cBTC balance: ${ethers.formatEther(cbtcBalance)} cBTC`);

  console.log('\nAll pre-flight checks passed!\n');
}

// ============================================================================
// Main Script
// ============================================================================
async function main() {
  console.log('\n=== JuiceDollar Genesis Position Creation ===\n');

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const provider = ethers.provider;

  const networkInfo = await provider.getNetwork();
  const networkName = hre.network.name;
  const chainId = Number(networkInfo.chainId);
  const isLocal = networkName === 'hardhat' || networkName === 'localhost';
  const isForkNetwork = process.env.FORK_MAINNET === 'true' || process.env.FORK_TESTNET === 'true';

  console.log(`Deployer: ${deployerAddress}`);
  console.log(`Network: ${networkName}`);
  console.log(`Chain ID: ${chainId}`);
  console.log(`Mode: ${isLocal ? (isForkNetwork ? 'FORK' : 'LOCAL') : 'MAINNET'}\n`);

  // Setup paths - when forking, use the forked network's deployment folder
  const networkFolder = isForkNetwork ? (process.env.FORK_MAINNET ? 'citrea' : 'citreaTestnet') : networkName;
  const deploymentDir = path.join(__dirname, '..', '..', 'deployments', networkFolder);
  const protocolFilePath = path.join(deploymentDir, 'protocol.json');

  // ============================================================================
  // Load protocol.json (REQUIRED)
  // ============================================================================
  if (!fs.existsSync(protocolFilePath)) {
    throw new Error(`protocol.json not found at ${protocolFilePath}. Deploy the protocol first.`);
  }

  const protocolData: ProtocolJson = JSON.parse(fs.readFileSync(protocolFilePath, 'utf8'));
  console.log(`Loaded protocol.json from: ${protocolFilePath}`);

  // Get contract addresses from protocol.json
  const mintingHubGatewayAddress = protocolData.contracts.mintingHubGateway.address;
  const juiceDollarAddress = protocolData.contracts.juiceDollar.address;

  // Get WcBTC address from ADDRESSES constant (same as deployProtocol.ts)
  // For forks, use the mainnet/testnet chainId for address lookup
  const addressChainId = isForkNetwork ? (process.env.FORK_MAINNET ? 4114 : 5115) : chainId;
  const wcbtcAddress = ADDRESSES[addressChainId]?.WCBTC;
  if (!wcbtcAddress) {
    throw new Error(`WcBTC address not found for chainId ${addressChainId}`);
  }

  console.log(`MintingHubGateway: ${mintingHubGatewayAddress}`);
  console.log(`JuiceDollar: ${juiceDollarAddress}`);
  console.log(`WcBTC: ${wcbtcAddress}\n`);

  // Get genesis position params from deploymentConfig.ts
  const genesisParams = contractsParams.genesisPosition;
  const collateralAmount = BigInt(genesisParams.initialCollateral);
  const openingFee = ethers.parseUnits('1000', 18); // 1000 JUSD opening fee

  // Get gas config from deploymentConfig.ts
  const gasConfig = getGasConfig(networkName);

  // Run pre-flight checks
  await preflightChecks(deployer, deployerAddress, protocolData, wcbtcAddress, collateralAmount, openingFee);

  const confirmations = isLocal ? 1 : 6;

  // Get current nonce
  let currentNonce = await provider.getTransactionCount(deployerAddress, 'latest');

  // ============================================================================
  // Step 1: Wrap cBTC to WcBTC (same as deployProtocol.ts lines 929-943)
  // ============================================================================
  console.log('--- Step 1: Wrap cBTC to WcBTC ---\n');

  const wcbtcContract = new ethers.Contract(wcbtcAddress, WCBTC_ABI, deployer);

  console.log(`  Wrapping ${ethers.formatEther(collateralAmount)} cBTC to WcBTC...`);

  const wrapTx = await deployer.sendTransaction({
    to: wcbtcAddress,
    value: collateralAmount,
    data: wcbtcContract.interface.encodeFunctionData('deposit'),
    gasLimit: ethers.parseUnits(deploymentConstants.contractCallGasLimit, 'wei'),
    maxFeePerGas: ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits(gasConfig.maxPriorityFeePerGas, 'gwei'),
    nonce: currentNonce++,
  });
  console.log(`  TX Hash: ${wrapTx.hash}`);

  const wrapReceipt = await waitForTransactionWithRetry(wrapTx, confirmations, 5, 2000);
  if (!wrapReceipt || wrapReceipt.status !== 1) {
    throw new Error('Failed to wrap cBTC to WcBTC');
  }
  console.log(`  [OK] Wrapped ${ethers.formatEther(collateralAmount)} cBTC to WcBTC\n`);

  // ============================================================================
  // Step 2: Approve WcBTC for MintingHubGateway (same as deployProtocol.ts lines 946-959)
  // ============================================================================
  console.log('--- Step 2: Approve WcBTC for MintingHubGateway ---\n');

  console.log(`  Approving ${ethers.formatEther(collateralAmount)} WcBTC...`);

  const approveWcbtcTx = await deployer.sendTransaction({
    to: wcbtcAddress,
    data: wcbtcContract.interface.encodeFunctionData('approve', [mintingHubGatewayAddress, collateralAmount]),
    gasLimit: ethers.parseUnits(deploymentConstants.contractCallGasLimit, 'wei'),
    maxFeePerGas: ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits(gasConfig.maxPriorityFeePerGas, 'gwei'),
    nonce: currentNonce++,
  });
  console.log(`  TX Hash: ${approveWcbtcTx.hash}`);

  const approveWcbtcReceipt = await waitForTransactionWithRetry(approveWcbtcTx, confirmations, 5, 2000);
  if (!approveWcbtcReceipt || approveWcbtcReceipt.status !== 1) {
    throw new Error('Failed to approve WcBTC');
  }
  console.log('  [OK] WcBTC approved for MintingHubGateway\n');

  // ============================================================================
  // Step 3: Approve JUSD for Opening Fee (same as deployProtocol.ts lines 962-975)
  // ============================================================================
  console.log('--- Step 3: Approve JUSD for Opening Fee ---\n');

  const jusd = new ethers.Contract(juiceDollarAddress, JUSD_ABI, deployer);

  console.log(`  Approving ${ethers.formatEther(openingFee)} JUSD...`);

  const approveJusdTx = await deployer.sendTransaction({
    to: juiceDollarAddress,
    data: jusd.interface.encodeFunctionData('approve', [mintingHubGatewayAddress, openingFee]),
    gasLimit: ethers.parseUnits(deploymentConstants.contractCallGasLimit, 'wei'),
    maxFeePerGas: ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits(gasConfig.maxPriorityFeePerGas, 'gwei'),
    nonce: currentNonce++,
  });
  console.log(`  TX Hash: ${approveJusdTx.hash}`);

  const approveJusdReceipt = await waitForTransactionWithRetry(approveJusdTx, confirmations, 5, 2000);
  if (!approveJusdReceipt || approveJusdReceipt.status !== 1) {
    throw new Error('Failed to approve JUSD');
  }
  console.log('  [OK] JUSD approved for opening fee\n');

  // ============================================================================
  // Step 4: Open Genesis Position (same as deployProtocol.ts lines 978-1013)
  // ============================================================================
  console.log('--- Step 4: Open Genesis Position ---\n');

  const mintingHub = new ethers.Contract(mintingHubGatewayAddress, MINTING_HUB_GATEWAY_ABI, deployer);
  const frontendCode = ethers.ZeroHash; // No frontend code

  console.log('  Position Parameters:');
  console.log(`    Collateral: WcBTC (${wcbtcAddress})`);
  console.log(`    Min Collateral: ${ethers.formatEther(genesisParams.minCollateral)} cBTC`);
  console.log(`    Initial Collateral: ${ethers.formatEther(genesisParams.initialCollateral)} cBTC`);
  console.log(`    Minting Maximum: ${ethers.formatEther(genesisParams.mintingMaximum)} JUSD`);
  console.log(`    Init Period: ${genesisParams.initPeriodSeconds} seconds`);
  console.log(`    Expiration: ${genesisParams.expirationSeconds} seconds (${genesisParams.expirationSeconds / 86400} days)`);
  console.log(`    Challenge Period: ${genesisParams.challengeSeconds} seconds (${genesisParams.challengeSeconds / 86400} days)`);
  console.log(`    Risk Premium: ${genesisParams.riskPremiumPPM} ppm`);
  console.log(`    Liquidation Price: ${ethers.formatEther(genesisParams.liquidationPrice)} JUSD/cBTC`);
  console.log(`    Reserve: ${genesisParams.reservePPM / 10000}%\n`);

  const openPositionTx = await deployer.sendTransaction({
    to: mintingHubGatewayAddress,
    data: mintingHub.interface.encodeFunctionData(
      'openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24,bytes32)',
      [
        wcbtcAddress,                          // collateral address
        genesisParams.minCollateral,           // min collateral
        genesisParams.initialCollateral,       // initial collateral
        genesisParams.mintingMaximum,          // minting maximum
        genesisParams.initPeriodSeconds,       // init period
        genesisParams.expirationSeconds,       // expiration
        genesisParams.challengeSeconds,        // challenge period
        genesisParams.riskPremiumPPM,          // risk premium
        genesisParams.liquidationPrice,        // liquidation price
        genesisParams.reservePPM,              // reserve PPM
        frontendCode,                          // frontend code
      ]
    ),
    gasLimit: ethers.parseUnits(deploymentConstants.openPositionGasLimit, 'wei'),
    maxFeePerGas: ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits(gasConfig.maxPriorityFeePerGas, 'gwei'),
    nonce: currentNonce++,
  });

  console.log(`  TX Hash: ${openPositionTx.hash}`);
  console.log('  Waiting for confirmation...');

  const openPositionReceipt = await waitForTransactionWithRetry(openPositionTx, confirmations, 5, 2000);
  if (!openPositionReceipt || openPositionReceipt.status !== 1) {
    throw new Error('Failed to open genesis position');
  }

  // Extract position address from PositionOpened event
  const positionOpenedTopic = ethers.id('PositionOpened(address,address,address,address)');
  const positionOpenedLog = openPositionReceipt.logs.find((log: any) => log.topics[0] === positionOpenedTopic);

  if (!positionOpenedLog) {
    throw new Error('PositionOpened event not found in transaction receipt. Position creation may have failed.');
  }

  // Position address is the second indexed parameter (topics[2])
  const positionAddress = ethers.getAddress('0x' + positionOpenedLog.topics[2].slice(26));
  console.log(`  [OK] Genesis Position created at: ${positionAddress}\n`);

  // ============================================================================
  // Step 5: Wait for Init Period (same as deployProtocol.ts lines 1043-1055)
  // ============================================================================
  console.log('--- Step 5: Wait for Init Period ---\n');

  const position = new ethers.Contract(positionAddress, POSITION_ABI, deployer);
  const positionStart = await position.start();
  const cooldown = await position.cooldown();

  console.log(`  Position start: ${positionStart}`);
  console.log(`  Cooldown ends: ${cooldown}`);

  // On hardhat/localhost/fork networks, use evm_increaseTime
  // On live networks, real-time waiting works as new blocks have updated timestamps
  const canManipulateTime = isLocal || isForkNetwork;

  if (canManipulateTime) {
    console.log(`  Advancing EVM time by ${genesisParams.initPeriodSeconds + 1} seconds...`);
    await hre.network.provider.send('evm_increaseTime', [genesisParams.initPeriodSeconds + 1]);
    await hre.network.provider.send('evm_mine', []);
    console.log('  [OK] Time advanced\n');
  } else {
    const currentBlock = await provider.getBlock('latest');
    const currentTime = BigInt(currentBlock!.timestamp);
    const waitTime = cooldown - currentTime;

    if (waitTime > 0n) {
      console.log(`  Waiting ${waitTime} seconds for init period to pass...`);
      await new Promise(resolve => setTimeout(resolve, (Number(waitTime) + 5) * 1000));
      console.log('  [OK] Init period passed\n');
    } else {
      console.log('  [OK] Init period already passed\n');
    }
  }

  // ============================================================================
  // Step 6: Mint Initial Loan (same as deployProtocol.ts lines 1058-1075)
  // ============================================================================
  console.log('--- Step 6: Mint Initial Loan ---\n');

  const mintAmount = BigInt(genesisParams.initialMintAmount);
  console.log(`  Minting ${ethers.formatEther(mintAmount)} JUSD...`);

  const mintTx = await deployer.sendTransaction({
    to: positionAddress,
    data: position.interface.encodeFunctionData('mint', [deployerAddress, mintAmount]),
    gasLimit: ethers.parseUnits(deploymentConstants.contractCallGasLimit, 'wei'),
    maxFeePerGas: ethers.parseUnits(gasConfig.maxFeePerGas, 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits(gasConfig.maxPriorityFeePerGas, 'gwei'),
    nonce: currentNonce++,
  });
  console.log(`  TX Hash: ${mintTx.hash}`);

  const mintReceipt = await waitForTransactionWithRetry(mintTx, confirmations, 5, 2000);
  if (!mintReceipt || mintReceipt.status !== 1) {
    throw new Error('Failed to mint initial JUSD loan on genesis position');
  }
  console.log(`  [OK] Minted ${ethers.formatEther(mintAmount)} JUSD loan on genesis position\n`);

  // ============================================================================
  // Step 7: Verify & Save to protocol.json
  // ============================================================================
  console.log('--- Step 7: Verify & Save ---\n');

  // Verify position state
  const positionOwner = await position.owner();
  const positionCollateral = await position.collateral();
  const positionPrincipal = await position.principal();

  console.log('  Position Verification:');
  console.log(`    Owner: ${positionOwner}`);
  console.log(`    Expected Owner: ${deployerAddress}`);
  console.log(`    Owner Match: ${positionOwner.toLowerCase() === deployerAddress.toLowerCase() ? 'YES' : 'NO'}`);
  console.log(`    Collateral Token: ${positionCollateral}`);
  console.log(`    Expected Collateral: ${wcbtcAddress}`);
  console.log(`    Collateral Match: ${positionCollateral.toLowerCase() === wcbtcAddress.toLowerCase() ? 'YES' : 'NO'}`);
  console.log(`    Principal: ${ethers.formatEther(positionPrincipal)} JUSD`);
  console.log(`    Expected Principal: >= ${ethers.formatEther(mintAmount)} JUSD`);
  console.log(`    Principal Valid: ${positionPrincipal >= mintAmount ? 'YES' : 'NO'}\n`);

  // Validate
  if (positionOwner.toLowerCase() !== deployerAddress.toLowerCase()) {
    throw new Error(`Position owner mismatch: expected ${deployerAddress}, got ${positionOwner}`);
  }
  if (positionCollateral.toLowerCase() !== wcbtcAddress.toLowerCase()) {
    throw new Error(`Position collateral mismatch: expected ${wcbtcAddress}, got ${positionCollateral}`);
  }
  if (positionPrincipal < mintAmount) {
    throw new Error(
      `Position principal too low: expected >= ${ethers.formatEther(mintAmount)}, got ${ethers.formatEther(positionPrincipal)}`
    );
  }

  // Update protocol.json with genesis position data
  protocolData.genesisPosition = {
    address: positionAddress,
    constructorArgs: [
      deployerAddress,                       // owner
      mintingHubGatewayAddress,              // hub
      juiceDollarAddress,                    // jusd
      wcbtcAddress,                          // collateral
      genesisParams.minCollateral,
      genesisParams.mintingMaximum,
      genesisParams.initPeriodSeconds,
      genesisParams.expirationSeconds,
      genesisParams.challengeSeconds,
      genesisParams.riskPremiumPPM,
      genesisParams.liquidationPrice,
      genesisParams.reservePPM,
    ],
    owner: deployerAddress,
    collateral: wcbtcAddress,
    initialCollateral: genesisParams.initialCollateral,
    initialMint: genesisParams.initialMintAmount,
    liquidationPrice: genesisParams.liquidationPrice,
    expirationSeconds: genesisParams.expirationSeconds,
    openPositionTxHash: openPositionTx.hash,
    mintTxHash: mintTx.hash,
    createdAt: new Date().toISOString(),
    createdAtBlock: openPositionReceipt.blockNumber,
  };

  fs.writeFileSync(protocolFilePath, JSON.stringify(protocolData, null, 2));
  console.log(`  [OK] Protocol data saved to: ${protocolFilePath}\n`);

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('=== Genesis Position Created Successfully! ===\n');
  console.log('  Genesis Position Details:');
  console.log(`    Address: ${positionAddress}`);
  console.log(`    Owner: ${deployerAddress}`);
  console.log(`    Collateral: ${ethers.formatEther(genesisParams.initialCollateral)} WcBTC`);
  console.log(`    Liquidation Price: ${ethers.formatEther(genesisParams.liquidationPrice)} JUSD/cBTC`);
  console.log(`    Minting Maximum: ${ethers.formatEther(genesisParams.mintingMaximum)} JUSD`);
  console.log(`    Initial Loan: ${ethers.formatEther(mintAmount)} JUSD`);
  console.log(`    Expiration: ${genesisParams.expirationSeconds / 86400} days`);
  console.log(`    Opening Fee Paid: ${ethers.formatEther(openingFee)} JUSD`);
  console.log(`\n  Protocol file: ${protocolFilePath}`);
  console.log('\n');
}

// Execute
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n=== Genesis Position Creation Failed! ===\n');
    console.error(error);
    process.exit(1);
  });
