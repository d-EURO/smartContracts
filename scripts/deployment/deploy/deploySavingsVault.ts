import fs from 'fs';
import path from 'path';
import { ethers } from 'hardhat';
import hre from 'hardhat';
import { vaultConfig, vaultMetadata } from '../config/savingsVaultConfig';

/**
 * @description Deploys the SavingsVaultDEURO contract on the specified network.
 * @usage npx hardhat run scripts/deployment/deploy/deploySavingsVault.ts --network <network>
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  // Make sure we're on a supported network
  if (!vaultConfig[network.name]) {
    console.error(`Network ${network.name} not supported. Supported networks: ${Object.keys(vaultConfig).join(', ')}`);
    process.exit(1);
  }

  const networkConfig = vaultConfig[network.name];

  console.log(`Connected to ${network.name} (chainId: ${network.chainId})`);
  console.log(`Using deployer address: ${deployer.address}`);
  console.log(`Using dEURO address: ${networkConfig.deuro}`);
  console.log(`Using Savings address: ${networkConfig.savings}`);

  // Deploy the SavingsVaultDEURO contract
  console.log('Deploying SavingsVaultDEURO...');
  const SavingsVaultFactory = await ethers.getContractFactory('SavingsVaultDEURO');
  const vault = await SavingsVaultFactory.deploy(
    networkConfig.deuro,
    networkConfig.savings,
    vaultMetadata.name,
    vaultMetadata.symbol,
  );

  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`SavingsVaultDEURO deployed to: ${vaultAddress}`);

  // Save deployment info
  const timestamp = Math.floor(Date.now() / 1000);
  const deploymentInfo = {
    network: network.name,
    chainId: Number(network.chainId),
    vault: {
      address: vaultAddress,
      deuro: networkConfig.deuro,
      savings: networkConfig.savings,
      name: vaultMetadata.name,
      symbol: vaultMetadata.symbol,
    },
    deployer: deployer.address,
    timestamp,
    txHash: vault.deploymentTransaction()?.hash,
  };

  // Save deployment result
  const deploymentDir = path.join(__dirname, '../../deployments');
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  const filename = `savings-vault-${network.name}-${timestamp}.json`;
  fs.writeFileSync(path.join(deploymentDir, filename), JSON.stringify(deploymentInfo, null, 2));

  console.log(`Deployment info saved to: ${filename}`);

  // Wait for block confirmations and verify on live networks
  if (network.name !== 'hardhat' && network.name !== 'localhost') {
    console.log('Waiting for block confirmations...');
    const deploymentTx = vault.deploymentTransaction();
    if (deploymentTx) {
      await deploymentTx.wait(5);
    }

    // Verify contract on Etherscan
    console.log('Verifying contract on Etherscan...');
    try {
      await hre.run('verify:verify', {
        address: vaultAddress,
        constructorArguments: [
          networkConfig.deuro,
          networkConfig.savings,
          vaultMetadata.name,
          vaultMetadata.symbol,
        ],
      });
      console.log('Contract verified successfully');
    } catch (error: any) {
      if (error.message.includes('Already Verified')) {
        console.log('Contract is already verified');
      } else {
        console.error('Verification failed:', error.message);
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Deployment error:', error);
    process.exit(1);
  });
