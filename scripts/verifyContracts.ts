import { verifyContract, loadFileJSON } from './utils/utils';

// npx hardhat doesn't support additional command line arguments
const deploymentFile = 'scripts/deployments/deployment-1742285128378.json';

async function main() {
  const deployment = await loadFileJSON(deploymentFile);
  for (const [contractName, contractData] of Object.entries(deployment.contracts)) {
    const { address, constructorArgs } = contractData as { address: string; constructorArgs: any[] };

    await verifyContract(contractName, address, constructorArgs);

    // avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log('\n✅ Contract verification process completed!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error in verification script:', error);
    process.exit(1);
  });
