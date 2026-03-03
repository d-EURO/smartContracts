export const migrationV3Config = {
  citrea: {
    juiceDollar: '0x0987D3720D38847ac6dBB9D025B9dE892a3CA35C',
    wcbtc: '0x3100000000000000000000000000000000000006',
  },
  citreaTestnet: {
    juiceDollar: '0x6a850a548fdd050e8961223ec8FfCDfacEa57E39',
    wcbtc: '0x8d0c9d1c17aE5e40ffF9bE350f57840E9E66Cd93',
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
