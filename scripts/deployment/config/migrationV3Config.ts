export interface MigrationV3Config {
  [network: string]: {
    decentralizedEURO: string;
    weth: string;
  };
}

export interface MigrationV3Params {
  initialSavingsRatePPM: number;
  initialLendingRatePPM: number;
  savingsVaultName: string;
  savingsVaultSymbol: string;
}

export const migrationV3Config: MigrationV3Config = {
  mainnet: {
    decentralizedEURO: '0xbA3f535bbCcCcA2A154b573Ca6c5A49BAAE0a3ea',
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  hardhat: {
    // Same as mainnet (for fork testing)
    decentralizedEURO: '0xbA3f535bbCcCcA2A154b573Ca6c5A49BAAE0a3ea',
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
};

export const migrationV3Params: MigrationV3Params = {
  initialSavingsRatePPM: 80_000, // 8%
  initialLendingRatePPM: 80_000, // 8%
  savingsVaultName: 'Savings Vault dEURO',
  savingsVaultSymbol: 'svdEURO',
};
