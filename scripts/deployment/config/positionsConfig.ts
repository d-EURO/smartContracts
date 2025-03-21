export interface PositionsConfig {
  openingFee: string;
  positions: {
    name: string;
    collateralAddress: string;
    decimals: number;
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
  }[];
}

// Folgende Collaterals sind verfügbar zu Start: 		  Contract Address	                          Decimals	Initialization Period (days)	Minimum Collateral	Initial Collateral	Global Minting Limit	Risk Premium	Maturity (months)	Liquidation Price	  Retained Reserve	  Auction Duration (hours)
// LsETH	                                            0x8c1BEd5b9a0928467c9B1341Da1D7BD5e10b6549	      18	                          3	                4.00	              4.00	            200’000	            5%	                6		          1’250	               20%	                        48
// WETH	                                            	0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2	      18	                          3	                4.00	              4.00	            200’000	            5%	                6		          1’250	               20%	                        48
// WBTC	                                            	0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599	       8	                          3	                0.10	              0.10	          2’000’000	            2%	                6	 	      60’000.00	               10%	                        48
// cbBTC	                                            0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf	       8	                          3	                0.10	              0.10	            200’000	            2%	                6	 	      60’000.00	               10%	                        48
// kBTC	                                            	0x73E0C0d45E048D25Fc26Fa3159b0aA04BfA4Db98	       8	                          3	                0.10	              0.10	            200’000	            2%	                6	 	      60’000.00	               10%	                        48
// USDT	                                           	  0xdAC17F958D2ee523a2206206994597C13D831ec7	       6	                          3	            6’250.00	          6’250.00	            200’000	            2%	                6	             0.80	               10%	                        48
// USDC	                                           	  0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48	       6	                          3	            6’250.00	          6’250.00	            200’000	            2%	                6	             0.80	               10%	                        48
// LINK	                                           	  0x514910771AF9Ca656af840dff83E8264EcF986CA	      18	                          3	              500.00	            500.00	            200’000	            5%	                6	            10.00	               20%	                        48
// UNI	                                           	  0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984	      18	                          3	            1’250.00	          1’250.00	            200’000	            5%	                6	             4.00	               20%	                        48
// DAI	                                           	  0x6B175474E89094C44Da98b954EedeAC495271d0F	      18	                          3	          6’250.0000	        6’250.0000	            200’000	            2%	                6	             0.80	               10%	                        48
// XAUt	                                             	0x68749665FF8D2d112Fa859AA293F07A622782F38	       6	                          3	                2.50	              2.50	            200’000	            5%	                6		       2’000.00	               20%	                        48
// ZCHF	                                           	  0xB58E61C3098d85632Df34EecfB899A1Ed80921cB	      18	                          3	            5’000.00	          5’000.00	            200’000	            2%	                6	            1.000	               10%	                        48
// WFPS	                                            	0x5052D3Cc819f53116641e89b96Ff4cD1EE80B182	       0	                          3	                4.00	              4.00	          1’000’000	            2%	                6		          1’450	               10%	                        48
// DEPS	                                            	0x103747924E74708139a9400e4Ab4BEA79FFFA380	      18	                          3	           50’000.00	         50’000.00	          1’000’000	           10%	                6		           0.10	               20%	                        48

export const config: PositionsConfig = {
  openingFee: '1000',
  positions: [
    {
      name: 'LsETH-Position',
      collateralAddress: '0x8c1BEd5b9a0928467c9B1341Da1D7BD5e10b6549',
      decimals: 18,
      minCollateral: '4', // ETH
      initialCollateral: '4', // ETH
      mintingMaximum: '200000', // EUR
      initPeriodSeconds: 259200, // 3 days
      expirationSeconds: 15552000, // 180 days
      challengeSeconds: 172800, // 2 days
      riskPremiumPPM: 50000, // 5%
      liqPrice: '1250', // EUR
      reservePPM: 200000, // 20%
    },
    {
      name: 'WETH-Position',
      collateralAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      decimals: 18,
      minCollateral: '4', // ETH
      initialCollateral: '4', // ETH
      mintingMaximum: '200000', // EUR
      initPeriodSeconds: 259200, // 3 days
      expirationSeconds: 15552000, // 180 days
      challengeSeconds: 172800, // 2 days
      riskPremiumPPM: 50000, // 5%
      liqPrice: '1250', // EUR
      reservePPM: 200000, // 20%
    },
    {
      name: 'WBTC-Position',
      collateralAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      decimals: 8,
      minCollateral: '0.1', // BTC
      initialCollateral: '0.1', // BTC
      mintingMaximum: '2000000', // EUR
      initPeriodSeconds: 259200, // 3 days
      expirationSeconds: 15552000, // 180 days
      challengeSeconds: 172800, // 2 days
      riskPremiumPPM: 20000, // 2%
      liqPrice: '60000', // EUR
      reservePPM: 100000, // 10%
    },
    {
      name: 'cbBTC-Position',
      collateralAddress: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
      decimals: 8,
      minCollateral: '0.1', // BTC
      initialCollateral: '0.1', // BTC
      mintingMaximum: '200000', // EUR
      initPeriodSeconds: 259200, // 3 days
      expirationSeconds: 15552000, // 180 days
      challengeSeconds: 172800, // 2 days
      riskPremiumPPM: 20000, // 2%
      liqPrice: '60000', // EUR
      reservePPM: 100000, // 10%
    },
    {
      name: 'kBTC-Position',
      collateralAddress: '0x73E0C0d45E048D25Fc26Fa3159b0aA04BfA4Db98',
      decimals: 8,
      minCollateral: '0.1', // BTC
      initialCollateral: '0.1', // BTC
      mintingMaximum: '200000', // EUR
      initPeriodSeconds: 259200, // 3 days
      expirationSeconds: 15552000, // 180 days
      challengeSeconds: 172800, // 2 days
      riskPremiumPPM: 20000, // 2%
      liqPrice: '60000', // EUR
      reservePPM: 100000, // 10%
    },
    // {
    //   name: 'USDT-Position', // REVIEW: Fails with "contract call run out of gas"
    //   collateralAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    //   decimals: 6,
    //   minCollateral: '6250', // USDT
    //   initialCollateral: '6250', // USDT
    //   mintingMaximum: '200000', // EUR
    //   initPeriodSeconds: 259200, // 3 days
    //   expirationSeconds: 15552000, // 180 days
    //   challengeSeconds: 172800, // 2 days
    //   riskPremiumPPM: 20000, // 2%
    //   liqPrice: '0.8', // EUR
    //   reservePPM: 100000, // 10%
    // },
    {
      name: 'USDC-Position',
      collateralAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      decimals: 6,
      minCollateral: '6250', // USDC
      initialCollateral: '6250', // USDC
      mintingMaximum: '200000', // EUR
      initPeriodSeconds: 259200, // 3 days
      expirationSeconds: 15552000, // 180 days
      challengeSeconds: 172800, // 2 days
      riskPremiumPPM: 20000, // 2%
      liqPrice: '0.8', // EUR
      reservePPM: 100000, // 10%
    },
    // {
    //   name: 'LINK-Position', // REVIEW: Fails with "contract call run out of gas"
    //   collateralAddress: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
    //   decimals: 18,
    //   minCollateral: '500', // LINK
    //   initialCollateral: '500', // LINK
    //   mintingMaximum: '200000', // EUR
    //   initPeriodSeconds: 259200, // 3 days
    //   expirationSeconds: 15552000, // 180 days
    //   challengeSeconds: 172800, // 2 days
    //   riskPremiumPPM: 50000, // 5%
    //   liqPrice: '10', // EUR
    //   reservePPM: 200000, // 20%
    // },
    {
      name: 'UNI-Position',
      collateralAddress: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
      decimals: 18,
      minCollateral: '1250', // UNI
      initialCollateral: '1250', // UNI
      mintingMaximum: '200000', // EUR
      initPeriodSeconds: 259200, // 3 days
      expirationSeconds: 15552000, // 180 days
      challengeSeconds: 172800, // 2 days
      riskPremiumPPM: 50000, // 5%
      liqPrice: '4', // EUR
      reservePPM: 200000, // 20%
    },
    {
      name: 'DAI-Position',
      collateralAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      decimals: 18,
      minCollateral: '6250', // DAI
      initialCollateral: '6250', // DAI
      mintingMaximum: '200000', // EUR
      initPeriodSeconds: 259200, // 3 days
      expirationSeconds: 15552000, // 180 days
      challengeSeconds: 172800, // 2 days
      riskPremiumPPM: 20000, // 2%
      liqPrice: '0.8', // EUR
      reservePPM: 100000, // 10%
    },
    {
      name: 'XAUt-Position',
      collateralAddress: '0x68749665FF8D2d112Fa859AA293F07A622782F38',
      decimals: 6,
      minCollateral: '2.5', // XAUt
      initialCollateral: '2.5', // XAUt
      mintingMaximum: '200000', // EUR
      initPeriodSeconds: 259200, // 3 days
      expirationSeconds: 15552000, // 180 days
      challengeSeconds: 172800, // 2 days
      riskPremiumPPM: 50000, // 5%
      liqPrice: '2000', // EUR
      reservePPM: 200000, // 20%
    },
    {
      name: 'ZCHF-Position',
      collateralAddress: '0xB58E61C3098d85632Df34EecfB899A1Ed80921cB',
      decimals: 18,
      minCollateral: '5000', // ZCHF
      initialCollateral: '5000', // ZCHF
      mintingMaximum: '200000', // EUR
      initPeriodSeconds: 259200, // 3 days
      expirationSeconds: 15552000, // 180 days
      challengeSeconds: 172800, // 2 days
      riskPremiumPPM: 20000, // 2%
      liqPrice: '1', // EUR
      reservePPM: 100000, // 10%
    },
    {
      name: 'WFPS-Position',
      collateralAddress: '0x5052D3Cc819f53116641e89b96Ff4cD1EE80B182',
      decimals: 0,
      minCollateral: '4', // WFPS
      initialCollateral: '4', // WFPS
      mintingMaximum: '1000000', // EUR
      initPeriodSeconds: 259200, // 3 days
      expirationSeconds: 15552000, // 180 days
      challengeSeconds: 172800, // 2 days
      riskPremiumPPM: 20000, // 2%
      liqPrice: '1450', // EUR
      reservePPM: 100000, // 10%
    },
    {
      name: 'DEPS-Position',
      collateralAddress: '0x103747924E74708139a9400e4Ab4BEA79FFFA380',
      decimals: 18,
      minCollateral: '50000', // DEPS
      initialCollateral: '50000', // DEPS
      mintingMaximum: '1000000', // EUR
      initPeriodSeconds: 259200, // 3 days
      expirationSeconds: 15552000, // 180 days
      challengeSeconds: 172800, // 2 days
      riskPremiumPPM: 100000, // 10%
      liqPrice: '0.1', // EUR
      reservePPM: 200000, // 20%
    },
  ],
};
