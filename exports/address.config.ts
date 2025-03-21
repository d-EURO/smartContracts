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
    decentralizedEURO: "0xA96400A20Eaa76b7204903982BC911Da33e4f841",
    equity: "0xF75a8093f6eb7164877c5Ea253977c4635039Acc",
    frontendGateway: "0x37DF135C6382f2b5fb7aA271f1102F98945FB6CC",
    savingsGateway: "0x79906ea064aF95e3f3C0B615F641e01D14fEf008",
    mintingHubGateway: "0x182b0171Be4f650853dB8F6E8D9462f12AC05263",
    DEPSwrapper: "0xEb344853Ed400942eC79ad55b065a981572739C2",
    bridgeEURT: "0xb5eB755a5a21C264Bb55700573508CbEc1EC3988",
    bridgeEURS: "0x7aF28F2A749CCb0556EDB21eeD0eA2fDeBB6A3fa",
    bridgeVEUR: "0xC0B8Fd2118725eD58dD4303228609A35490aF471",
    bridgeEURC: "0x27Aa0E82A21F7D542e33428bbFe15BeD258C0691",
    eurt: "0xC581b735A1688071A1746c968e0798D642EDE491",
    eurs: "0xdb25f211ab05b1c97d595516f45794528a807ad8",
    veur: "0x6ba75d640bebfe5da1197bb5a2aff3327789b5d3",
    eurc: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
    roller: "0x1432B572aeD8507E8b5d4Fd87c986dDfad46148e",
    positionFactoryV2: "0x5FFb38d41a07550B2Db18cEf284ec7c14be61833",
  },
};
