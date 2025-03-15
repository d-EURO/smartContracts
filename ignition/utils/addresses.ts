import * as fs from 'fs';
import * as path from 'path';

/**
 * Utility functions for retrieving contract addresses from Hardhat Ignition deployments
 */

// Define the structure of deployment addresses
interface DeployedAddresses {
  [contractId: string]: string;
}

/**
 * Read deployed addresses from ignition deployments
 * @param network The network ID (e.g., 'chain-1' for mainnet)
 * @returns Object containing deployed contract addresses
 */
export function getDeployedAddresses(network: string = 'chain-1'): DeployedAddresses {
  try {
    const deploymentPath = path.join(__dirname, '../deployments', network, 'deployed_addresses.json');
    
    if (!fs.existsSync(deploymentPath)) {
      console.warn(`No deployment found at ${deploymentPath}`);
      return {};
    }
    
    return JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  } catch (error) {
    console.error('Error reading deployed addresses:', error);
    return {};
  }
}

/**
 * Get a specific contract address by module name
 * @param moduleName The module name prefix to search for
 * @param network The network ID, defaults to 'chain-1'
 * @returns The contract address or undefined if not found
 */
export function getDeployedAddress(moduleName: string, network: string = 'chain-1'): string {
  const addresses = getDeployedAddresses(network);
  const key = Object.keys(addresses).find(k => k.startsWith(moduleName));
  if (!key) {
    console.warn(`No address found for module: ${moduleName}`);
    return 'NOT_FOUND';
  }
  return addresses[key];
}