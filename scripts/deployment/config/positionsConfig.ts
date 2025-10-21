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
  openingFee: '1000',
  positions: [
    {
      name: 'Example-BTC-Position',
      collateralAddress: '0x0000000000000000000000000000000000000000', // TODO: Replace with actual Citrea BTC token
      minCollateral: '0.1', // BTC
      initialCollateral: '0.1', // BTC
      mintingMaximum: '2000000', // USD
      initPeriodSeconds: 259200, // 3 days
      expirationSeconds: 15552000, // 180 days
      challengeSeconds: 172800, // 2 days
      riskPremiumPPM: 20000, // 2%
      liqPrice: '60000', // USD
      reservePPM: 100000, // 10%
      deploy: false,
    },
  ],
};
