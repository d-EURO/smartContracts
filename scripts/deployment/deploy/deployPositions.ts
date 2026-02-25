import { ethers } from 'hardhat';
import { zeroAddress } from 'viem';
import { config } from '../config/positionsConfig';
import { ADDRESS } from '../../../exports/address.config';
import fs from 'fs';
import path from 'path';

interface DeployedPosition {
  name: string;
  address: string;
  collateralAddress: string;
  parameters: {
    minCollateral: string;
    initialCollateral: string;
    liqPrice: string;
    mintingMaximum: string;
    initPeriodSeconds: number;
    expirationSeconds: number;
    challengeSeconds: number;
    riskPremium: number;
    reservePPM: number;
  };
  txHash: string;
}

// Deploy positions
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const addresses = ADDRESS[chainId];
  if (!addresses) {
    throw new Error(`No addresses configured for chain ${chainId}`);
  }
  console.log('\nDeployer:          ', deployer.address);

  // Load config file
  const mintingHubAddress = addresses.mintingHub;
  if (mintingHubAddress === zeroAddress) {
    throw new Error('MintingHub address not configured in address.config.ts. Run deployV3Migration.ts first.');
  }
  const dEuroAddress = addresses.decentralizedEURO;
  const openingFee = ethers.parseEther(config.openingFee); // dEURO has 18 decimals
  const positionsToDeploy = config.positions.filter((p) => p.deploy);
  console.log('MintingHub:        ', mintingHubAddress);
  console.log('DecentralizedEURO: ', dEuroAddress);
  console.log(`\nFound ${positionsToDeploy.length} positions to deploy.`);

  // Get contracts
  const dEuro = await ethers.getContractAt('DecentralizedEURO', dEuroAddress);
  const dEuroConnected = dEuro.connect(deployer);
  const mintingHub = await ethers.getContractAt('MintingHub', mintingHubAddress);
  const mintingHubConnected = mintingHub.connect(deployer);

  // Before proceeding, check MintingHub is deployed (sanity check)
  if ((await ethers.provider.getCode(mintingHubAddress)) === '0x') {
    throw new Error(`MintingHub contract not deployed at address: ${mintingHubAddress}`);
  }

  // Store deployed positions data
  const deployedPositions: DeployedPosition[] = [];

  // Deploy each position
  for (const position of positionsToDeploy) {
    if (!position.deploy) {
      console.log(`Skipping ${position.name}.`);
      continue
    }
    console.log(`\nDeploying position: ${position.name}`);

    try {
      const collateralToken = await ethers.getContractAt('ERC20', position.collateralAddress);
      const collateralDecimals = await collateralToken.decimals();

      // Position parameters
      const minCollateral = ethers.parseUnits(position.minCollateral, collateralDecimals);
      const initialCollateral = ethers.parseUnits(position.initialCollateral, collateralDecimals);
      const liqPrice = ethers.parseUnits(position.liqPrice, 36n - collateralDecimals); // price has (36 - collateral decimals) decimals
      const mintingMaximum = ethers.parseEther(position.mintingMaximum); // dEURO has 18 decimals
      console.log(`- Collateral: ${position.collateralAddress}`);
      console.log(`- Min Collateral: ${position.minCollateral} (${minCollateral})`);
      console.log(`- Initial Collateral: ${position.initialCollateral} (${initialCollateral})`);
      console.log(`- Liq Price: ${position.liqPrice} (${liqPrice})`);
      console.log(`- Minting Maximum: ${position.mintingMaximum} dEURO`);
      console.log(`- Expiration: ${new Date(Date.now() + position.expirationSeconds * 1000).toISOString()}`);

      // Collateral
      const currentCollateralAllowance = await collateralToken.allowance(deployer.address, mintingHubAddress);
      if (currentCollateralAllowance < initialCollateral) {
        console.log(`- Approving collateral token transfer...`);
        const collateralApproveTx = await collateralToken.approve(mintingHubAddress, initialCollateral);
        await collateralApproveTx.wait();
        console.log(`  ✓ Collateral approval confirmed (tx: ${collateralApproveTx.hash})`);
      }

      // dEURO
      const currentDEuroAllowance = await dEuroConnected.allowance(deployer.address, mintingHubAddress);
      if (currentDEuroAllowance < openingFee) {
        console.log(`- Approving dEURO fee payment...`);
        const dEuroApproveTx = await dEuroConnected.approve(mintingHubAddress, openingFee);
        await dEuroApproveTx.wait();
        console.log(`  ✓ dEURO approval confirmed (tx: ${dEuroApproveTx.hash})`);
      }

      // Open position
      const tx = await mintingHub.openPosition(
        position.collateralAddress,
        minCollateral,
        initialCollateral,
        mintingMaximum,
        position.initPeriodSeconds,
        position.expirationSeconds,
        position.challengeSeconds,
        position.riskPremiumPPM,
        liqPrice,
        position.reservePPM,
      );

      console.log(`TX hash: ${tx.hash}`);

      // Connect to the position
      const receipt = await tx.wait();
      const event = receipt?.logs
        .map((log) => mintingHubConnected.interface.parseLog({ topics: [...log.topics], data: log.data }))
        .find((parsedLog) => parsedLog?.name === 'PositionOpened');

      if (!event) {
        throw new Error('Position creation event not found');
      }

      const positionAddress = event.args.position || event.args[1];
      console.log(`✓ Opened new position: ${positionAddress}`);

      // Store position data for metadata
      deployedPositions.push({
        name: position.name,
        address: positionAddress,
        collateralAddress: position.collateralAddress,
        parameters: {
          minCollateral: minCollateral.toString(),
          initialCollateral: initialCollateral.toString(),
          liqPrice: liqPrice.toString(),
          mintingMaximum: mintingMaximum.toString(),
          initPeriodSeconds: position.initPeriodSeconds,
          expirationSeconds: position.expirationSeconds,
          challengeSeconds: position.challengeSeconds,
          riskPremium: position.riskPremiumPPM,
          reservePPM: position.reservePPM,
        },
        txHash: tx.hash,
      });
    } catch (error) {
      console.error(`✗ Error deploying position ${position.name}:`, error);
    }
  }

  // Save deployment metadata to file
  if (deployedPositions.length > 0) {
    console.log('\nSaving position deployment metadata to file...');
    const deploymentInfo = {
      network: (await ethers.provider.getNetwork()).name,
      blockNumber: await ethers.provider.getBlockNumber(),
      deployer: deployer.address,
      positions: deployedPositions,
      timestamp: Date.now(),
    };

    const deploymentDir = path.join(__dirname, '../../deployments');
    if (!fs.existsSync(deploymentDir)) {
      fs.mkdirSync(deploymentDir, { recursive: true });
    }

    fs.writeFileSync(
      path.join(deploymentDir, `deployPositions-${Date.now()}.json`),
      JSON.stringify(deploymentInfo, null, 2),
    );
    console.log(`Metadata saved to: ${path.join(deploymentDir, `deployPositions-${Date.now()}.json`)}`);
  }

  console.log('\n✅ Position deployment completed.');
}

/**
 * @notice Deploys positions based on a config file. When testing locally,
 * make sure USE_FORK=true is set in the .env file to use the forked mainnet network.
 * Then run the following commands:
 * > npx hardhat node --no-deploy
 * > npm run deploy -- --network localhost
 * > npx hardhat run scripts/deployment/deploy/deployPositions.ts --network localhost
 */
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
