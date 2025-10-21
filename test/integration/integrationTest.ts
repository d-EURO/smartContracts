import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import {
  DecentralizedEURO,
  DEPSWrapper,
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
import { mainnet } from '../../constants/addresses';
import UNISWAP_V3_ROUTER from '../../constants/abi/UniswapV3Router.json';
import UNISWAP_V3_FACTORY from '../../constants/abi/UniswapV3Factory.json';
import { getContractAddress } from '../../scripts/utils/deployments'; // Flashbots deployment
// import { getDeployedAddress } from '../../ignition/utils/addresses'; // Hardhat Ignition
// TODO: Dynamically handle the deployment method or remove unused imports

/**
 ******************************************************************************
 * Integration tests for the DecentralizedEURO protocol
 ******************************************************************************
 * The purpose of these tests is to ensure that the deployed DecentralizedEURO
 * protocol contracts are setup correctly and interact as expected.
 *
 * This script can be applied to any network where the DecentralizedEURO protocol
 * contracts are deployed and only requires the contract addresses to be provided.
 *
 * For the deployment through Flashbots, the contract addresses are fetched from
 * the Flashbots deployment JSON file using the `getFlashbotDeploymentAddress` function.
 * If the contracts are deployed through Hardhat Ignition, the `getDeployedAddress`
 * function can be used to fetch the contract addresses.
 *
 * How to run on a mainnet fork:
 * > npx hardhat node --no-deploy
 * > # Assumption: Contracts are deployed on mainnet, otherwise deploy them now
 * > npx hardhat run scripts/integration/integrationTest.ts
 */
// TODO: Add above documentation to a README.md file

interface Contracts {
  dEURO: DecentralizedEURO;
  equity: Equity;
  positionFactory: PositionFactory;
  positionRoller: PositionRoller;
  depsWrapper: DEPSWrapper;
  frontendGateway: FrontendGateway;
  mintingHubGateway: MintingHubGateway;
  savingsGateway: SavingsGateway;
  bridge: StablecoinBridge;
  bridgeSource: ERC20;
  collateralToken: ERC20;
  weth: ERC20;
  swapRouter: any;
}

interface DeployedAddresses {
  dEURO: string;
  positionFactory: string;
  positionRoller: string;
  depsWrapper: string;
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
  console.log('Starting DecentralizedEURO protocol integration tests');

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
    
    // Fund signer with collateral and dEURO for remaining tests
    await fundSigner(contracts, deployer);
    
    const position = await testPositionCreationAndMinting(contracts, deployer);
    await testSavingsInterestAccrual(contracts, deployer);
    await testStablecoinBridge(contracts, deployer);
    await testDEPSWrapping(contracts, deployer);
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
      dEURO: await getContractAddress('decentralizedEURO'),
      positionFactory: await getContractAddress('positionFactory'),
      positionRoller: await getContractAddress('positionRoller'),
      depsWrapper: await getContractAddress('depsWrapper'),
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
    const dEURO = await ethers.getContractAt('DecentralizedEURO', config.dEURO);
    const dEUROConnected = dEURO.connect(signer);
    const equity = await ethers.getContractAt('Equity', await dEUROConnected.reserve());
    const equityConnected = equity.connect(signer);
    const positionFactory = await ethers.getContractAt('PositionFactory', config.positionFactory);
    const positionFactoryConnected = positionFactory.connect(signer);
    const positionRoller = await ethers.getContractAt('PositionRoller', config.positionRoller);
    const positionRollerConnected = positionRoller.connect(signer);
    const depsWrapper = await ethers.getContractAt('DEPSWrapper', config.depsWrapper);
    const depsWrapperConnected = depsWrapper.connect(signer);
    const frontendGateway = await ethers.getContractAt('FrontendGateway', config.frontendGateway);
    const frontendGatewayConnected = frontendGateway.connect(signer);
    const mintingHubGateway = await ethers.getContractAt('MintingHubGateway', config.mintingHubGateway);
    const mintingHubGatewayConnected = mintingHubGateway.connect(signer);
    const savingsGateway = await ethers.getContractAt('SavingsGateway', config.savingsGateway);
    const savingsGatewayConnected = savingsGateway.connect(signer);
    const bridge = await ethers.getContractAt('StablecoinBridge', config.bridge);
    const bridgeConnected = bridge.connect(signer);
    const bridgeSource = await ethers.getContractAt('ERC20', await bridgeConnected.eur());
    const bridgeSourceConnected = bridgeSource.connect(signer);
    const collateralToken = await ethers.getContractAt('ERC20', config.collateralToken);
    const collateralTokenConnected = collateralToken.connect(signer);
    const weth = await ethers.getContractAt('ERC20', mainnet.WETH9);
    const wethConnected = weth.connect(signer);
    const swapRouter = new ethers.Contract(mainnet.UNISWAP_V3_ROUTER, UNISWAP_V3_ROUTER, signer);

    console.log('✓ Successfully connected to all contracts.');
    console.log(`  ⋅ Using ${await bridgeSourceConnected.symbol()}-${await dEUROConnected.symbol()} bridge`);
    console.log(`  ⋅ Using ${await collateralTokenConnected.symbol()} (${await collateralTokenConnected.name()}) as collateral token`);

    return {
      dEURO: dEUROConnected,
      equity: equityConnected,
      positionFactory: positionFactoryConnected,
      positionRoller: positionRollerConnected,
      depsWrapper: depsWrapperConnected,
      frontendGateway: frontendGatewayConnected,
      mintingHubGateway: mintingHubGatewayConnected,
      savingsGateway: savingsGatewayConnected,
      bridge: bridgeConnected,
      bridgeSource: bridgeSourceConnected,
      collateralToken: collateralTokenConnected,
      weth: wethConnected,
      swapRouter,
    };
  } catch (error) {
    console.error('Failed to connect to contracts:', error);
    return null;
  }
}

async function fundWETH(wethContract: ERC20, signer: HardhatEthersSigner, amount: bigint) {
  if ((await wethContract.balanceOf(signer.address)) < ethers.parseEther('1')) {
    const wrapTx = await signer.sendTransaction({
      to: await wethContract.getAddress(),
      value: amount,
    });
    await wrapTx.wait();
    console.log(`✓ Wrapped ETH: ${ethers.formatEther(await wethContract.balanceOf(signer.address))}`);
  }
}

async function swapExactWETHForToken(amountIn: bigint, tokenOut: ERC20, swapRouter: any, signer: HardhatEthersSigner) {
  const tokenOutAddress = await tokenOut.getAddress();
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60; // 20 minutes
  const params = {
    tokenIn: mainnet.WETH9,
    tokenOut: tokenOutAddress,
    fee: 3000, // 0.3% fee tier
    recipient: signer.address,
    deadline: deadline,
    amountIn: amountIn,
    amountOutMinimum: 0n,
    sqrtPriceLimitX96: 0n,
  };

  // Check if pool exists
  const factoryContract = new ethers.Contract(mainnet.UNISWAP_V3_FACTORY, UNISWAP_V3_FACTORY, signer);
  const poolAddress = await factoryContract.getPool(mainnet.WETH9, tokenOutAddress, 3000);
  if (poolAddress === ethers.ZeroAddress) {
    throw new Error(`Swap pool WETH-${await tokenOut.symbol()} does not exist`);
  } else {
    console.log(`✓ WETH-${await tokenOut.symbol()} pool found at: ${poolAddress}`);
  }

  const balanceBefore = await tokenOut.balanceOf(signer.address);
  const tx = await swapRouter.exactInputSingle(params);
  await tx.wait();
  const balanceAfter = await tokenOut.balanceOf(signer.address);
  console.log(
    `✓ Swapped ${ethers.formatEther(amountIn)} WETH for ${ethers.formatUnits(balanceAfter - balanceBefore, await tokenOut.decimals())} ${await tokenOut.symbol()}`,
  );
}

async function fundSigner(contracts: Contracts, signer: HardhatEthersSigner) {
  console.log("\nSetting up signer's token balances for testing...");

  const collateralToken = contracts.collateralToken;
  const bridgeSourceToken = contracts.bridgeSource;

  // Define amounts collateral and dEURO amounts for testing (chosen somewhat arbitrarily)
  const collateralFundingThreshold = ethers.parseEther('0.1');
  const dEuroFundingThreshold = ethers.parseUnits('5000');
  const wethToCollateral = ethers.parseEther('0.1');
  const wethToBridgeSource = ethers.parseEther('10');

  // Check initial balances
  const collateralBalanceBefore = await collateralToken.balanceOf(signer.address);
  const dEuroBalanceBefore = await contracts.dEURO.balanceOf(signer.address);

  // Swap some WETH to collateral token
  if (collateralBalanceBefore < collateralFundingThreshold) {
    await fundWETH(contracts.weth, signer, wethToCollateral);
    if ((await collateralToken.getAddress()) !== mainnet.WETH9) {
      await contracts.weth.approve(mainnet.UNISWAP_V3_ROUTER, wethToCollateral);
      await swapExactWETHForToken(wethToCollateral, collateralToken, contracts.swapRouter, signer);
    }
  }

  // Swap some WETH to bridge source token
  if (dEuroBalanceBefore < dEuroFundingThreshold) {
    await fundWETH(contracts.weth, signer, wethToBridgeSource);
    await contracts.weth.approve(mainnet.UNISWAP_V3_ROUTER, wethToBridgeSource);
    await swapExactWETHForToken(wethToBridgeSource, bridgeSourceToken, contracts.swapRouter, signer);
    // Bridge to dEURO
    const sourceTokenBalance = await bridgeSourceToken.balanceOf(signer.address);
    if (sourceTokenBalance > 0) {
      const amountToSwap = sourceTokenBalance / 2n;
      await bridgeSourceToken.approve(contracts.bridge.getAddress(), amountToSwap);
      await contracts.bridge.mint(amountToSwap);
    }
  }

  const collateralBalanceAfter = await collateralToken.balanceOf(signer.address);
  const dEuroBalanceAfter = await contracts.dEURO.balanceOf(signer.address);
  // Final balances
  console.log('✓ Token balances setup for testing');
  console.log(`  ⋅ ${ethers.formatEther(collateralBalanceAfter)} ${await collateralToken.symbol()}`);
  console.log(`  ⋅ ${ethers.formatEther(dEuroBalanceAfter)} dEURO`);
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

  // Test DecentralizedEURO minter initialization
  const mintingHubGatewayIsMinter = await contracts.dEURO.isMinter(await contracts.mintingHubGateway.getAddress());
  assertTest(mintingHubGatewayIsMinter, 'MintingHubGateway is a minter', mintingHubGatewayIsMinter);

  const positionRollerIsMinter = await contracts.dEURO.isMinter(await contracts.positionRoller.getAddress());
  assertTest(positionRollerIsMinter, 'PositionRoller is a minter', positionRollerIsMinter);

  const savingsGatewayIsMinter = await contracts.dEURO.isMinter(await contracts.savingsGateway.getAddress());
  assertTest(savingsGatewayIsMinter, 'SavingsGateway is a minter', savingsGatewayIsMinter);

  const frontendGatewayIsMinter = await contracts.dEURO.isMinter(await contracts.frontendGateway.getAddress());
  assertTest(frontendGatewayIsMinter, 'FrontendGateway is a minter', frontendGatewayIsMinter);

  const bridgeIsMinter = await contracts.dEURO.isMinter(await contracts.bridge.getAddress());
  assertTest(bridgeIsMinter, 'StablecoinBridge is a minter', bridgeIsMinter);

  // Verify initial dEURO and nDEPS mint
  // Refer to scripts/deployment/deploy/depoyProtocol.ts for mint amounts
  const equityBalance = await contracts.dEURO.balanceOf(await contracts.equity.getAddress());
  assertTest(equityBalance >= ethers.parseEther('1000'), 'Equity balance has at least 1000 dEURO', equityBalance);

  const equitySupply = await contracts.equity.totalSupply();
  assertTest(
    equitySupply == ethers.parseEther('10000000'),
    'Equity has initial nDEPS supply of 10,000,000',
    equitySupply,
  );

  // Test that DecentralizedEURO.initialize reverts
  const testMinter = ethers.Wallet.createRandom().address;
  await assertRevert(
    async () => contracts.dEURO.initialize(testMinter, 'Test Minter'),
    'DecentralizedEURO.initialize reverts after deployment',
  );

  const testMinterIsMinter = await contracts.dEURO.isMinter(testMinter);
  assertTest(!testMinterIsMinter, 'Test minter is not a minter', testMinterIsMinter);
}

// Test contract configurations
async function testContractConfigurations(contracts: Contracts) {
  console.log('\nTesting contract configurations...');

  const mintingHubDEURO = await contracts.mintingHubGateway.DEURO();
  assertTest(mintingHubDEURO === (await contracts.dEURO.getAddress()), 'MintingHub-dEURO connection', mintingHubDEURO);

  const depsWrapperUnderlying = await contracts.depsWrapper.underlying();
  assertTest(
    depsWrapperUnderlying === (await contracts.equity.getAddress()),
    'DEPSWrapper underlying is nDEPS',
    depsWrapperUnderlying,
  );

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
  const liqPrice = (ethers.parseEther('5500') * ethers.parseEther('1')) / minCollateral; // Requirement: Min. collateral value >= 5000 dEURO
  const reservePPM = 200000; // 20%
  const frontendCode = ethers.ZeroHash; // empty frontend code

  const dEuroBalanceBefore = await contracts.dEURO.balanceOf(signer.address);
  await collateralToken.approve(contracts.mintingHubGateway.getAddress(), collateralAmount);
  await contracts.dEURO.approve(contracts.mintingHubGateway.getAddress(), ethers.parseEther('1000'));
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

  // Pass approval and mint dEURO
  await ethers.provider.send('evm_increaseTime', [initPeriod]);
  await ethers.provider.send('evm_mine', []);
  await positionConnected.mint(signer.address, ethers.parseEther('5000'));

  // Check dEURO balance after minting
  const dEuroBalanceAfter = await contracts.dEURO.balanceOf(signer.address);
  const dEuroBalanceDiff = dEuroBalanceAfter - dEuroBalanceBefore;
  assertTest(dEuroBalanceDiff > 0, 'Position minting', dEuroBalanceDiff);

  return position; // Return position for use in rolling test
}

// Test savings interest accrual
async function testSavingsInterestAccrual(contracts: Contracts, signer: HardhatEthersSigner) {
  console.log('\nTesting savings interest accrual...');

  const saveAmount = ethers.parseEther('100');
  const dEUROBalance = await contracts.dEURO.balanceOf(signer.address);

  // Ensure we have enough dEURO for savings
  if (dEUROBalance < saveAmount) {
    throw new Error('Not enough dEURO for savings test');
  }

  // Approve and save dEURO
  await contracts.dEURO.approve(contracts.savingsGateway.getAddress(), saveAmount);
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
    const dEuroBalanceBefore = await contracts.dEURO.balanceOf(signer.address);
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

    const finalDEUROBalance = await contracts.dEURO.balanceOf(signer.address);
    const finalSourceBalance = await bridgeSourceToken.balanceOf(signer.address);

    assertTest(finalDEUROBalance > dEuroBalanceBefore, 'Bridge mint increases dEURO balance', finalDEUROBalance);
    assertTest(
      finalSourceBalance < bridgeSourceTokenBalanceBefore,
      'Bridge mint decreases source token balance',
      finalSourceBalance,
    );
  } catch (error) {
    console.log(`  ✗ Bridge test failed: ${error}`);
  }
}

// Test DEPS wrapping and unwrapping
async function testDEPSWrapping(contracts: Contracts, signer: HardhatEthersSigner) {
  console.log('\nTesting DEPS wrapping and unwrapping...');

  // First invest some dEURO to get nDEPS
  const investAmount = ethers.parseEther('100');
  const dEUROBalance = await contracts.dEURO.balanceOf(signer.address);

  if (dEUROBalance < investAmount) {
    throw new Error('Not enough dEURO for DEPS wrapping test');
  }

  // Invest to get nDEPS
  await contracts.dEURO.approve(contracts.equity.getAddress(), investAmount);
  await contracts.equity.invest(investAmount, 0);
  const nDEPSBalance = await contracts.equity.balanceOf(signer.address);
  assertTest(nDEPSBalance > 0, 'nDEPS balance after investment', nDEPSBalance);

  // Wrap half
  const wrapAmount = nDEPSBalance / 2n;
  await contracts.equity.approve(contracts.depsWrapper.getAddress(), wrapAmount);
  await contracts.depsWrapper.wrap(wrapAmount);
  const depsBalance = await contracts.depsWrapper.balanceOf(signer.address);
  assertTest(depsBalance >= wrapAmount, 'DEPS balance after wrapping', depsBalance);

  // Unwrap half
  const unwrapAmount = depsBalance / 2n;
  await contracts.depsWrapper.unwrap(unwrapAmount);
  const finalNDEPSBalance = await contracts.equity.balanceOf(signer.address);
  assertTest(finalNDEPSBalance > nDEPSBalance - wrapAmount, 'nDEPS balance after unwrapping', finalNDEPSBalance);
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
  const liqPrice = (ethers.parseEther('5500') * ethers.parseEther('1')) / minCollateral; // Requirement: Min. collateral value >= 5000 dEURO
  const reservePPM = 200000; // 20%
  const frontendCode = ethers.ZeroHash; // empty frontend code

  await collateralToken.approve(contracts.mintingHubGateway.getAddress(), collateralAmount);
  await contracts.dEURO.approve(contracts.mintingHubGateway.getAddress(), ethers.parseEther('1000'));
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

  // Approve PositionRoller to spend the collateral (withdrawn via owner) and dEURO for repayment
  await collateralToken.approve(
    contracts.positionRoller.getAddress(),
    await collateralToken.balanceOf(sourcePosition.getAddress()),
  );
  await contracts.dEURO.approve(
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
