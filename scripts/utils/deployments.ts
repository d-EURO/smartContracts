import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
// import { ethers } from 'hardhat';

dotenv.config();

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
