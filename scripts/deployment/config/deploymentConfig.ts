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
  contractCallGasLimit: '300000',        // Standard contract calls (transfer, approve, etc.)
  investCallGasLimit: '500000',          // Investment operations with complex math (cubic root)
  openPositionGasLimit: '5000000',       // Position creation (deploys new contract)
  targetBlockOffset: 1,
};

export interface StablecoinBridgeParams {
  other: string;
  limit: string; // in JUSD
  weeks: number;
  applicationMsg: string;
}

export interface GenesisPositionParams {
  minCollateral: string;          // Minimum collateral (wei)
  initialCollateral: string;      // Initial collateral to deposit (wei)
  mintingMaximum: string;         // Maximum JUSD that can be minted (wei)
  initPeriodSeconds: number;      // Initial period in seconds
  expirationSeconds: number;      // Position duration in seconds
  challengeSeconds: number;       // Challenge period in seconds
  riskPremiumPPM: number;         // Risk premium in PPM (e.g., 10000 = 1%)
  liquidationPrice: string;       // Liquidation price (wei, 18 decimals)
  reservePPM: number;             // Reserve contribution in PPM (e.g., 200000 = 20%)
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
  initialInvestment: {
    firstInvestment: string;
    batchInvestments: {
      count: number;
      amountPerBatch: string;
    };
  };
  genesisPosition: GenesisPositionParams;
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
      limit: '100000000000000000000000000', // 100,000,000 JUSD (18 decimals)
      weeks: 6,
      applicationMsg: 'StartUSD Bridge',
    },
  },
  initialInvestment: {
    firstInvestment: '1000000000000000000000', // 1,000 JUSD (18 decimals)
    batchInvestments: {
      count: 40,
      amountPerBatch: '50000000000000000000000', // 50,000 JUSD (18 decimals)
    },
  },
  genesisPosition: {
    minCollateral: '2000000000000000',              // 0.002 cBTC (100 JUSD mintable at 50k liq price)
    initialCollateral: '2000000000000000',          // 0.002 cBTC
    mintingMaximum: '100000000000000000000000000',  // 100,000,000 JUSD
    initPeriodSeconds: 259200,                      // 3 days
    expirationSeconds: 31536000,                    // 12 months (365 days)
    challengeSeconds: 86400,                        // 1 day
    riskPremiumPPM: 0,                              // 0% (no risk premium)
    liquidationPrice: '50000000000000000000000',    // 50,000 JUSD/cBTC (18 decimals)
    reservePPM: 200000,                             // 20%
  },
};
