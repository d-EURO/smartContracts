import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

// External contract addresses and ABIs
import contractAddresses from '../../abis/contractAddresses.json';
import ERC20_ABI from '../../../abi/@openzeppelin/contracts/token/ERC20/ERC20.sol/ERC20.json';
import WETH_ABI from '../../abis/WETH.json';

// Config types
interface PositionConfig {
  name: string;
  collateralAddress: string;
  decimals: number;
  minCollateral: string;
  initialCollateral: string;
  mintingMaximum: string;
  initPeriodSeconds: number;
  expirationSeconds: number;
  challengeSeconds: number;
  riskPremium: number;
  liqPrice: string;
  reservePPM: number;
}

interface Config {
  dEuro: string;
  mintingHubGateway: string;
  openingFee: string;
  positions: PositionConfig[];
}

// Deploy positions
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying positions with account:', deployer.address);

  // Get some WETH
  const wethAddress = contractAddresses['WETH'];
  const weth = new ethers.Contract(wethAddress, WETH_ABI, deployer);
  await weth.deposit({ value: ethers.parseEther('10') });
  const wethBalance = await weth.balanceOf(deployer.address);
  console.log('WETH balance:', ethers.formatEther(wethBalance));

  // Load config file
  const configPath = path.join(__dirname, '../config/configPositions.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Config;
  console.log('Using MintingHubGateway at:', config.mintingHubGateway);
  console.log(`Found ${config.positions.length} position to deploy`);

  // Get contracts
  const dEuro = await ethers.getContractAt('DecentralizedEURO', config.dEuro, deployer);
  const mintingHubGateway = await ethers.getContractAt('MintingHubGateway', config.mintingHubGateway, deployer);
  const openingFee = ethers.parseEther(config.openingFee); // dEURO has 18 decimals

  // Before proceding, check MintingHubGateway is deployed (sanity check)
  if ((await ethers.provider.getCode(config.mintingHubGateway)) === '0x') {
    throw new Error(`MintingHubGateway contract not deployed at address: ${config.mintingHubGateway}`);
  }

  // Deploy each position
  for (const position of config.positions) {
    console.log(`\nDeploying position: ${position.name}`);

    // Position parameters
    const minCollateral = ethers.parseUnits(position.minCollateral, position.decimals);
    const initialCollateral = ethers.parseUnits(position.initialCollateral, position.decimals);
    const liqPrice = ethers.parseEther(position.liqPrice); // dEURO has 18 decimals
    const mintingMaximum = ethers.parseEther(position.mintingMaximum); // dEURO has 18 decimals
    const expirationTime = Math.floor(Date.now() / 1000) + position.expirationSeconds;
    console.log(`- Collateral: ${position.collateralAddress}`);
    console.log(`- Min Collateral: ${position.minCollateral} (${minCollateral})`);
    console.log(`- Initial Collateral: ${position.initialCollateral} (${initialCollateral})`);
    console.log(`- Liq Price: ${position.liqPrice} (${liqPrice})`);
    console.log(`- Minting Maximum: ${position.mintingMaximum} dEURO`);
    console.log(`- Expiration: ${new Date(expirationTime * 1000).toISOString()}`);

    try {
      const collateralToken = await ethers.getContractAt(ERC20_ABI, position.collateralAddress);
      await collateralToken.approve(config.mintingHubGateway, initialCollateral);
      await dEuro.approve(config.mintingHubGateway, openingFee);

      // Open position
      const tx = await mintingHubGateway[
        'openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24,bytes32)'
      ](
        position.collateralAddress,
        minCollateral,
        initialCollateral,
        mintingMaximum,
        position.initPeriodSeconds,
        expirationTime,
        position.challengeSeconds,
        position.riskPremium,
        liqPrice,
        position.reservePPM,
        ethers.ZeroHash, // empty frontend code
      );

      console.log(`Transaction submitted: ${tx.hash}`);

      // TODO: Get position address from event and log it
      // event PositionOpened(address indexed owner, address indexed position, address original, address collateral);
      const receipt = await tx.wait();
      console.log('Receipt:', receipt);
    } catch (error) {
      console.error(`Error deploying position ${position.name}:`, error);
    }
  }

  console.log('\nPosition deployment completed');
}

/**
 * @notice Deploys positions based on a config file. When testing locally,
 * make sure USE_FORK=true is set in the .env file to use the forked mainnet network.
 * Then run the following commands:
 * > npx hardhat node
 * > npm run deploy -- --network localhost
 * > npx hardhat run scripts/deployment/deploy/deployPositions.ts --network localhost
 * You may need to delete the ignition deployment artifacts to avoid errors.
 */
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
