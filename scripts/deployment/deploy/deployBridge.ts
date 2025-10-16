import { ethers } from 'hardhat';
import { parseUnits, formatUnits } from 'ethers';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getContractAddress } from '../../utils/deployments';
import { bridgeConfigs } from '../config/stablecoinBridgeConfig';

dotenv.config();

/**
 * Deploys a StablecoinBridge contract for a specified stablecoin.
 * @usage BRIDGE_KEY=<KEY> npx hardhat run scripts/deployment/deploy/deployBridge.ts --network <NETWORK>
 * Run with USE_FORK=true in .env and --network hardhat to use a forked mainnet network for testing.
 */
async function deployBridge() {
  try {
    const [deployer] = await ethers.getSigners();
    console.log('\nDeployer:', deployer.address);

    const bridgeKey = process.env.BRIDGE_KEY;
    if (!bridgeKey || !bridgeConfigs[bridgeKey]) {
      console.error(`Invalid or missing BRIDGE_KEY. Available options: ${Object.keys(bridgeConfigs).join(', ')}`);
      process.exit(1);
    }

    const config = bridgeConfigs[bridgeKey];
    console.log(`Deploying ${config.name}...`);
    try {
      const sourceToken = await ethers.getContractAt('ERC20', config.sourceToken);
      const sourceTokenName = await sourceToken.name();
      const sourceTokenSymbol = await sourceToken.symbol();
      const sourceTokenDecimals = await sourceToken.decimals();
      console.log(`Source token validated: ${sourceTokenName} (${sourceTokenSymbol}), ${sourceTokenDecimals} decimals`);
    } catch (error) {
      console.error(`Failed to validate source token at ${config.sourceToken}. Make sure it's a valid ERC20 token.`);
      throw error;
    }

    const dEuroAddress = getContractAddress('decentralizeJUSD');
    const JUSD = await ethers.getContractAt('JuiceDollar', dEuroAddress);
    const dEuroDecimals = await JUSD.decimals();
    const mintLimit = parseUnits(config.limitAmount, Number(dEuroDecimals));
    const StablecoinBridgeFactory = await ethers.getContractFactory('StablecoinBridge');
    console.log(`Deploying bridge for ${config.name}...`);
    console.log(`Source token: ${config.sourceToken}`);
    console.log(`JUSD address: ${dEuroAddress}`);
    console.log(`Limit amount: ${formatUnits(mintLimit, Number(dEuroDecimals))} (${mintLimit.toString()})`);
    console.log(`Duration weeks: ${config.durationWeeks}`);

    const bridge = await StablecoinBridgeFactory.connect(deployer).deploy(
      config.sourceToken,
      dEuroAddress,
      mintLimit,
      config.durationWeeks,
    );

    const deployTxHash = bridge.deploymentTransaction()?.hash;
    console.log(`Bridge deployment transaction sent: ${deployTxHash}`);

    await bridge.waitForDeployment();
    const bridgeAddress = await bridge.getAddress();
    console.log(`Bridge deployed at: ${bridgeAddress}`);
    console.log(`\n----------------------------------------\n`);

    const minFee = await JUSD.MIN_FEE();
    const minApplicationPeriod = await JUSD.MIN_APPLICATION_PERIOD();
    const deployerBalance = await JUSD.balanceOf(deployer.address);
    console.log(`Required minimum fee: ${formatUnits(minFee, Number(dEuroDecimals))} JUSD`);
    console.log(`Application period: ${Math.floor(Number(minApplicationPeriod) / 86400)} days`);
    if (deployerBalance < minFee) throw new Error('Insufficient JUSD balance for suggestMinter fee');

    console.log(`Approving JUSD to spend ${formatUnits(minFee, Number(dEuroDecimals))} JUSD from deployer...`);
    const approveTx = await JUSD.approve(dEuroAddress, minFee);
    await approveTx.wait();
    console.log(`Approval transaction completed: ${approveTx.hash}`);

    const suggestMinterTx = await JUSD.suggestMinter(bridgeAddress, minApplicationPeriod, minFee, config.description);
    console.log(`suggestMinter transaction sent: ${suggestMinterTx.hash}`);

    const receipt = await suggestMinterTx.wait();
    if (!receipt || receipt.status !== 1) throw new Error('Minter initialization failed');
    console.log('Bridge suggested as a minter');

    const network = await ethers.provider.getNetwork();
    const networkName = network.name || `chain-${network.chainId}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const deploymentInfo = {
      network: networkName,
      chainId: network.chainId,
      blockNumber: await ethers.provider.getBlockNumber(),
      deployer: deployer.address,
      bridgeAddress,
      config,
      deploymentTxHash: deployTxHash,
      minterSetupTxHash: suggestMinterTx.hash,
      timestamp: timestamp,
    };

    const deploymentDir = path.join(__dirname, '../../deployments');
    if (!fs.existsSync(deploymentDir)) {
      fs.mkdirSync(deploymentDir, { recursive: true });
    }

    const deploymentFile = path.join(deploymentDir, `bridge-${bridgeKey.toLowerCase()}-${timestamp}.json`);
    fs.writeFileSync(
      deploymentFile,
      JSON.stringify(deploymentInfo, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2),
    );

    console.log(`Deployment information saved to: ${deploymentFile}`);
    console.log(`\nBridge deployment completed successfully!`);
  } catch (error) {
    console.error('Deployment error:', error);
    process.exit(1);
  }
}

deployBridge()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Deployment error:', error);
    process.exit(1);
  });
