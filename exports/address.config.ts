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
    // natice contract addresses
    decentralizedEURO: "0xe56E05a3E1375a147C122E5883667e57159485e6",
    equity: "0xE80bC6275aEF1FC9664E5CFCFA2e2d92f342ec93",
    frontendGateway: "0x4693ed9c9ACfeF5df8E7D9c8F97d5eEBf406e7C7",
    savingsGateway: "0x9ae5ca00c7f1af085225720c905f15c020a753a3",
    mintingHubGateway: "0x404aa0a74352dbe270e0497af39ecb890ec7716c",
    DEPSwrapper: "0x19e75FE85FFbB5785C879e91E82156703D1a4207",
    bridgeEURT: "0x1cb856645c82c874f391855a421dd58c8339e054",
    bridgeEURS: "0x6bcdb5e4fdad13d0d7a31a0a2f2b1ae812e83eb6",
    bridgeVEUR: "0x1ab98d5eb0722757549584066ea7bd512f6df819",
    bridgeEURC: "0xc0ebb8ce7b9fb1bf4d6c3e705c7b081f8d871140",
    eurt: "0xC581b735A1688071A1746c968e0798D642EDE491",
    eurs: "0xdb25f211ab05b1c97d595516f45794528a807ad8",
    veur: "0x6ba75d640bebfe5da1197bb5a2aff3327789b5d3",
    eurc: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
    roller: "0x5ddfb59ac12cabe7e443220222e6cdd4187651ca",
    positionFactoryV2: "0x5f57ae8222c1b8a56c808af91a6d1171f1e0859a",
  },
};
