import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { DeploymentAddresses } from '../monitoring/types';

dotenv.config();

export interface DeploymentData {
  network: string;
  blockNumber: number;
  deployer: string;
  contracts: {
    [contractName: string]: {
      address: string;
      constructorArgs: any[];
    };
  };
  timestamp: number;
}

export function loadFileJSON(filePath: string) {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

// Get the address of a contract deployed by Flashbots
export function getContractAddress(contractName: string): string {
  if (!process.env.FLASHBOTS_DEPLOYMENT_PATH) {
    throw new Error('FLASHBOTS_DEPLOYMENT_PATH environment variable not set');
  }

  const deployment = loadFileJSON(process.env.FLASHBOTS_DEPLOYMENT_PATH);
  const contractData = deployment.contracts[contractName] as { address: string; constructorArgs: any[] };
  return contractData.address;
}

export function getDeployer(): string {
  if (!process.env.FLASHBOTS_DEPLOYMENT_PATH) {
    throw new Error('FLASHBOTS_DEPLOYMENT_PATH environment variable not set');
  }

  const deployment = loadFileJSON(process.env.FLASHBOTS_DEPLOYMENT_PATH);
  return deployment.deployer;
}

export function getFullDeployment(): DeploymentData {
  if (!process.env.FLASHBOTS_DEPLOYMENT_PATH) {
    throw new Error('FLASHBOTS_DEPLOYMENT_PATH environment variable not set');
  }

  return loadFileJSON(process.env.FLASHBOTS_DEPLOYMENT_PATH);
}

export function getDeploymentAddresses(): DeploymentAddresses {
  if (!process.env.FLASHBOTS_DEPLOYMENT_PATH) {
    throw new Error('FLASHBOTS_DEPLOYMENT_PATH environment variable not set');
  }

  const deployment = getFullDeployment();
  return {
    deployer: deployment.deployer,
    ...Object.fromEntries(Object.entries(deployment.contracts).map(([name, data]) => [name, data.address])),
  } as DeploymentAddresses;
}
