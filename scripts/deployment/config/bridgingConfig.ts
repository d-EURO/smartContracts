/**
 * @interface BridgeConfig
 * @property {number} chainId - The chain ID of the network.
 * @property {string} bridge - The address of the bridge contract on the network.
 */
export interface BridgeConfig {
  [key: string]: {
    chainId: number;
    bridge: string;
  };
}

/**
 * @interface TokenConfig
 * @property {string} remote - The address of the token contract on the remote network, e.g. Ethereum mainnet.
 * @property {string} name - The name of the token.
 * @property {string} symbol - The symbol of the token.
 */
export interface TokenConfig {
  [key: string]: {
    remote: string;
    name: string;
    symbol: string;
  };
}

export const bridgeConfig: BridgeConfig = {
  optimism: {
    chainId: 10,
    bridge: '0x4200000000000000000000000000000000000010',
  },
  base: {
    chainId: 8453,
    bridge: '0x4200000000000000000000000000000000000010',
  },
};

export const tokenConfig: TokenConfig = {
  deuro: {
    remote: '0xbA3f535bbCcCcA2A154b573Ca6c5A49BAAE0a3ea',
    name: 'Decentralized EURO',
    symbol: 'dEURO',
  },
  deps: {
    remote: '0x103747924E74708139a9400e4Ab4BEA79FFFA380',
    name: 'Decentralized Euro Protocol Share',
    symbol: 'DEPS',
  },
};
