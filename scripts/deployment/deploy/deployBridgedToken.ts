import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { ethers } from 'hardhat';
import { bridgeConfig, tokenConfig } from '../config/bridgingConfig';

dotenv.config();
const token = process.env.BRIDGED_TOKEN || 'MISSING_TOKEN';

/**
 * @description Deploys a bridged token contract on the specified network.
 * @usage BRIDGED_TOKEN=<token> npx hardhat run scripts/deployment/deploy/deployBridgedToken.ts --network <network>
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  // Make sure we're briding a supported token
  if (!tokenConfig[token]) {
    console.error(`Token ${token} not supported. Supported tokens: ${Object.keys(tokenConfig).join(', ')}`);
    process.exit(1);
  }

  // Make sure we're on a supported network
  if (!bridgeConfig[network.name]) {
    console.error(`Network ${network.name} not supported. Supported networks: ${Object.keys(bridgeConfig).join(', ')}`);
    process.exit(1);
  }

  const bridgedToken = tokenConfig[token];
  const networkConfig = bridgeConfig[network.name];
  const bridgeAddress = networkConfig.bridge;

  console.log(`Connected to ${network.name} (chainId: ${network.chainId})`);
  console.log(`Using bridge address: ${bridgeAddress}`);
  console.log(`Using deployer address: ${deployer.address}`);

  // Deploy the bridged token contract
  console.log('Deploying BridgedToken...');
  const bridgedTokenFactory = await ethers.getContractFactory('BridgedToken');
  const bridgedTokenContract = await bridgedTokenFactory.deploy(
    bridgeAddress,
    bridgedToken.remote,
    bridgedToken.name,
    bridgedToken.symbol,
  );

  await bridgedTokenContract.waitForDeployment();
  const bridgedAddress = await bridgedTokenContract.getAddress();
  console.log(`BridgedToken deployed to: ${bridgedAddress}`);

  // Save deployment info
  const timestamp = Math.floor(Date.now() / 1000);
  const deploymentInfo = {
    network: network.name,
    chainId: Number(network.chainId),
    bridgedToken: {
      address: bridgedAddress,
      remoteToken: bridgedToken.remote,
      bridge: bridgeAddress,
      name: bridgedToken.name,
      symbol: bridgedToken.symbol,
    },
    deployer: deployer.address,
    timestamp,
    txHash: bridgedTokenContract.deploymentTransaction()?.hash,
  };

  // Save deployment result
  const deploymentDir = path.join(__dirname, '../../deployments');
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  const filename = `bridged-${token}-${network.name}-${timestamp}.json`;
  fs.writeFileSync(path.join(deploymentDir, filename), JSON.stringify(deploymentInfo, null, 2));

  console.log(`Deployment info saved to: ${filename}`);

  // Display verification command
  console.log(`\nTo verify contract on Etherscan/Blockscout:`);
  console.log(
    `npx hardhat verify --network ${network.name} ${bridgedAddress} ${bridgeAddress} ${bridgedToken.remote} "${bridgedToken.name}" "${bridgedToken.symbol}"`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Deployment error:', error);
    process.exit(1);
  });
