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
    juiceDollar: '0x0987D3720D38847ac6dBB9D025B9dE892a3CA35C',
    equity: '0x2A36f2b204B46Fd82653cd06d00c7fF757C99ae4',
    // V2
    frontendGateway: '0x3090a89A1fF5DC99117BE655599e5491A0BaBB92',
    savingsGateway: '0x22FE239892eBC8805DA8f05eD3bc6aF75332b60b',
    savingsVaultV2: '0x1b70ae756b1089cc5948e4f8a2AD498DF30E897d',
    mintingHubGateway: '0x1a20B160bf546774246C7920939E6e7Ac0f88b8e',
    rollerV2: '0xC1b97398c06B9C6a49Fd9dCFAC8907700301e9Ac',
    positionFactoryV2: '0x107eDf5f030d724bD0C73f88A300bEA09AE581e2',
    genesisPosition: '0xe8c97614Ac1A5Ac0e8aB2d0e04b4B315817ecb36',
    // V3
    savings: '0x6347a7Ec9Cf3D04CD853425a9857513C600EaA94',
    mintingHub: '0x0f0164a5D9556C64bA879622C71732f3525C183A',
    savingsVaultV3: '0xD6d874968882d01fff6712e639f3F7e19bDA6523',
    rollerV3: '0x7E2Bc47C49E73340bB7d00bB1E972125cF76A54d',
    positionFactoryV3: '0x37E45AceF1E1fEF03697440682329FFc84e9310E',
    // Bridges
    bridgeStartUSD: '0x51ff8141D731676Fb21aE1E5D5A88c04511994dD',
    bridgeUSDC: '0x920DB0aDf6fEe2D69401e9f68D60319177dCa20F',
    bridgeUSDT: '0x5CC0e668F8BA61E111B6168E19d17d3C65040614',
    bridgeCTUSD: '0x8D11020286aF9ecf7E5D7bD79699c391b224a0bd',
    startUSD: '0xD41ab73aF9c7324b9c7c6e63dE1aeC666d98bc80',
    USDC: '0xE045e6c36cF77FAA2CfB54466D71A3aEF7bbE839',
    USDT: '0x9f3096Bac87e7F03DC09b0B416eB0DF837304dc4',
    CTUSD: '0x8D82c4E3c936C7B5724A382a9c5a4E6Eb7aB6d5D',
  },
  5115: {
    juiceDollar: '0x6a850a548fdd050e8961223ec8FfCDfacEa57E39',
    equity: '0x7fa131991c8A7d8C21b11391C977Fc7c4c8e0D5E',
    // V2
    frontendGateway: '0xd824b7d36594Fc3088B1D91a79F34931AA2a15D0',
    savingsGateway: '0x54430781b33581CE2b0DBD837CA66113BeEEFD8e',
    savingsVaultV2: '0x802a29bD29f02c8C477Af5362f9ba88FAe39Cc7B',
    mintingHubGateway: '0x5fC684074fBaAE37Eb68d3e48D85f485CE5060F8',
    rollerV2: '0x8A50329559Ae3F2BaA1fC8BC59Fcd52958c61caC',
    positionFactoryV2: '0x2990c3219ED2763685D4420f5513feEa8991a7ee',
    genesisPosition: '0x236375455eBDF941a83Ecda3eECaf2288B6A0f40',
    // V3 (to be populated after deployment)
    savings: zeroAddress,
    mintingHub: zeroAddress,
    savingsVaultV3: zeroAddress,
    rollerV3: zeroAddress,
    positionFactoryV3: zeroAddress,
    // Bridges
    bridgeStartUSD: '0x9ba2264bE7695044f59B9ca863E69aC38B3c913d',
    startUSD: '0x8398da4C32eAE51b9840da230095Bb29f4179390',
  },
};
