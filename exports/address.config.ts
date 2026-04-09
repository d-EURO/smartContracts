import { Address, zeroAddress } from 'viem';

export interface ChainAddress {
  // Shared (already deployed, version-independent)
  juiceDollar: Address;
  equity: Address;

  // V2 (immutable, already deployed on mainnet)
  frontendGateway: Address;
  savingsGateway: Address;
  savingsVaultV2: Address;
  mintingHubGateway: Address;
  rollerV2: Address;
  positionFactoryV2: Address;
  genesisPosition: Address;

  // V3
  savings: Address;
  mintingHub: Address;
  savingsVaultV3: Address;
  rollerV3: Address;
  positionFactoryV3: Address;

  // Bridges
  bridgeStartUSD: Address;
  bridgeUSDC?: Address;
  bridgeUSDT?: Address;
  bridgeCTUSD?: Address;

  // Underlying stablecoin token addresses
  startUSD: Address;
  USDC?: Address;
  USDT?: Address;
  CTUSD?: Address;
}

// Citrea Mainnet Chain ID: 4114
// Citrea Testnet Chain ID: 5115
export const ADDRESS: Record<number, ChainAddress> = {
  4114: {
    // Citrea Mainnet
    juiceDollar: '0x0987D3720d38847AC6dBB9D025B9DE892a3ca35c',
    equity: '0x2a36f2b204B46Fd82653Cd06D00c7ff757C99ae4',
    // V2
    frontendGateway: '0x3090a89A1fF5DC99117Be655599E5491a0baBb92',
    savingsGateway: '0x22fE239892EBc8805Da8f05ed3Bc6af75332b60b',
    savingsVaultV2: '0x1b70ae756b1089CC5948e4F8a2aD498df30e897d',
    mintingHubGateway: '0x1a20b160BF546774246c7920939E6e7AC0F88B8e',
    rollerV2: '0xc1b97398C06b9c6A49fD9dCfaC8907700301e9AC',
    positionFactoryV2: '0x107eDF5f030D724Bd0c73f88a300bEA09ae581e2',
    genesisPosition: '0xe8C97614AC1A5aC0e8Ab2d0E04b4b315817ecb36',
    // V3
    savings: '0x6347A7eC9cF3D04CD853425a9857513c600eaa94',
    mintingHub: '0x0F0164a5D9556c64Ba879622C71732F3525C183A',
    savingsVaultV3: '0xd6d874968882D01Fff6712E639F3f7E19Bda6523',
    rollerV3: '0x7e2bc47C49e73340bB7d00BB1E972125cF76A54d',
    positionFactoryV3: '0x37e45acef1E1fef03697440682329ffC84e9310E',
    // Bridges
    bridgeStartUSD: '0x51ff8141d731676fB21ae1E5D5a88C04511994Dd',
    bridgeUSDC: '0x920Db0ADF6fEE2d69401E9F68D60319177dCa20f',
    bridgeUSDT: '0x5cC0e668F8BA61E111b6168e19d17D3c65040614',
    bridgeCTUSD: '0x8d11020286af9ECf7e5D7Bd79699c391b224a0bD',
    startUSD: '0xD41AB73aF9C7324b9C7C6E63DE1aeC666d98bc80',
    USDC: '0xE045e6C36cf77FAA2cFB54466d71A3aEF7bBe839',
    USDT: '0x9F3096bAc87E7f03dC09B0B416eb0dF837304Dc4',
    CTUSD: '0x8D82c4e3C936c7b5724A382a9c5A4e6eb7Ab6D5d',
  },
  5115: {
    juiceDollar: '0x6a850A548Fdd050E8961223eC8FfCdFaCEA57E39',
    equity: '0x7fA131991C8a7D8c21B11391C977fC7C4C8e0D5e',
    // V2
    frontendGateway: '0xD824b7D36594fc3088B1d91a79f34931Aa2a15d0',
    savingsGateway: '0x54430781b33581cE2B0dBd837ca66113BeEefd8E',
    savingsVaultV2: '0x802A29BD29F02c8c477Af5362f9bA88faE39cc7b',
    mintingHubGateway: '0x5fC684074FBAae37EB68D3E48d85f485cE5060F8',
    rollerV2: '0x8A50329559ae3F2BaA1Fc8bc59FCd52958C61CAc',
    positionFactoryV2: '0x2990C3219ed2763685d4420F5513fEea8991A7EE',
    genesisPosition: '0x236375455EbDf941a83eCda3eEcaF2288B6A0f40',
    // V3 (to be populated after deployment)
    savings: zeroAddress,
    mintingHub: zeroAddress,
    savingsVaultV3: zeroAddress,
    rollerV3: zeroAddress,
    positionFactoryV3: zeroAddress,
    // Bridges
    bridgeStartUSD: '0x9ba2264Be7695044F59B9cA863e69ac38B3c913d',
    startUSD: '0x8398dA4C32eaE51B9840Da230095BB29F4179390',
  },
};
