interface BridgeConfig {
  mainnetdEURO: string;
  chains: {
    [key: string]: {
      chainId: number;
      bridge: string;
      token: {
        name: string;
        symbol: string;
      };
    };
  };
}

export const bridgingConfig: BridgeConfig = {
  mainnetdEURO: '0xbA3f535bbCcCcA2A154b573Ca6c5A49BAAE0a3ea',
  chains: {
    optimism: {
      chainId: 10,
      bridge: '0x4200000000000000000000000000000000000010',
      token: {
        name: 'Decentralized EURO',
        symbol: 'dEURO',
      },
    },
    base: {
      chainId: 8453,
      bridge: '0x4200000000000000000000000000000000000010',
      token: {
        name: 'Decentralized EURO',
        symbol: 'dEURO',
      },
    },
  },
};
