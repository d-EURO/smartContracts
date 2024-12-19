import { mainnet, polygon } from "viem/chains";
import { Address, zeroAddress } from "viem";

export interface ChainAddress {
  decentralizedEURO: Address;
  equity: Address;
  frontendGateway: Address;
  DEPSwrapper: Address;
  bridgeEURT: Address;
  bridgeEURS: Address;
  bridgeVEUR: Address;
  bridgeEURC: Address;
  eurt: Address;
  eurs: Address;
  veur: Address;
  eurc: Address;
  savings: Address;
  roller: Address;
  mintingHubV2: Address;
  positionFactoryV2: Address;
}

export const ADDRESS: Record<number, ChainAddress> = {
  [mainnet.id]: {
    // natice contract addresses
    decentralizedEURO: "0x37688530bEf38711d600Ee5773C21Cc27C49A2Aa",
    equity: "0x06ef81036432f64F622F635248903ADF59cc5497",
    frontendGateway: "0xB937f6BCA7a0A139fedca4F8E047314B5FE64B5F",
    DEPSwrapper: "0x0dBc2ceCCCA86E234383443485980e6c4620bA9f",
    bridgeEURT: "0x332867B0ED0DD30d2E9eA0925D5302baaa3A5172",
    bridgeEURS: "0xa44a6296cDdc467400B4C55042f13cFa1234A8C3",
    bridgeVEUR: "0xEF6bb16c1e7e85e15C6363Dcdf85e64fdb64d77C",
    bridgeEURC: "0x9411aCdB64F015285B5767D3E1d7d12D5598228D",
    eurt: "0xC581b735A1688071A1746c968e0798D642EDE491",
    eurs: "0xdb25f211ab05b1c97d595516f45794528a807ad8",
    veur: "0x6ba75d640bebfe5da1197bb5a2aff3327789b5d3",
    eurc: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
    savings: "0xF55F2d6679CF712F62B6C034aBF7060A170EC127",
    roller: "0x85A6Ef336b169Fc3E1B3537EA9eCC91f6556d1C6",
    mintingHubV2: "0xeB6368970BcF74423908dd76230d738cAb00609c",
    positionFactoryV2: "0x86Db50A14B35f71C2D81A0Ae19eB20503587F596",
  },
};
