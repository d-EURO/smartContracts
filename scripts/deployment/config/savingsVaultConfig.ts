/**
 * @interface SavingsVaultConfig
 * @property {string} jusd - The address of the JuiceDollar token contract
 * @property {string} savings - The address of the Savings contract (SavingsGateway)
 */
export interface SavingsVaultConfig {
  [network: string]: {
    jusd: string;
    savings: string;
  };
}

// Updated for Citrea deployment
export const vaultConfig: SavingsVaultConfig = {
  citrea: {
    jusd: '0x...', // TODO: Add JuiceDollar address on Citrea
    savings: '0x...', // TODO: Add Savings contract address on Citrea
  },
  citreaTestnet: {
    jusd: '0x1Dd3057888944ff1f914626aB4BD47Dc8b6285Fe',
    savings: '0x13531a4E00B36Fdb5f9f9A7c8C85cBc08Fd8EbDb',
  },
  hardhat: {
    jusd: process.env.JUSD_ADDRESS || '0x...',
    savings: process.env.SAVINGS_ADDRESS || '0x...',
  },
};

export const vaultMetadata = {
  name: 'Savings Vault JUSD',
  symbol: 'svJUSD',
};
