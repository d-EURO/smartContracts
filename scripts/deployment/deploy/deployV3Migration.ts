import { ethers } from 'hardhat';
import hre from 'hardhat';
import { migrationV3Config, migrationV3Params } from '../config/migrationV3Config';
import fs from 'fs';
import path from 'path';

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;
  const chainId = (await ethers.provider.getNetwork()).chainId;

  console.log('='.repeat(60));
  console.log('JuiceDollar V3 Migration Deployment');
  console.log('='.repeat(60));
  console.log(`Network:  ${network} (chainId: ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} cBTC`);
  if (balance === 0n) {
    throw new Error('Deployer has no balance');
  }

  // Get config for current network
  const networkKey = network === 'citrea' ? 'citrea' : 'hardhat';
  const config = migrationV3Config[networkKey];
  const params = migrationV3Params;

  console.log(`\nJUSD:     ${config.juiceDollar}`);
  console.log(`WcBTC:    ${config.wcbtc}`);
  console.log(`Savings Rate: ${params.initialSavingsRatePPM} ppm (${params.initialSavingsRatePPM / 10_000}%)`);
  console.log(`Lending Rate: ${params.initialLendingRatePPM} ppm (${params.initialLendingRatePPM / 10_000}%)\n`);

  const deployed: Record<string, { address: string; constructorArgs: any[] }> = {};

  // 1. Deploy PositionFactory
  console.log('--- Deploying PositionFactory ---');
  const PositionFactoryFactory = await ethers.getContractFactory('PositionFactory');
  const positionFactory = await PositionFactoryFactory.deploy();
  await positionFactory.waitForDeployment();
  const positionFactoryAddr = await positionFactory.getAddress();
  deployed.positionFactory = { address: positionFactoryAddr, constructorArgs: [] };
  console.log(`  PositionFactory: ${positionFactoryAddr}\n`);

  // 2. Deploy PositionRoller
  console.log('--- Deploying PositionRoller ---');
  const PositionRollerFactory = await ethers.getContractFactory('PositionRoller');
  const roller = await PositionRollerFactory.deploy(config.juiceDollar);
  await roller.waitForDeployment();
  const rollerAddr = await roller.getAddress();
  deployed.positionRoller = { address: rollerAddr, constructorArgs: [config.juiceDollar] };
  console.log(`  PositionRoller: ${rollerAddr}\n`);

  // 3. Deploy Savings
  console.log('--- Deploying Savings ---');
  const SavingsFactory = await ethers.getContractFactory('Savings');
  const savings = await SavingsFactory.deploy(config.juiceDollar, params.initialSavingsRatePPM);
  await savings.waitForDeployment();
  const savingsAddr = await savings.getAddress();
  deployed.savings = { address: savingsAddr, constructorArgs: [config.juiceDollar, params.initialSavingsRatePPM] };
  console.log(`  Savings: ${savingsAddr}\n`);

  // 4. Deploy MintingHub
  console.log('--- Deploying MintingHub ---');
  const MintingHubFactory = await ethers.getContractFactory('MintingHub');
  const mintingHub = await MintingHubFactory.deploy(
    config.juiceDollar,
    params.initialLendingRatePPM,
    rollerAddr,
    positionFactoryAddr,
    config.wcbtc,
  );
  await mintingHub.waitForDeployment();
  const mintingHubAddr = await mintingHub.getAddress();
  deployed.mintingHub = {
    address: mintingHubAddr,
    constructorArgs: [config.juiceDollar, params.initialLendingRatePPM, rollerAddr, positionFactoryAddr, config.wcbtc],
  };
  console.log(`  MintingHub: ${mintingHubAddr}\n`);

  // 5. Deploy SavingsVaultJUSD
  console.log('--- Deploying SavingsVaultJUSD ---');
  const SavingsVaultFactory = await ethers.getContractFactory('SavingsVaultJUSD');
  const savingsVault = await SavingsVaultFactory.deploy(
    config.juiceDollar,
    savingsAddr,
    params.savingsVaultName,
    params.savingsVaultSymbol,
  );
  await savingsVault.waitForDeployment();
  const savingsVaultAddr = await savingsVault.getAddress();
  deployed.savingsVaultJUSD = {
    address: savingsVaultAddr,
    constructorArgs: [config.juiceDollar, savingsAddr, params.savingsVaultName, params.savingsVaultSymbol],
  };
  console.log(`  SavingsVaultJUSD: ${savingsVaultAddr}\n`);

  // Register minters via suggestMinter
  console.log('--- Registering Minters ---');
  const jusd = await ethers.getContractAt('JuiceDollar', config.juiceDollar);

  // Read on-chain minter application parameters
  const minFee = await jusd.MIN_FEE();
  const minApplicationPeriod = await jusd.MIN_APPLICATION_PERIOD();
  const totalFee = minFee * 3n;

  console.log(`  MIN_FEE: ${ethers.formatEther(minFee)} JUSD`);
  console.log(`  MIN_APPLICATION_PERIOD: ${Number(minApplicationPeriod) / 86400} days (${minApplicationPeriod}s)`);

  // Check deployer has enough JUSD for fees
  const deployerJusdBalance = await jusd.balanceOf(deployer.address);
  console.log(`  Deployer JUSD balance: ${ethers.formatEther(deployerJusdBalance)}`);
  if (deployerJusdBalance < totalFee) {
    throw new Error(`Insufficient JUSD. Need ${ethers.formatEther(totalFee)}, have ${ethers.formatEther(deployerJusdBalance)}`);
  }

  // Approve JUSD for minter application fees
  console.log(`  Approving ${ethers.formatEther(totalFee)} JUSD for fees...`);
  const approveTx = await jusd.approve(config.juiceDollar, totalFee);
  const approveReceipt = await approveTx.wait();
  if (!approveReceipt || approveReceipt.status !== 1) {
    throw new Error('JUSD approval transaction failed');
  }
  console.log(`  TX: ${approveTx.hash}`);

  console.log('  Suggesting Savings as minter...');
  const tx1 = await jusd.suggestMinter(savingsAddr, minApplicationPeriod, minFee, 'Savings V3');
  const receipt1 = await tx1.wait();
  if (!receipt1 || receipt1.status !== 1) {
    throw new Error('suggestMinter(Savings) transaction failed');
  }
  console.log(`  TX: ${tx1.hash}`);

  console.log('  Suggesting MintingHub as minter...');
  const tx2 = await jusd.suggestMinter(mintingHubAddr, minApplicationPeriod, minFee, 'MintingHub V3');
  const receipt2 = await tx2.wait();
  if (!receipt2 || receipt2.status !== 1) {
    throw new Error('suggestMinter(MintingHub) transaction failed');
  }
  console.log(`  TX: ${tx2.hash}`);

  console.log('  Suggesting PositionRoller as minter...');
  const tx3 = await jusd.suggestMinter(rollerAddr, minApplicationPeriod, minFee, 'PositionRoller V3');
  const receipt3 = await tx3.wait();
  if (!receipt3 || receipt3.status !== 1) {
    throw new Error('suggestMinter(PositionRoller) transaction failed');
  }
  console.log(`  TX: ${tx3.hash}\n`);

  // Save deployment info
  const timestamp = Math.floor(Date.now() / 1000);
  const deploymentInfo = {
    network,
    chainId: Number(chainId),
    deployer: deployer.address,
    existingContracts: {
      juiceDollar: config.juiceDollar,
      wcbtc: config.wcbtc,
    },
    contracts: deployed,
    minterSuggestions: {
      savings: {
        applicationPeriod: Number(minApplicationPeriod),
        fee: minFee.toString(),
      },
      mintingHub: {
        applicationPeriod: Number(minApplicationPeriod),
        fee: minFee.toString(),
      },
      positionRoller: {
        applicationPeriod: Number(minApplicationPeriod),
        fee: minFee.toString(),
      },
    },
    transactions: {
      positionFactoryDeploy: positionFactory.deploymentTransaction()?.hash,
      positionRollerDeploy: roller.deploymentTransaction()?.hash,
      savingsDeploy: savings.deploymentTransaction()?.hash,
      mintingHubDeploy: mintingHub.deploymentTransaction()?.hash,
      savingsVaultDeploy: savingsVault.deploymentTransaction()?.hash,
      approve: approveTx.hash,
      suggestMinterSavings: tx1.hash,
      suggestMinterMintingHub: tx2.hash,
      suggestMinterPositionRoller: tx3.hash,
    },
    timestamp,
  };

  const outputDir = path.join(process.cwd(), 'deployments', network);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const outputPath = path.join(outputDir, `v3-migration-${timestamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`Deployment info saved to: ${outputPath}`);

  // Verify contracts if on a live network
  if (network !== 'hardhat' && network !== 'localhost') {
    console.log('\n--- Verifying Contracts ---');
    for (const [name, data] of Object.entries(deployed)) {
      try {
        console.log(`  Verifying ${name} at ${data.address}...`);
        await hre.run('verify:verify', {
          address: data.address,
          constructorArguments: data.constructorArgs,
        });
        console.log(`  [OK] ${name} verified`);
      } catch (e: any) {
        console.log(`  [SKIP] ${name}: ${e.message}`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Deployment Summary:');
  for (const [name, data] of Object.entries(deployed)) {
    console.log(`  ${name.padEnd(20)} ${data.address}`);
  }
  console.log(`\nMinter suggestions submitted. Approval after ${Number(minApplicationPeriod) / 86400} days.`);
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
