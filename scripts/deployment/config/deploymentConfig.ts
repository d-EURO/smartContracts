export interface DeploymentConfig {
  maxFeePerGas: string; // in gwei
  maxPriorityFeePerGas: string; // in gwei
  contractDeploymentGasLimit: string;
  contractCallGasLimit: string;
  targetBlockOffset: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

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

export const deploymentConfig: DeploymentConfig = {
  maxFeePerGas: '30',
  maxPriorityFeePerGas: '5',
  contractDeploymentGasLimit: '8000000',
  contractCallGasLimit: '500000',
  targetBlockOffset: 1,
};

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
