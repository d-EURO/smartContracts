export interface GasConfig {
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

/** Returns network-specific gas configuration (values in gwei). */
export function getGasConfig(networkName: string): GasConfig {
  const configs: Record<string, GasConfig> = {
    hardhat: {
      maxFeePerGas: '10',
      maxPriorityFeePerGas: '1',
    },
    localhost: {
      maxFeePerGas: '10',
      maxPriorityFeePerGas: '1',
    },
    citrea: {
      maxFeePerGas: '0.01',
      maxPriorityFeePerGas: '0.001',
    },
    citreaTestnet: {
      maxFeePerGas: '0.01',
      maxPriorityFeePerGas: '0.001',
    },
  }

  if (!configs[networkName]) {
    console.warn(`Unknown network "${networkName}", falling back to citreaTestnet gas config`);
  }
  return configs[networkName] || configs.citreaTestnet;
}

export const deploymentConstants = {
  contractDeploymentGasLimit: '8000000',
  contractCallGasLimit: '500000',
  targetBlockOffset: 1,
};

export interface StablecoinBridgeParams {
  other: string;
  limit: string; // in JUSD
  weeks: number;
  applicationMsg: string;
}

export interface ContractsParams {
  juiceDollar: {
    minApplicationPeriod: number;
  };
  savingsGateway: {
    initialRatePPM: number;
  };
  bridges: {
    startUSD: StablecoinBridgeParams;
  };
}

export const contractsParams = {
  juiceDollar: {
    minApplicationPeriod: 1209600,
  },
  savingsGateway: {
    initialRatePPM: 100000,
  },
  bridges: {
    startUSD: {
      other: '', // set to StartUSD address during deployment
      limit: '10000000000000000000000', // 10,000 JUSD (18 decimals)
      weeks: 3,
      applicationMsg: 'StartUSD Bridge',
    },
  },
};
