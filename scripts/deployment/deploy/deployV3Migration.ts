import fs from 'fs';
import path from 'path';
import { ethers } from 'hardhat';
import hre from 'hardhat';
import { migrationV3Config, migrationV3Params } from '../config/migrationV3Config';

/**
 * @description Deploys V3 migration contracts (Savings, MintingHub, SavingsVaultDEURO, CoinLendingGateway)
 *              and registers Savings + MintingHub as minters on dEURO.
 * @usage npx hardhat run scripts/deployment/deploy/deployV3Migration.ts --network <network>
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const networkName = hre.network.name;

  const config = migrationV3Config[networkName];
  if (!config) {
    console.error(`Network ${networkName} not supported. Supported networks: ${Object.keys(migrationV3Config).join(', ')}`);
    process.exit(1);
  }

  console.log(`Connected to ${networkName} (chainId: ${network.chainId})`);
  console.log(`Using deployer: ${deployer.address}`);
  console.log(`Using dEURO: ${config.decentralizedEURO}`);
  console.log(`Using PositionRoller: ${config.positionRoller}`);
  console.log(`Using PositionFactory: ${config.positionFactory}`);
  console.log(`Using WETH: ${config.weth}`);

  // Read on-chain minter application parameters
  const dEURO = await ethers.getContractAt('DecentralizedEURO', config.decentralizedEURO);
  const minFee = await dEURO.MIN_FEE();
  const minApplicationPeriod = await dEURO.MIN_APPLICATION_PERIOD();
  const totalFee = minFee * 2n; // Two suggestMinter calls

  console.log(`\nOn-chain MIN_FEE: ${ethers.formatEther(minFee)} dEURO`);
  console.log(`On-chain MIN_APPLICATION_PERIOD: ${Number(minApplicationPeriod) / 86400} days (${minApplicationPeriod}s)`);

  // Pre-deployment check: deployer has enough dEURO for minter fees
  const deployerBalance = await dEURO.balanceOf(deployer.address);
  console.log(`Deployer dEURO balance: ${ethers.formatEther(deployerBalance)}`);
  if (deployerBalance < totalFee) {
    console.error(`Insufficient dEURO balance. Need ${ethers.formatEther(totalFee)}, have ${ethers.formatEther(deployerBalance)}`);
    process.exit(1);
  }

  // --- 1. Deploy Savings ---
  console.log('\n1/7 Deploying Savings...');
  const Savings = await ethers.getContractFactory('Savings');
  const savings = await Savings.deploy(config.decentralizedEURO, migrationV3Params.initialSavingsRatePPM);
  const savingsDeployTxHash = savings.deploymentTransaction()?.hash;
  console.log(`    Savings deployment tx: ${savingsDeployTxHash}`);
  await savings.waitForDeployment();
  const savingsAddress = await savings.getAddress();
  console.log(`    Savings deployed to: ${savingsAddress}`);

  // --- 2. Deploy MintingHub ---
  console.log('2/7 Deploying MintingHub...');
  const MintingHub = await ethers.getContractFactory('MintingHub');
  const mintingHub = await MintingHub.deploy(
    config.decentralizedEURO,
    migrationV3Params.initialLendingRatePPM,
    config.positionRoller,
    config.positionFactory,
  );
  const mintingHubDeployTxHash = mintingHub.deploymentTransaction()?.hash;
  console.log(`    MintingHub deployment tx: ${mintingHubDeployTxHash}`);
  await mintingHub.waitForDeployment();
  const mintingHubAddress = await mintingHub.getAddress();
  console.log(`    MintingHub deployed to: ${mintingHubAddress}`);

  // --- 3. Deploy SavingsVaultDEURO ---
  console.log('3/7 Deploying SavingsVaultDEURO...');
  const SavingsVaultDEURO = await ethers.getContractFactory('SavingsVaultDEURO');
  const savingsVault = await SavingsVaultDEURO.deploy(
    config.decentralizedEURO,
    savingsAddress,
    migrationV3Params.savingsVaultName,
    migrationV3Params.savingsVaultSymbol,
  );
  const savingsVaultDeployTxHash = savingsVault.deploymentTransaction()?.hash;
  console.log(`    SavingsVaultDEURO deployment tx: ${savingsVaultDeployTxHash}`);
  await savingsVault.waitForDeployment();
  const savingsVaultAddress = await savingsVault.getAddress();
  console.log(`    SavingsVaultDEURO deployed to: ${savingsVaultAddress}`);

  // --- 4. Deploy CoinLendingGateway ---
  console.log('4/7 Deploying CoinLendingGateway...');
  const CoinLendingGateway = await ethers.getContractFactory('CoinLendingGateway');
  const coinLendingGateway = await CoinLendingGateway.deploy(mintingHubAddress, config.weth, config.decentralizedEURO);
  const coinLendingGatewayDeployTxHash = coinLendingGateway.deploymentTransaction()?.hash;
  console.log(`    CoinLendingGateway deployment tx: ${coinLendingGatewayDeployTxHash}`);
  await coinLendingGateway.waitForDeployment();
  const coinLendingGatewayAddress = await coinLendingGateway.getAddress();
  console.log(`    CoinLendingGateway deployed to: ${coinLendingGatewayAddress}`);

  // --- 5. Approve dEURO for minter fees ---
  console.log('5/7 Approving dEURO for minter application fees...');
  const approveTx = await dEURO.approve(config.decentralizedEURO, totalFee);
  console.log(`    Approve tx: ${approveTx.hash}`);
  const approveReceipt = await approveTx.wait();
  if (!approveReceipt || approveReceipt.status !== 1) {
    throw new Error('dEURO approval transaction failed');
  }
  console.log(`    Approved ${ethers.formatEther(totalFee)} dEURO`);

  // --- 6. suggestMinter for Savings ---
  console.log('6/7 Registering Savings as minter...');
  const suggestSavingsTx = await dEURO.suggestMinter(savingsAddress, minApplicationPeriod, minFee, 'Savings');
  console.log(`    suggestMinter(Savings) tx: ${suggestSavingsTx.hash}`);
  const suggestSavingsReceipt = await suggestSavingsTx.wait();
  if (!suggestSavingsReceipt || suggestSavingsReceipt.status !== 1) {
    throw new Error('suggestMinter(Savings) transaction failed');
  }
  console.log(`    suggestMinter(Savings) submitted`);

  // --- 7. suggestMinter for MintingHub ---
  console.log('7/7 Registering MintingHub as minter...');
  const suggestMintingHubTx = await dEURO.suggestMinter(mintingHubAddress, minApplicationPeriod, minFee, 'MintingHub');
  console.log(`    suggestMinter(MintingHub) tx: ${suggestMintingHubTx.hash}`);
  const suggestMintingHubReceipt = await suggestMintingHubTx.wait();
  if (!suggestMintingHubReceipt || suggestMintingHubReceipt.status !== 1) {
    throw new Error('suggestMinter(MintingHub) transaction failed');
  }
  console.log(`    suggestMinter(MintingHub) submitted`);

  // --- Save deployment info ---
  const timestamp = Math.floor(Date.now() / 1000);
  const savingsConstructorArgs = [config.decentralizedEURO, migrationV3Params.initialSavingsRatePPM];
  const mintingHubConstructorArgs = [
    config.decentralizedEURO,
    migrationV3Params.initialLendingRatePPM,
    config.positionRoller,
    config.positionFactory,
  ];
  const savingsVaultConstructorArgs = [
    config.decentralizedEURO,
    savingsAddress,
    migrationV3Params.savingsVaultName,
    migrationV3Params.savingsVaultSymbol,
  ];
  const coinLendingGatewayConstructorArgs = [mintingHubAddress, config.weth, config.decentralizedEURO];

  const deploymentInfo = {
    network: networkName,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    existingContracts: {
      decentralizedEURO: config.decentralizedEURO,
      positionRoller: config.positionRoller,
      positionFactory: config.positionFactory,
      weth: config.weth,
    },
    contracts: {
      savings: { address: savingsAddress, constructorArgs: savingsConstructorArgs },
      mintingHub: { address: mintingHubAddress, constructorArgs: mintingHubConstructorArgs },
      savingsVaultDEURO: { address: savingsVaultAddress, constructorArgs: savingsVaultConstructorArgs },
      coinLendingGateway: { address: coinLendingGatewayAddress, constructorArgs: coinLendingGatewayConstructorArgs },
    },
    minterSuggestions: {
      savings: {
        applicationPeriod: Number(minApplicationPeriod),
        fee: minFee.toString(),
      },
      mintingHub: {
        applicationPeriod: Number(minApplicationPeriod),
        fee: minFee.toString(),
      },
    },
    transactions: {
      savingsDeploy: savingsDeployTxHash,
      mintingHubDeploy: mintingHubDeployTxHash,
      savingsVaultDeploy: savingsVaultDeployTxHash,
      coinLendingGatewayDeploy: coinLendingGatewayDeployTxHash,
      approve: approveTx.hash,
      suggestMinterSavings: suggestSavingsTx.hash,
      suggestMinterMintingHub: suggestMintingHubTx.hash,
    },
    timestamp,
  };

  const deploymentDir = path.join(__dirname, '../../deployments');
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  const filename = `v3-migration-${networkName}-${timestamp}.json`;
  fs.writeFileSync(path.join(deploymentDir, filename), JSON.stringify(deploymentInfo, null, 2));
  console.log(`\nDeployment info saved to: scripts/deployments/${filename}`);

  // --- Etherscan verification on live networks ---
  if (networkName !== 'hardhat' && networkName !== 'localhost') {
    console.log('\nWaiting for block confirmations before verification...');
    const lastDeployTx = coinLendingGateway.deploymentTransaction();
    if (lastDeployTx) {
      await lastDeployTx.wait(5);
    }

    const contractsToVerify = [
      { name: 'Savings', address: savingsAddress, constructorArguments: savingsConstructorArgs },
      { name: 'MintingHub', address: mintingHubAddress, constructorArguments: mintingHubConstructorArgs },
      { name: 'SavingsVaultDEURO', address: savingsVaultAddress, constructorArguments: savingsVaultConstructorArgs },
      {
        name: 'CoinLendingGateway',
        address: coinLendingGatewayAddress,
        constructorArguments: coinLendingGatewayConstructorArgs,
      },
    ];

    for (const contract of contractsToVerify) {
      console.log(`Verifying ${contract.name}...`);
      try {
        await hre.run('verify:verify', {
          address: contract.address,
          constructorArguments: contract.constructorArguments,
        });
        console.log(`  ${contract.name} verified successfully`);
      } catch (error: any) {
        if (error.message.includes('Already Verified')) {
          console.log(`  ${contract.name} is already verified`);
        } else {
          console.error(`  ${contract.name} verification failed:`, error.message);
        }
      }
    }
  }

  // --- Summary ---
  console.log('\n=== V3 Migration Deployment Summary ===');
  console.log(`Savings:            ${savingsAddress}`);
  console.log(`MintingHub:         ${mintingHubAddress}`);
  console.log(`SavingsVaultDEURO:  ${savingsVaultAddress}`);
  console.log(`CoinLendingGateway: ${coinLendingGatewayAddress}`);
  console.log(`\nMinter suggestions submitted. Approval after ${Number(minApplicationPeriod) / 86400} days.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Deployment error:', error);
    process.exit(1);
  });
