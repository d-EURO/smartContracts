import { mainnet, polygon } from "viem/chains";
import { Address, zeroAddress } from "viem";

export interface ChainAddress {
  decentralizedEURO: Address;
  equity: Address;
  frontendGateway: Address;
  savingsGateway: Address;
  mintingHubGateway: Address;
  DEPSwrapper: Address;
  bridgeEURT: Address;
  bridgeEURS: Address;
  bridgeVEUR: Address;
  bridgeEURC: Address;
  eurt: Address;
  eurs: Address;
  veur: Address;
  eurc: Address;
  roller: Address;
  positionFactoryV2: Address;
}

export const ADDRESS: Record<number, ChainAddress> = {
  [mainnet.id]: {
    // native contract addresses
    decentralizedEURO: "0xbA3f535bbCcCcA2A154b573Ca6c5A49BAAE0a3ea",
    equity: "0xc71104001A3CCDA1BEf1177d765831Bd1bfE8eE6",
    frontendGateway: "0x5c49C00f897bD970d964BFB8c3065ae65a180994",
    savingsGateway: "0x073493d73258C4BEb6542e8dd3e1b2891C972303",
    mintingHubGateway: "0x8B3c41c649B9c7085C171CbB82337889b3604618",
    DEPSwrapper: "0x103747924E74708139a9400e4Ab4BEA79FFFA380",
    bridgeEURT: "0x2353D16869F717BFCD22DaBc0ADbf4Dca62C609f",
    bridgeEURS: "0x0423F419De1c44151B6b000e2dAA51859C1D5d2A",
    bridgeVEUR: "0x3Ed40fA0E5C803e807eBD51355E388006f9E1fEE",
    bridgeEURC: "0xD03cD3ea55e67bC61b78a0d70eE93018e2182Dbe",
    eurt: "0xC581b735A1688071A1746c968e0798D642EDE491",
    eurs: "0xdb25f211ab05b1c97d595516f45794528a807ad8",
    veur: "0x6ba75d640bebfe5da1197bb5a2aff3327789b5d3",
    eurc: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
    roller: "0x4CE0AB2FC21Bd27a47A64F594Fdf7654Ea57Dc79",
    positionFactoryV2: "0x167144d66AC1D02EAAFCa3649ef3305ea31Ee5A8",
  },
};
