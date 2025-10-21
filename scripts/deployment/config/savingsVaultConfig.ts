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
    jusd: '0x0000000000000000000000000000000000000000', // TODO: Update after JuiceDollar deployment
    savings: '0x0000000000000000000000000000000000000000', // TODO: Update after SavingsGateway deployment
  },
  hardhat: {
    // For local testing
    jusd: '0x0000000000000000000000000000000000000000',
    savings: '0x0000000000000000000000000000000000000000',
  },
};

export const vaultMetadata = {
  name: 'Savings Vault JUSD',
  symbol: 'svJUSD',
};
