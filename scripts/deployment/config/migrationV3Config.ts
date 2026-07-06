export const migrationV3Config = {
  citrea: {
    juiceDollar: '0x0987D3720D38847ac6dBB9D025B9dE892a3CA35C',
    wcbtc: '0x3100000000000000000000000000000000000006',
  },
  hardhat: {
    juiceDollar: '0x0987D3720D38847ac6dBB9D025B9dE892a3CA35C',
    wcbtc: '0x3100000000000000000000000000000000000006',
  },
};

export const migrationV3Params = {
  initialSavingsRatePPM: 100_000, // 10%
  initialLendingRatePPM: 100_000, // 10%
  savingsVaultName: 'Savings Vault JUSD',
  savingsVaultSymbol: 'svJUSD',
};
