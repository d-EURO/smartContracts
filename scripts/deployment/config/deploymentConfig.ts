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
  };

  if (!configs[networkName]) {
    console.warn(`Unknown network "${networkName}", falling back to citreaTestnet gas config`);
  }
  return configs[networkName] || configs.citreaTestnet;
}

export const deploymentConstants = {
  contractDeploymentGasLimit: '8000000',
  contractCallGasLimit: '300000', // Standard contract calls (transfer, approve, etc.)
  investCallGasLimit: '500000', // Investment operations with complex math (cubic root)
  openPositionGasLimit: '5000000', // Position creation (deploys new contract)
  targetBlockOffset: 1,
};

export interface StablecoinBridgeParams {
  limit: string; // in JUSD (18 decimals)
  weeks: number;
  applicationMsg: string;
}

export interface GenesisPositionParams {
  minCollateral: string; // Minimum collateral (wei)
  initialCollateral: string; // Initial collateral to deposit (wei)
  mintingMaximum: string; // Maximum JUSD that can be minted (wei)
  initPeriodSeconds: number; // Initial period in seconds
  expirationSeconds: number; // Position duration in seconds
  challengeSeconds: number; // Challenge period in seconds
  riskPremiumPPM: number; // Risk premium in PPM (e.g., 10000 = 1%)
  liquidationPrice: string; // Liquidation price (wei, 18 decimals)
  reservePPM: number; // Reserve contribution in PPM (e.g., 200000 = 20%)
  initialMintAmount: string; // Initial JUSD loan to mint (wei, 18 decimals)
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
    USDC_E: StablecoinBridgeParams;
    USDT_E: StablecoinBridgeParams;
    CT_USD: StablecoinBridgeParams;
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
      limit: '100000000000000000000000000', // 100,000,000 JUSD (18 decimals)
      weeks: 6,
      applicationMsg: 'StartUSD Bridge',
    },
    USDC_E: {
      limit: '100000000000000000000000000', // 100,000,000 JUSD (18 decimals)
      weeks: 208, // 4 years
      applicationMsg: 'USDC.e Bridge (LayerZero)',
    },
    USDT_E: {
      limit: '100000000000000000000000000', // 100,000,000 JUSD (18 decimals)
      weeks: 208, // 4 years
      applicationMsg: 'USDT.e Bridge (LayerZero)',
    },
    CT_USD: {
      limit: '100000000000000000000000000', // 100,000,000 JUSD (18 decimals)
      weeks: 208, // 4 years
      applicationMsg: 'ctUSD Bridge (M^0 Protocol)',
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
    minCollateral: '2000000000000000', // 0.002 cBTC (100 JUSD mintable at 50k liq price)
    initialCollateral: '2000000000000000', // 0.002 cBTC
    mintingMaximum: '100000000000000000000000000', // 100,000,000 JUSD
    // Genesis position init period must be > 0 to bypass the price-doubling check in Position._setPrice().
    // With initPeriodSeconds: 0, the check `block.timestamp >= start` is true during construction,
    // causing PriceTooHigh(newPrice, 0) since price is uninitialized. Any value > 0 makes start
    // be in the future, bypassing the check. The deployment script waits this many seconds before minting.
    initPeriodSeconds: 20,
    expirationSeconds: 31536000, // 12 months (365 days)
    challengeSeconds: 86400, // 1 day
    riskPremiumPPM: 0, // 0% (no risk premium)
    liquidationPrice: '50000000000000000000000', // 50,000 JUSD/cBTC (18 decimals)
    reservePPM: 200000, // 20%
    initialMintAmount: '50000000000000000000', // 50 JUSD initial loan
  },
};
