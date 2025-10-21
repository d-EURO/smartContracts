/**
 * @interface SavingsVaultConfig
 * @property {string} deuro - The address of the DecentralizedEURO token contract
 * @property {string} savings - The address of the Savings contract (SavingsGateway)
 */
export interface SavingsVaultConfig {
  [network: string]: {
    deuro: string;
    savings: string;
  };
}

export const vaultConfig: SavingsVaultConfig = {
  mainnet: {
    deuro: '0xbA3f535bbCcCcA2A154b573Ca6c5A49BAAE0a3ea',
    savings: '0x073493d73258C4BEb6542e8dd3e1b2891C972303',
  },
  hardhat: {
    // For local testing or forking from mainnet
    deuro: '0xbA3f535bbCcCcA2A154b573Ca6c5A49BAAE0a3ea',
    savings: '0x073493d73258C4BEb6542e8dd3e1b2891C972303',
  },
  // Add other networks as needed
  // polygon: {
  //   deuro: '0x...',
  //   savings: '0x...',
  // },
};

export const vaultMetadata = {
  name: 'Savings Vault dEURO',
  symbol: 'svdEURO',
};
