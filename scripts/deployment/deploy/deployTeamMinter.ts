import { ethers } from 'hardhat';
import hre from 'hardhat';
import { parseUnits, formatUnits } from 'ethers';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getContractAddress } from '../../utils/deployments';

dotenv.config();

/**
 * Deploys the TeamMinter contract — team compensation tokens backed by 50% of equity.
 *
 * Required environment variables:
 *   DEPLOYMENT_FILE_PATH  - Path to the protocol deployment JSON
 *   TOTAL_TEAM_TOKENS     - Number of team tokens to mint (e.g. "50000000")
 *
 * @usage npx hardhat run scripts/deployment/deploy/deployTeamMinter.ts --network <NETWORK>
 */
async function deployTeamMinter() {
  try {
    const [deployer] = await ethers.getSigners();
    console.log('\nDeployer:', deployer.address);

    const totalTokensStr = process.env.TOTAL_TEAM_TOKENS;
    if (!totalTokensStr) throw new Error('TOTAL_TEAM_TOKENS environment variable not set');

    const totalTeamTokens = parseUnits(totalTokensStr, 18);

    const JUSDAddress = getContractAddress('juiceDollar');
    const JUSD = await ethers.getContractAt('JuiceDollar', JUSDAddress);
    const JUSDDecimals = await JUSD.decimals();

    console.log(`\nTeamMinter Configuration:`);
    console.log(`  JUSD address: ${JUSDAddress}`);
    console.log(`  Total team tokens: ${totalTokensStr} TEAM`);
    console.log(`  Claim: 50% of equity, split across all tokens`);

    // Deploy TeamMinter — mints TEAM to deployer
    const TeamMinterFactory = await ethers.getContractFactory('TeamMinter');
    const teamMinter = await TeamMinterFactory.connect(deployer).deploy(
      JUSDAddress,
      totalTeamTokens,
    );

    const deployTxHash = teamMinter.deploymentTransaction()?.hash;
    console.log(`\nTeamMinter deployment transaction sent: ${deployTxHash}`);

    await teamMinter.waitForDeployment();
    const teamMinterAddress = await teamMinter.getAddress();
    console.log(`TeamMinter deployed at: ${teamMinterAddress}`);
    console.log(`\n----------------------------------------\n`);

    // Suggest as minter (needed for distributeProfits)
    const minFee = await JUSD.MIN_FEE();
    const minApplicationPeriod = await JUSD.MIN_APPLICATION_PERIOD();
    const deployerBalance = await JUSD.balanceOf(deployer.address);
    console.log(`Required minimum fee: ${formatUnits(minFee, Number(JUSDDecimals))} JUSD`);
    console.log(`Application period: ${Math.floor(Number(minApplicationPeriod) / 86400)} days`);
    if (deployerBalance < minFee) throw new Error('Insufficient JUSD balance for suggestMinter fee');

    console.log(`Approving JUSD to spend ${formatUnits(minFee, Number(JUSDDecimals))} JUSD from deployer...`);
    const approveTx = await JUSD.approve(JUSDAddress, minFee);
    await approveTx.wait();
    console.log(`Approval transaction completed: ${approveTx.hash}`);

    const suggestMinterTx = await JUSD.suggestMinter(
      teamMinterAddress,
      minApplicationPeriod,
      minFee,
      'TeamMinter: Team compensation backed by 50% of equity',
    );
    console.log(`suggestMinter transaction sent: ${suggestMinterTx.hash}`);

    const receipt = await suggestMinterTx.wait();
    if (!receipt || receipt.status !== 1) throw new Error('suggestMinter failed');
    console.log('TeamMinter suggested as a minter');

    // Save deployment info
    const network = await ethers.provider.getNetwork();
    const networkName = hre.network.name;
    const timestamp = Math.floor(Date.now() / 1000);
    const deploymentInfo = {
      network: networkName,
      chainId: Number(network.chainId),
      blockNumber: await ethers.provider.getBlockNumber(),
      deployer: deployer.address,
      teamMinterAddress,
      config: {
        totalTeamTokens: totalTokensStr,
      },
      deploymentTxHash: deployTxHash,
      minterSetupTxHash: suggestMinterTx.hash,
      timestamp,
    };

    const deploymentDir = path.join(__dirname, '../../../deployments', networkName);
    if (!fs.existsSync(deploymentDir)) {
      fs.mkdirSync(deploymentDir, { recursive: true });
    }

    const deploymentFile = path.join(deploymentDir, `team-minter-${timestamp}.json`);
    fs.writeFileSync(
      deploymentFile,
      JSON.stringify(deploymentInfo, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2),
    );

    console.log(`\nDeployment information saved to: ${deploymentFile}`);
    console.log(`\nNext steps:`);
    console.log(`  1. Wait ${Math.floor(Number(minApplicationPeriod) / 86400)} days for the veto period`);
    console.log(`  2. Distribute TEAM to team members`);
    console.log(`  3. Team members call teamMinter.redeem() when they want JUSD`);
  } catch (error) {
    console.error('Deployment error:', error);
    process.exit(1);
  }
}

deployTeamMinter()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Deployment error:', error);
    process.exit(1);
  });
