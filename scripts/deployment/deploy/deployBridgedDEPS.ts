import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { ethers } from 'hardhat';
import { bridgingDEPSConfig } from '../config/bridgingConfig';

dotenv.config();

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  
  // Make sure we're on a supported network
  if (!bridgingDEPSConfig.chains[network.name]) {
    console.error(`Network ${network.name} not supported. Supported networks: ${Object.keys(bridgingDEPSConfig.chains).join(', ')}`);
    process.exit(1);
  }
  
  const networkConfig = bridgingDEPSConfig.chains[network.name];
  const bridgeAddress = networkConfig.bridge;

  console.log(`Connected to ${network.name} (chainId: ${network.chainId})`);
  console.log(`Using bridge address: ${bridgeAddress}`);
  console.log(`Using deployer address: ${deployer.address}`);

  // Deploy the BridgedDEPS contract
  console.log('Deploying BridgedDEPS...');
  const bridgedDEPSFactory = await ethers.getContractFactory('BridgedDEPS');
  const bridgedDEPS = await bridgedDEPSFactory.deploy(
    bridgeAddress,
    bridgingDEPSConfig.mainnetDEPS,
    networkConfig.token.name,
    networkConfig.token.symbol,
  );
  
  await bridgedDEPS.waitForDeployment();
  const bridgedAddress = await bridgedDEPS.getAddress();
  console.log(`BridgedDEPS deployed to: ${bridgedAddress}`);

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: Number(network.chainId),
    bridgedToken: {
      address: bridgedAddress,
      remoteToken: bridgingDEPSConfig.mainnetDEPS,
      bridge: bridgeAddress,
      name: networkConfig.token.name,
      symbol: networkConfig.token.symbol,
    },
    deployer: deployer.address,
    timestamp: Date.now()
  };
  
  // Save deployment result
  const deploymentDir = path.join(__dirname, '../../deployments');
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }
  
  const filename = `bridged-${network.name}-${Date.now()}.json`;
  fs.writeFileSync(
    path.join(deploymentDir, filename),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log(`Deployment info saved to: ${filename}`);
  
  // Display verification command
  console.log(`\nTo verify contract on Etherscan/Blockscout:`);
  console.log(`npx hardhat verify --network ${network.name} ${bridgedAddress} ${bridgeAddress} ${bridgingDEPSConfig.mainnetDEPS} "${networkConfig.token.name}" "${networkConfig.token.symbol}"`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Deployment error:', error);
    process.exit(1);
  });
