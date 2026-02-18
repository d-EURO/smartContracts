export interface MigrationV3Config {
  [network: string]: {
    decentralizedEURO: string;
    positionRoller: string;
    positionFactory: string;
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
    positionRoller: '0x4CE0AB2FC21Bd27a47A64F594Fdf7654Ea57Dc79',
    positionFactory: '0x167144d66AC1D02EAAFCa3649ef3305ea31Ee5A8',
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  hardhat: {
    // Same as mainnet (for fork testing)
    decentralizedEURO: '0xbA3f535bbCcCcA2A154b573Ca6c5A49BAAE0a3ea',
    positionRoller: '0x4CE0AB2FC21Bd27a47A64F594Fdf7654Ea57Dc79',
    positionFactory: '0x167144d66AC1D02EAAFCa3649ef3305ea31Ee5A8',
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
};

export const migrationV3Params: MigrationV3Params = {
  initialSavingsRatePPM: 80_000, // 8%
  initialLendingRatePPM: 80_000, // 8%
  savingsVaultName: 'Savings Vault dEURO',
  savingsVaultSymbol: 'svdEURO',
};
