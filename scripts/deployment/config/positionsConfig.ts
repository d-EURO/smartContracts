// Citrea Deployment Configuration
// Network: Citrea Mainnet (chainId 4114)
// Collateral: Wrapped cBTC (WcBTC) only
//
// NOTE: Update collateralAddress when deploying to different networks:
// - Mainnet (4114): 0x3100000000000000000000000000000000000006
// - Testnet (5115): 0x8d0c9d1c17aE5e40ffF9bE350f57840E9E66Cd93

export interface PositionsConfig {
  openingFee: string;
  positions: {
    name: string;
    collateralAddress: string;
    minCollateral: string;
    initialCollateral: string;
    mintingMaximum: string;
    initPeriodSeconds: number;
    expirationSeconds: number;
    challengeSeconds: number;
    riskPremiumPPM: number;
    liqPrice: string;
    reservePPM: number;
    frontendCode?: string;
    deploy?: boolean;
  }[];
}

// Example position configuration
// Update collateralAddress with actual Citrea token addresses before deployment
export const config: PositionsConfig = {
  openingFee: '1000', // 1000 JUSD opening fee
  positions: [
    {
      name: 'WcBTC-Position',
      collateralAddress: '0x3100000000000000000000000000000000000006', // WCBTC on Citrea Mainnet (chainId 4114)
      minCollateral: '0.002', // 0.002 BTC (~$200 at $100k/BTC) - matches genesis position
      initialCollateral: '0.002', // 0.002 BTC
      mintingMaximum: '10000000', // 10M JUSD maximum
      initPeriodSeconds: 259200, // 3 days initialization period
      expirationSeconds: 15552000, // 180 days (6 months)
      challengeSeconds: 172800, // 2 days challenge period
      riskPremiumPPM: 30000, // 3% risk premium
      liqPrice: '90000', // $90,000 per BTC liquidation price
      reservePPM: 150000, // 15% reserve requirement
      deploy: true, // Deploy this position
    },
  ],
};
