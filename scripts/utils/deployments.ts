import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export interface DeploymentAddresses {
  deployer: string;
  [contractName: string]: string;
}

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

// Get the address of a deployed contract from the deployment JSON file
export function getContractAddress(contractName: string): string {
  if (!process.env.DEPLOYMENT_FILE_PATH) {
    throw new Error('DEPLOYMENT_FILE_PATH environment variable not set');
  }

  const deployment = loadFileJSON(process.env.DEPLOYMENT_FILE_PATH);
  const contractData = deployment.contracts[contractName] as { address: string; constructorArgs: any[] };
  return contractData.address;
}

export function getDeployer(): string {
  if (!process.env.DEPLOYMENT_FILE_PATH) {
    throw new Error('DEPLOYMENT_FILE_PATH environment variable not set');
  }

  const deployment = loadFileJSON(process.env.DEPLOYMENT_FILE_PATH);
  return deployment.deployment.deployedBy;
}

export function getFullDeployment(): DeploymentData {
  if (!process.env.DEPLOYMENT_FILE_PATH) {
    throw new Error('DEPLOYMENT_FILE_PATH environment variable not set');
  }

  return loadFileJSON(process.env.DEPLOYMENT_FILE_PATH);
}

export function getDeploymentAddresses(): DeploymentAddresses {
  if (!process.env.DEPLOYMENT_FILE_PATH) {
    throw new Error('DEPLOYMENT_FILE_PATH environment variable not set');
  }

  const deployment = loadFileJSON(process.env.DEPLOYMENT_FILE_PATH);
  return {
    deployer: deployment.deployment.deployedBy,
    ...Object.fromEntries(Object.entries(deployment.contracts).map(([name, data]) => [name, (data as { address: string }).address])),
  } as DeploymentAddresses;
}
