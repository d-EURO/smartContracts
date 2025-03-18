import { verifyContract, loadFileJSON } from './utils/utils';
import dotenv from 'dotenv';
dotenv.config();


async function main() {
  if (!process.env.FLASHBOTS_DEPLOYMENT_PATH) {
    console.error('FLASHBOTS_DEPLOYMENT_PATH environment variable not set');
    process.exit(1);
  }

  const deployment = await loadFileJSON(process.env.FLASHBOTS_DEPLOYMENT_PATH);
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
