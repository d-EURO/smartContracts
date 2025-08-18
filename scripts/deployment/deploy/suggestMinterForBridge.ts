import { ethers } from 'hardhat';
import { formatUnits } from 'ethers';
import dotenv from 'dotenv';
import { getContractAddress } from '../../utils/deployments';

dotenv.config();

/**
 * Suggests a deployed bridge as a minter for dEURO
 * @usage BRIDGE_ADDRESS=<ADDRESS> DESCRIPTION="<DESCRIPTION>" npx hardhat run scripts/deployment/deploy/suggestMinterForBridge.ts --network <NETWORK>
 */
async function suggestMinterForBridge() {
  try {
    const [deployer] = await ethers.getSigners();
    console.log('\nDeployer:', deployer.address);

    const bridgeAddress = process.env.BRIDGE_ADDRESS;
    if (!bridgeAddress) {
      console.error('Missing BRIDGE_ADDRESS environment variable');
      process.exit(1);
    }

    const description = process.env.DESCRIPTION || 'Bridge Minter';
    
    console.log(`Bridge address: ${bridgeAddress}`);
    console.log(`Description: ${description}`);

    // Get dEURO contract
    const dEuroAddress = getContractAddress('decentralizedEURO');
    const dEURO = await ethers.getContractAt('DecentralizedEURO', dEuroAddress);
    const dEuroDecimals = await dEURO.decimals();

    // Get required parameters
    const minFee = await dEURO.MIN_FEE();
    const minApplicationPeriod = await dEURO.MIN_APPLICATION_PERIOD();
    const deployerBalance = await dEURO.balanceOf(deployer.address);

    console.log(`\n----------------------------------------\n`);
    console.log(`dEURO address: ${dEuroAddress}`);
    console.log(`Required minimum fee: ${formatUnits(minFee, Number(dEuroDecimals))} dEURO`);
    console.log(`Application period: ${Math.floor(Number(minApplicationPeriod) / 86400)} days`);
    console.log(`Deployer balance: ${formatUnits(deployerBalance, Number(dEuroDecimals))} dEURO`);

    if (deployerBalance < minFee) {
      throw new Error('Insufficient dEURO balance for suggestMinter fee');
    }

    // Approve dEURO to spend the fee
    console.log(`\nApproving dEURO to spend ${formatUnits(minFee, Number(dEuroDecimals))} dEURO from deployer...`);
    const approveTx = await dEURO.approve(dEuroAddress, minFee);
    await approveTx.wait();
    console.log(`Approval transaction completed: ${approveTx.hash}`);

    // Call suggestMinter
    console.log(`\nCalling suggestMinter for bridge ${bridgeAddress}...`);
    const suggestMinterTx = await dEURO.suggestMinter(bridgeAddress, minApplicationPeriod, minFee, description);
    console.log(`suggestMinter transaction sent: ${suggestMinterTx.hash}`);

    const receipt = await suggestMinterTx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error('Minter initialization failed');
    }

    console.log('\nBridge successfully suggested as a minter!');
    console.log(`Transaction hash: ${suggestMinterTx.hash}`);
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

suggestMinterForBridge()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });