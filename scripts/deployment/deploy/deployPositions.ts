import { ethers } from 'hardhat';
import { config } from '../config/positionsConfig';
import { getContractAddress } from '../../utils/deployments'; // Flashbots deployment
// import { await getFlashbotDeploymentAddress } from '../../ignition/utils/addresses'; // Hardhat Ignition
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
    frontendCode: string;
  };
  txHash: string;
}

// Deploy positions
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('\nDeployer:          ', deployer.address);

  // Load config file
  const mintingHubGatewayAddress = await getContractAddress('mintingHubGateway');
  const dEuroAddress = await getContractAddress('decentralizedEURO');
  const openingFee = ethers.parseEther(config.openingFee); // dEURO has 18 decimals
  const positionsToDeploy = config.positions.filter((p) => p.deploy);
  console.log('MintingHubGateway: ', mintingHubGatewayAddress);
  console.log('DecentralizedEURO: ', dEuroAddress);
  console.log(`\nFound ${positionsToDeploy.length} positions to deploy.`);

  // Get contracts
  const dEuro = await ethers.getContractAt('DecentralizedEURO', dEuroAddress);
  const dEuroConnected = dEuro.connect(deployer);
  const mintingHubGateway = await ethers.getContractAt('MintingHubGateway', mintingHubGatewayAddress);
  const mintingHubGatewayConnected = mintingHubGateway.connect(deployer);

  // Before proceding, check MintingHubGateway is deployed (sanity check)
  if ((await ethers.provider.getCode(mintingHubGatewayAddress)) === '0x') {
    throw new Error(`MintingHubGateway contract not deployed at address: ${mintingHubGatewayAddress}`);
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
      const currentCollateralAllowance = await collateralToken.allowance(deployer.address, mintingHubGatewayAddress);
      if (currentCollateralAllowance < initialCollateral) {
        console.log(`- Approving collateral token transfer...`);
        const collateralApproveTx = await collateralToken.approve(mintingHubGatewayAddress, initialCollateral);
        await collateralApproveTx.wait();
        console.log(`  ✓ Collateral approval confirmed (tx: ${collateralApproveTx.hash})`);
      }

      // dEURO
      const currentDEuroAllowance = await dEuroConnected.allowance(deployer.address, mintingHubGatewayAddress);
      if (currentDEuroAllowance < openingFee) {
        console.log(`- Approving dEURO fee payment...`);
        const dEuroApproveTx = await dEuroConnected.approve(mintingHubGatewayAddress, openingFee);
        await dEuroApproveTx.wait();
        console.log(`  ✓ dEURO approval confirmed (tx: ${dEuroApproveTx.hash})`);
      }

      // Open position
      const tx = await mintingHubGateway[
        'openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24,bytes32)'
      ](
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
        position.frontendCode ?? ethers.ZeroHash,
      );

      console.log(`TX hash: ${tx.hash}`);

      // Connect to the position
      const receipt = await tx.wait();
      const event = receipt?.logs
        .map((log) => mintingHubGatewayConnected.interface.parseLog({ topics: [...log.topics], data: log.data }))
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
          frontendCode: position.frontendCode ?? ethers.ZeroHash,
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
 * You may need to delete the ignition deployment artifacts to avoid errors.
 */
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
