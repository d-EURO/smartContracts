import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import {
  JuiceDollar,
  Position,
  Equity,
  ERC20,
  FrontendGateway,
  MintingHubGateway,
  PositionFactory,
  PositionRoller,
  SavingsGateway,
  StablecoinBridge,
} from '../../typechain';
import { citrea } from '../../constants/addresses';
import JUICESWAP_V3_ROUTER from '../../constants/abi/UniswapV3Router.json'; // Using UniswapV3-compatible ABI for JuiceSwap
import JUICESWAP_V3_FACTORY from '../../constants/abi/UniswapV3Factory.json'; // Using UniswapV3-compatible ABI for JuiceSwap
import { getContractAddress } from '../../scripts/utils/deployments'; // Deployment tracking
// import { getDeployedAddress } from '../../ignition/utils/addresses'; // Hardhat Ignition
// TODO: Dynamically handle the deployment method or remove unused imports

/**
 ******************************************************************************
 * Integration tests for the JuiceDollar protocol
 ******************************************************************************
 * The purpose of these tests is to ensure that the deployed JuiceDollar
 * protocol contracts are setup correctly and interact as expected.
 *
 * This script can be applied to any network where the JuiceDollar protocol
 * contracts are deployed and only requires the contract addresses to be provided.
 *
 * For the atomic deployment method, the contract addresses are fetched from
 * the deployment JSON file using the `getContractAddress` function.
 * If the contracts are deployed through Hardhat Ignition, the `getDeployedAddress`
 * function can be used to fetch the contract addresses.
 *
 * How to run on a Citrea fork:
 * > npx hardhat node --no-deploy
 * > # Assumption: Contracts are deployed on Citrea, otherwise deploy them now
 * > npx hardhat run test/integration/integrationTest.ts
 */

interface Contracts {
  JUSD: JuiceDollar;
  equity: Equity;
  positionFactory: PositionFactory;
  positionRoller: PositionRoller;
  frontendGateway: FrontendGateway;
  mintingHubGateway: MintingHubGateway;
  savingsGateway: SavingsGateway;
  bridge: StablecoinBridge;
  bridgeSource: ERC20;
  collateralToken: ERC20;
  wcbtc: ERC20;
  swapRouter: any;
}

interface DeployedAddresses {
  JUSD: string;
  positionFactory: string;
  positionRoller: string;
  frontendGateway: string;
  mintingHubGateway: string;
  savingsGateway: string;
  bridge: string;
  collateralToken: string;
}

interface Config {
  collateralToken: string;
  bridge: string;
}

async function main() {
  console.log('Starting JuiceDollar protocol integration tests');

  // Validate that Citrea addresses are configured
  if (!citrea.WcBTC || !citrea.JUICESWAP_ROUTER || !citrea.JUICESWAP_FACTORY) {
    console.log('\n⚠️  Citrea addresses not configured yet - skipping integration tests');
    console.log('Please update constants/addresses.ts with deployed Citrea contract addresses:');
    console.log('  - WcBTC (Wrapped cBTC)');
    console.log('  - JUICESWAP_ROUTER');
    console.log('  - JUICESWAP_FACTORY');
    process.exit(0);
  }

  const [deployer] = await ethers.getSigners();
  console.log(`Running tests with account (signer): ${deployer.address}`);

  // Fetch deployed contract addresses
  const contractAddresses = await fetchDeployedAddresses();
  if (!contractAddresses) {
    console.error('Failed to fetch deployed contract addresses');
    process.exitCode = 1;
    return;
  }

  // Connect to contracts
  const contracts = await connectToContracts(contractAddresses, deployer);
  if (!contracts) {
    console.error('Failed to connect to contracts');
    process.exitCode = 1;
    return;
  }
  
  // Run all integration tests
  try {
    // Contract configuration and initialization tests
    await testProtocolInitialization(contracts);
    await testContractConfigurations(contracts);
    
    // Fund signer with collateral and JUSD for remaining tests
    await fundSigner(contracts, deployer);
    
    const position = await testPositionCreationAndMinting(contracts, deployer);
    await testSavingsInterestAccrual(contracts, deployer);
    await testStablecoinBridge(contracts, deployer);
    await testPositionRolling(contracts, position, deployer);

    console.log('\nAll integration tests completed!');
  } catch (error) {
    console.error('\n❌ Integration tests failed:', error);
    process.exitCode = 1;
  }
}

// Helper function to load configuration
async function fetchDeployedAddresses(): Promise<DeployedAddresses | null> {
  console.log('\nFetching deployed contract addresses...');

  try {
    // Config for collateral and bridge to test
    const configPath = path.join(__dirname, './config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Config;

    const addresses = {
      JUSD: await getContractAddress('juiceDollar'),
      positionFactory: await getContractAddress('positionFactory'),
      positionRoller: await getContractAddress('positionRoller'),
      frontendGateway: await getContractAddress('frontendGateway'),
      mintingHubGateway: await getContractAddress('mintingHubGateway'),
      savingsGateway: await getContractAddress('savingsGateway'),
      bridge: await getContractAddress(config.bridge),
      collateralToken: config.collateralToken,
    };

    console.log('✓ Fetched deployed contract addresses');
    console.log(addresses);
    return addresses;
  } catch (error) {
    console.error('Failed to fetch deployed contract addresses:', error);
    return null;
  }
}

// Connect to all contracts in the ecosystem
async function connectToContracts(config: DeployedAddresses, signer: HardhatEthersSigner): Promise<Contracts | null> {
  console.log('\nConnecting to deployed contracts...');

  try {
    // Core contracts
    const JUSD = await ethers.getContractAt('JuiceDollar', config.JUSD);
    const jusdConnected = JUSD.connect(signer);
    const equity = await ethers.getContractAt('Equity', await jusdConnected.reserve());
    const equityConnected = equity.connect(signer);
    const positionFactory = await ethers.getContractAt('PositionFactory', config.positionFactory);
    const positionFactoryConnected = positionFactory.connect(signer);
    const positionRoller = await ethers.getContractAt('PositionRoller', config.positionRoller);
    const positionRollerConnected = positionRoller.connect(signer);
    const frontendGateway = await ethers.getContractAt('FrontendGateway', config.frontendGateway);
    const frontendGatewayConnected = frontendGateway.connect(signer);
    const mintingHubGateway = await ethers.getContractAt('MintingHubGateway', config.mintingHubGateway);
    const mintingHubGatewayConnected = mintingHubGateway.connect(signer);
    const savingsGateway = await ethers.getContractAt('SavingsGateway', config.savingsGateway);
    const savingsGatewayConnected = savingsGateway.connect(signer);
    const bridge = await ethers.getContractAt('StablecoinBridge', config.bridge);
    const bridgeConnected = bridge.connect(signer);
    const bridgeSource = await ethers.getContractAt('ERC20', await bridgeConnected.usd());
    const bridgeSourceConnected = bridgeSource.connect(signer);
    const collateralToken = await ethers.getContractAt('ERC20', config.collateralToken);
    const collateralTokenConnected = collateralToken.connect(signer);
    const wcbtc = await ethers.getContractAt('ERC20', citrea.WcBTC);
    const wcbtcConnected = wcbtc.connect(signer);
    const swapRouter = new ethers.Contract(citrea.JUICESWAP_ROUTER, JUICESWAP_V3_ROUTER, signer);

    console.log('✓ Successfully connected to all contracts.');
    console.log(`  ⋅ Using ${await bridgeSourceConnected.symbol()}-${await jusdConnected.symbol()} bridge`);
    console.log(`  ⋅ Using ${await collateralTokenConnected.symbol()} (${await collateralTokenConnected.name()}) as collateral token`);

    return {
      JUSD: jusdConnected,
      equity: equityConnected,
      positionFactory: positionFactoryConnected,
      positionRoller: positionRollerConnected,
      frontendGateway: frontendGatewayConnected,
      mintingHubGateway: mintingHubGatewayConnected,
      savingsGateway: savingsGatewayConnected,
      bridge: bridgeConnected,
      bridgeSource: bridgeSourceConnected,
      collateralToken: collateralTokenConnected,
      wcbtc: wcbtcConnected,
      swapRouter,
    };
  } catch (error) {
    console.error('Failed to connect to contracts:', error);
    return null;
  }
}

async function fundWcBTC(wcbtcContract: ERC20, signer: HardhatEthersSigner, amount: bigint) {
  if ((await wcbtcContract.balanceOf(signer.address)) < ethers.parseEther('1')) {
    const wrapTx = await signer.sendTransaction({
      to: await wcbtcContract.getAddress(),
      value: amount,
    });
    await wrapTx.wait();
    console.log(`✓ Wrapped cBTC: ${ethers.formatEther(await wcbtcContract.balanceOf(signer.address))}`);
  }
}

async function swapExactWcBTCForToken(amountIn: bigint, tokenOut: ERC20, swapRouter: any, signer: HardhatEthersSigner) {
  const tokenOutAddress = await tokenOut.getAddress();
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60; // 20 minutes
  const params = {
    tokenIn: citrea.WcBTC,
    tokenOut: tokenOutAddress,
    fee: 3000, // 0.3% fee tier
    recipient: signer.address,
    deadline: deadline,
    amountIn: amountIn,
    amountOutMinimum: 0n,
    sqrtPriceLimitX96: 0n,
  };

  // Check if pool exists
  const factoryContract = new ethers.Contract(citrea.JUICESWAP_FACTORY, JUICESWAP_V3_FACTORY, signer);
  const poolAddress = await factoryContract.getPool(citrea.WcBTC, tokenOutAddress, 3000);
  if (poolAddress === ethers.ZeroAddress) {
    throw new Error(`Swap pool WcBTC-${await tokenOut.symbol()} does not exist`);
  } else {
    console.log(`✓ WcBTC-${await tokenOut.symbol()} pool found at: ${poolAddress}`);
  }

  const balanceBefore = await tokenOut.balanceOf(signer.address);
  const tx = await swapRouter.exactInputSingle(params);
  await tx.wait();
  const balanceAfter = await tokenOut.balanceOf(signer.address);
  console.log(
    `✓ Swapped ${ethers.formatEther(amountIn)} WcBTC for ${ethers.formatUnits(balanceAfter - balanceBefore, await tokenOut.decimals())} ${await tokenOut.symbol()}`,
  );
}

async function fundSigner(contracts: Contracts, signer: HardhatEthersSigner) {
  console.log("\nSetting up signer's token balances for testing...");

  const collateralToken = contracts.collateralToken;
  const bridgeSourceToken = contracts.bridgeSource;

  // Define amounts collateral and JUSD amounts for testing (chosen somewhat arbitrarily)
  const collateralFundingThreshold = ethers.parseEther('0.1');
  const jusdFundingThreshold = ethers.parseUnits('5000');
  const wcbtcToCollateral = ethers.parseEther('0.1');
  const wcbtcToBridgeSource = ethers.parseEther('10');

  // Check initial balances
  const collateralBalanceBefore = await collateralToken.balanceOf(signer.address);
  const jusdBalanceBefore = await contracts.JUSD.balanceOf(signer.address);

  // Swap some WcBTC to collateral token
  if (collateralBalanceBefore < collateralFundingThreshold) {
    await fundWcBTC(contracts.wcbtc, signer, wcbtcToCollateral);
    if ((await collateralToken.getAddress()) !== citrea.WcBTC) {
      await contracts.wcbtc.approve(citrea.JUICESWAP_ROUTER, wcbtcToCollateral);
      await swapExactWcBTCForToken(wcbtcToCollateral, collateralToken, contracts.swapRouter, signer);
    }
  }

  // Swap some WcBTC to bridge source token
  if (jusdBalanceBefore < jusdFundingThreshold) {
    await fundWcBTC(contracts.wcbtc, signer, wcbtcToBridgeSource);
    await contracts.wcbtc.approve(citrea.JUICESWAP_ROUTER, wcbtcToBridgeSource);
    await swapExactWcBTCForToken(wcbtcToBridgeSource, bridgeSourceToken, contracts.swapRouter, signer);
    // Bridge to JUSD
    const sourceTokenBalance = await bridgeSourceToken.balanceOf(signer.address);
    if (sourceTokenBalance > 0) {
      const amountToSwap = sourceTokenBalance / 2n;
      await bridgeSourceToken.approve(contracts.bridge.getAddress(), amountToSwap);
      await contracts.bridge.mint(amountToSwap);
    }
  }

  const collateralBalanceAfter = await collateralToken.balanceOf(signer.address);
  const jusdBalanceAfter = await contracts.JUSD.balanceOf(signer.address);
  // Final balances
  console.log('✓ Token balances setup for testing');
  console.log(`  ⋅ ${ethers.formatEther(collateralBalanceAfter)} ${await collateralToken.symbol()}`);
  console.log(`  ⋅ ${ethers.formatEther(jusdBalanceAfter)} JUSD`);
}

// Test protocol initialization
async function testProtocolInitialization(contracts: Contracts) {
  console.log('\nTesting protocol initialization...');

  // Test FrontendGateway initialization
  const savingsAddress = await contracts.frontendGateway.SAVINGS();
  assertTest(
    savingsAddress === (await contracts.savingsGateway.getAddress()),
    'FrontendGateway initialized with correct SAVINGS address',
    savingsAddress,
  );

  const mintingHubAddress = await contracts.frontendGateway.MINTING_HUB();
  assertTest(
    mintingHubAddress === (await contracts.mintingHubGateway.getAddress()),
    'FrontendGateway initialized with correct MINTING_HUB address',
    mintingHubAddress,
  );

  const frontendGatewayOwner = await contracts.frontendGateway.owner();
  assertTest(
    frontendGatewayOwner === ethers.ZeroAddress,
    'FrontendGateway ownership has been renounced',
    frontendGatewayOwner,
  );

  // Test JuiceDollar minter initialization
  const mintingHubGatewayIsMinter = await contracts.JUSD.isMinter(await contracts.mintingHubGateway.getAddress());
  assertTest(mintingHubGatewayIsMinter, 'MintingHubGateway is a minter', mintingHubGatewayIsMinter);

  const positionRollerIsMinter = await contracts.JUSD.isMinter(await contracts.positionRoller.getAddress());
  assertTest(positionRollerIsMinter, 'PositionRoller is a minter', positionRollerIsMinter);

  const savingsGatewayIsMinter = await contracts.JUSD.isMinter(await contracts.savingsGateway.getAddress());
  assertTest(savingsGatewayIsMinter, 'SavingsGateway is a minter', savingsGatewayIsMinter);

  const frontendGatewayIsMinter = await contracts.JUSD.isMinter(await contracts.frontendGateway.getAddress());
  assertTest(frontendGatewayIsMinter, 'FrontendGateway is a minter', frontendGatewayIsMinter);

  const bridgeIsMinter = await contracts.JUSD.isMinter(await contracts.bridge.getAddress());
  assertTest(bridgeIsMinter, 'StablecoinBridge is a minter', bridgeIsMinter);

  // Verify initial JUSD and JUICE mint
  // Refer to scripts/deployment/deploy/depoyProtocol.ts for mint amounts
  const equityBalance = await contracts.JUSD.balanceOf(await contracts.equity.getAddress());
  assertTest(equityBalance >= ethers.parseEther('1000'), 'Equity balance has at least 1000 JUSD', equityBalance);

  const equitySupply = await contracts.equity.totalSupply();
  assertTest(
    equitySupply == ethers.parseEther('10000000'),
    'Equity has initial JUICE supply of 10,000,000',
    equitySupply,
  );

  // Test that JuiceDollar.initialize reverts
  const testMinter = ethers.Wallet.createRandom().address;
  await assertRevert(
    async () => contracts.JUSD.initialize(testMinter, 'Test Minter'),
    'JuiceDollar.initialize reverts after deployment',
  );

  const testMinterIsMinter = await contracts.JUSD.isMinter(testMinter);
  assertTest(!testMinterIsMinter, 'Test minter is not a minter', testMinterIsMinter);
}

// Test contract configurations
async function testContractConfigurations(contracts: Contracts) {
  console.log('\nTesting contract configurations...');

  const mintingHubJUSD = await contracts.mintingHubGateway.JUSD();
  assertTest(mintingHubJUSD === (await contracts.JUSD.getAddress()), 'MintingHub-JUSD connection', mintingHubJUSD);

  const mintingHubGatewayHub = await contracts.mintingHubGateway.GATEWAY();
  assertTest(
    mintingHubGatewayHub === (await contracts.frontendGateway.getAddress()),
    'MintingHubGateway-FrontendGateway connection',
    mintingHubGatewayHub,
  );

  const savingsGatewaySavings = await contracts.savingsGateway.GATEWAY();
  assertTest(
    savingsGatewaySavings === (await contracts.frontendGateway.getAddress()),
    'SavingsGateway-FrontendGateway connection',
    savingsGatewaySavings,
  );
}

// Test position creation and minting
async function testPositionCreationAndMinting(contracts: Contracts, signer: HardhatEthersSigner) {
  console.log('\nTesting position creation and minting...');

  const collateralToken = contracts.collateralToken;
  const availableCollateral = await collateralToken.balanceOf(signer.address);

  // Create a new position
  const collateralAmount =
    availableCollateral > ethers.parseEther('5000') ? ethers.parseEther('5000') : (availableCollateral * 8n) / 10n;
  const minCollateral = collateralAmount / 10n; // 10% of total collateral
  const mintLimit = ethers.parseEther('50000');
  const initPeriod = 3 * 86400; // 3 days
  const expiration = 30 * 86400; // 30 days
  const challengePeriod = 1 * 86400; // 1 day
  const riskPremium = 10000; // 1%
  const liqPrice = (ethers.parseEther('5500') * ethers.parseEther('1')) / minCollateral; // Requirement: Min. collateral value >= 5000 JUSD
  const reservePPM = 200000; // 20%
  const frontendCode = ethers.ZeroHash; // empty frontend code

  const jusdBalanceBefore = await contracts.JUSD.balanceOf(signer.address);
  await collateralToken.approve(contracts.mintingHubGateway.getAddress(), collateralAmount);
  await contracts.JUSD.approve(contracts.mintingHubGateway.getAddress(), ethers.parseEther('1000'));
  const tx = await contracts.mintingHubGateway[
    'openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24,bytes32)'
  ](
    await collateralToken.getAddress(),
    minCollateral,
    collateralAmount,
    mintLimit,
    initPeriod,
    expiration,
    challengePeriod,
    riskPremium,
    liqPrice,
    reservePPM,
    frontendCode,
  );

  // Connect to the position
  const receipt = await tx.wait();
  const event = receipt?.logs
    .map((log) => contracts.mintingHubGateway.interface.parseLog({ topics: [...log.topics], data: log.data }))
    .find((parsedLog) => parsedLog?.name === 'PositionOpened');

  if (!event) {
    throw new Error('Position creation event not found');
  }

  const positionAddress = event.args.position || event.args[1]; // Position address from event
  const position = await ethers.getContractAt('Position', positionAddress);
  const positionConnected = position.connect(signer);

  // Pass approval and mint JUSD
  await ethers.provider.send('evm_increaseTime', [initPeriod]);
  await ethers.provider.send('evm_mine', []);
  await positionConnected.mint(signer.address, ethers.parseEther('5000'));

  // Check JUSD balance after minting
  const jusdBalanceAfter = await contracts.JUSD.balanceOf(signer.address);
  const jusdBalanceDiff = jusdBalanceAfter - jusdBalanceBefore;
  assertTest(jusdBalanceDiff > 0, 'Position minting', jusdBalanceDiff);

  return position; // Return position for use in rolling test
}

// Test savings interest accrual
async function testSavingsInterestAccrual(contracts: Contracts, signer: HardhatEthersSigner) {
  console.log('\nTesting savings interest accrual...');

  const saveAmount = ethers.parseEther('100');
  const JUSDBalance = await contracts.JUSD.balanceOf(signer.address);

  // Ensure we have enough JUSD for savings
  if (JUSDBalance < saveAmount) {
    throw new Error('Not enough JUSD for savings test');
  }

  // Approve and save JUSD
  await contracts.JUSD.approve(contracts.savingsGateway.getAddress(), saveAmount);
  await contracts.savingsGateway['save(uint192)'](saveAmount);

  const initialSavings = await contracts.savingsGateway.savings(signer.address);
  assertTest(initialSavings.saved >= saveAmount, 'Initial savings amount', initialSavings.saved);

  // Fast forward time to accrue interest (30 days)
  await ethers.provider.send('evm_increaseTime', [30 * 86400]);
  await ethers.provider.send('evm_mine', []);
  const pendingInterest = await contracts.savingsGateway['accruedInterest(address)'](signer.address);
  assertTest(pendingInterest > 0, 'Accrued interest', pendingInterest);

  // Refresh balance to update with interest
  await contracts.savingsGateway.refreshMyBalance();

  // Check updated balance with interest
  const updatedSavings = await contracts.savingsGateway.savings(signer.address);
  assertTest(updatedSavings.saved > initialSavings.saved, 'Updated savings with interest', updatedSavings.saved);
}

// Test stablecoin bridge
async function testStablecoinBridge(contracts: Contracts, signer: HardhatEthersSigner) {
  console.log('\nTesting stablecoin bridge...');

  const bridge = contracts.bridge;
  const bridgeSourceToken = contracts.bridgeSource;

  try {
    const bridgeSourceTokenBalanceBefore = await bridgeSourceToken.balanceOf(signer.address);
    const jusdBalanceBefore = await contracts.JUSD.balanceOf(signer.address);
    const swapAmount = ethers.parseUnits('10', await bridgeSourceToken.decimals());

    // Ensure we have enough source tokens for bridging
    if (bridgeSourceTokenBalanceBefore < swapAmount) {
      console.log(
        `  ✗ Insufficient balance of bridge source token, ${bridgeSourceTokenBalanceBefore} < ${swapAmount}. Skipping test.`,
      );
      return;
    }

    // Approve and bridge tokens
    await bridgeSourceToken.approve(bridge.getAddress(), swapAmount);
    await bridge.mint(swapAmount);

    const finalJUSDBalance = await contracts.JUSD.balanceOf(signer.address);
    const finalSourceBalance = await bridgeSourceToken.balanceOf(signer.address);

    assertTest(finalJUSDBalance > jusdBalanceBefore, 'Bridge mint increases JUSD balance', finalJUSDBalance);
    assertTest(
      finalSourceBalance < bridgeSourceTokenBalanceBefore,
      'Bridge mint decreases source token balance',
      finalSourceBalance,
    );
  } catch (error) {
    console.log(`  ✗ Bridge test failed: ${error}`);
  }
}

// Test position rolling
async function testPositionRolling(contracts: Contracts, sourcePosition: Position, signer: HardhatEthersSigner) {
  console.log('\nTesting position rolling...');

  // Create target position (similar parameters but longer expiration)
  const collateralToken = contracts.collateralToken;
  const availableCollateral = await collateralToken.balanceOf(signer.address);

  // Create a new position
  const collateralAmount =
    availableCollateral > ethers.parseEther('5000') ? ethers.parseEther('5000') : (availableCollateral * 8n) / 10n; // 80% of available collatera
  const minCollateral = collateralAmount / 10n; // 10% of total collateral
  const mintLimit = ethers.parseEther('500000'); // higher mint limit
  const initPeriod = 3 * 86400; // 3 days
  const expiration = 60 * 86400; // 60 days (LONGER expiration)
  const challengePeriod = 1 * 86400; // 1 day
  const riskPremium = 10000; // 1%
  const liqPrice = (ethers.parseEther('5500') * ethers.parseEther('1')) / minCollateral; // Requirement: Min. collateral value >= 5000 JUSD
  const reservePPM = 200000; // 20%
  const frontendCode = ethers.ZeroHash; // empty frontend code

  await collateralToken.approve(contracts.mintingHubGateway.getAddress(), collateralAmount);
  await contracts.JUSD.approve(contracts.mintingHubGateway.getAddress(), ethers.parseEther('1000'));
  const tx = await contracts.mintingHubGateway[
    'openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24,bytes32)'
  ](
    await collateralToken.getAddress(),
    minCollateral,
    collateralAmount,
    mintLimit,
    initPeriod,
    expiration,
    challengePeriod,
    riskPremium,
    liqPrice,
    reservePPM,
    frontendCode,
  );

  // Connect to the target position
  const receipt = await tx.wait();
  const event = receipt?.logs
    .map((log) => contracts.mintingHubGateway.interface.parseLog({ topics: [...log.topics], data: log.data }))
    .find((parsedLog) => parsedLog?.name === 'PositionOpened');

  if (!event) {
    throw new Error('Target position creation event not found');
  }
  const targetPositionAddress = event.args.position || event.args[1];
  const targetPosition = await ethers.getContractAt('Position', targetPositionAddress);

  // Fast forward time to accrue interest (30 days)
  await ethers.provider.send('evm_increaseTime', [30 * 86400]);
  await ethers.provider.send('evm_mine', []);

  // Check initial debts
  const sourceDebtBefore = await sourcePosition.getDebt();
  assertTest(sourceDebtBefore > 0, 'Source position has debt', sourceDebtBefore);

  const targetDebtBefore = await targetPosition.getDebt();
  assertTest(targetDebtBefore === 0n, 'Target position has no debt', targetDebtBefore);

  // Approve PositionRoller to spend the collateral (withdrawn via owner) and JUSD for repayment
  await collateralToken.approve(
    contracts.positionRoller.getAddress(),
    await collateralToken.balanceOf(sourcePosition.getAddress()),
  );
  await contracts.JUSD.approve(
    contracts.positionRoller.getAddress(),
    (await sourcePosition.getDebt()) + ethers.parseEther('10'),
  );
  await contracts.positionRoller.rollFully(sourcePosition.getAddress(), targetPosition.getAddress());

  const sourceDebtAfter = await sourcePosition.getDebt();
  assertTest(sourceDebtAfter === 0n, 'Source position debt cleared', sourceDebtAfter);

  const targetDebtAfter = await targetPosition.getDebt();
  assertTest(targetDebtAfter > 0, 'Target position has debt', targetDebtAfter);
  assertTest(targetDebtAfter >= sourceDebtBefore, 'Debt transferred to target', targetDebtAfter);
}

/**
 * Helper function to assert a test condition
 * @param condition The condition to check
 * @param testName The name of the test
 * @param actual The "actual" value to display if the test fails
 */
function assertTest(condition: boolean, testName: string, actual: any) {
  if (condition) {
    console.log(`✓ ${testName}`);
  } else {
    console.error(`\x1b[31m✗ ${testName} - Failed with value: ${actual}\x1b[0m`); // Red color
    // throw new Error(`Test failed: ${testName}`);
  }
}

/**
 * Helper function to assert that a function call reverts
 * @param func The async function to call that should revert
 * @param testName The name of the test
 * @param expectedErrorMessage Optional error message to check for (partial match)
 */
async function assertRevert(func: () => Promise<any>, testName: string, expectedErrorMessage?: string) {
  try {
    await func();
    console.error(`\x1b[31m✗ ${testName} - Function did not revert as expected\x1b[0m`);
    // throw new Error(`Test failed: ${testName} - Function did not revert as expected`);
  } catch (error: any) {
    if (expectedErrorMessage) {
      const errorMessage = error.message || String(error);
      const hasExpectedMessage = errorMessage.includes(expectedErrorMessage);
      if (hasExpectedMessage) {
        console.log(`✓ ${testName} - Reverted with expected message: "${expectedErrorMessage}"`);
      } else {
        console.error(`\x1b[31m✗ ${testName} - Reverted but with unexpected message: "${errorMessage}"\x1b[0m`);
        // throw new Error(`Test failed: ${testName} - Reverted with wrong message: ${errorMessage}`);
      }
    } else {
      console.log(`✓ ${testName} - Reverted as expected`);
    }
  }
}

// Run integration tests
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
