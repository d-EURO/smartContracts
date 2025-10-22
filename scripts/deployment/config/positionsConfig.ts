// Citrea Deployment Configuration
// Network: Citrea (native coin: cBTC for gas fees)
// Collateral: Wrapped cBTC (WcBTC) only

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
      collateralAddress: '0x0000000000000000000000000000000000000000', // TODO: Add Wrapped cBTC address on Citrea
      minCollateral: '0.01', // 0.01 BTC (~$1,000 at $100k/BTC)
      initialCollateral: '0.01', // 0.01 BTC
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
