import fs from 'fs';
import path from 'path';
import { run } from 'hardhat';
import dotenv from 'dotenv';
dotenv.config();

export async function verifyContract(name: string, address: string, constructorArgs: any[]) {
  console.log(`\nVerifying ${name} at ${address}...`);

  try {
    await run('verify:verify', {
      address: address,
      constructorArguments: constructorArgs,
      force: true,
    });
    console.log(`✓ ${name} verified successfully!`);
  } catch (error: any) {
    if (error.message.includes('Already Verified')) {
      console.log(`${name} is already verified.`);
    } else {
      console.error(`✗ Error verifying ${name}:`, error.message);
    }
  }
}

export async function loadFileJSON(filePath: string) {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

// Get the address of a contract deployed by Flashbots
export async function getFlashbotDeploymentAddress(contractName: string): Promise<string> {
  if (!process.env.FLASHBOTS_DEPLOYMENT_PATH) {
    throw new Error('FLASHBOTS_DEPLOYMENT_PATH environment variable not set');
  }

  const deployment = await loadFileJSON(process.env.FLASHBOTS_DEPLOYMENT_PATH);
  const contractData = deployment.contracts[contractName] as { address: string; constructorArgs: any[] };
  return contractData.address;
}
