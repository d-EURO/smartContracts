export interface FlashbotsConfig {
  maxFeePerGas: string; // in gwei
  maxPriorityFeePerGas: string; // in gwei
  contractDeploymentGasLimit: string;
  contractCallGasLimit: string;
  targetBlockOffset: number;
  coinbasePayment?: string; // in ETH
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface StablecoinBridgeParams {
  other: string;
  limit: string; // in dEURO
  weeks: number;
  applicationMsg: string;
}

export interface ContractsParams {
  decentralizedEURO: {
    minApplicationPeriod: number;
  };
  savingsGateway: {
    initialRatePPM: number;
  };
  bridges: {
    eurt: StablecoinBridgeParams;
    eurc: StablecoinBridgeParams;
    veur: StablecoinBridgeParams;
    eurs: StablecoinBridgeParams;
  };
}

export const flashbotsConfig: FlashbotsConfig = {
  maxFeePerGas: '30',
  maxPriorityFeePerGas: '5',
  contractDeploymentGasLimit: '8000000',
  contractCallGasLimit: '500000',
  targetBlockOffset: 1,
  coinbasePayment: '0.05',  // Pay miners 0.05 ETH to include the bundle
};

export const contractsParams = {
  decentralizedEURO: {
    minApplicationPeriod: 1209600,
  },
  savingsGateway: {
    initialRatePPM: 100000,
  },
  bridges: {
    eurt: {
      other: '0xc581b735a1688071a1746c968e0798d642ede491',
      limit: '1000000000000000000000000',
      weeks: 2,
      applicationMsg: 'EURT Bridge',
    },
    eurc: {
      other: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c',
      limit: '1000000000000000000000000',
      weeks: 30,
      applicationMsg: 'EURC Bridge',
    },
    veur: {
      other: '0x6ba75d640bebfe5da1197bb5a2aff3327789b5d3',
      limit: '1000000000000000000000000',
      weeks: 30,
      applicationMsg: 'VEUR Bridge',
    },
    eurs: {
      other: '0xdb25f211ab05b1c97d595516f45794528a807ad8',
      limit: '1000000000000000000000000',
      weeks: 30,
      applicationMsg: 'EURS Bridge',
    },
  },
};
