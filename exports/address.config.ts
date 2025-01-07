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
    decentralizedEURO: "0xd02812Be610952aAFBbbfBcA438887A2f3A5f53B",
    equity: "0xce6d2a10f0144638b4de5A4b3f9cf0f4d07e2eF9",
    frontendGateway: "0x102b572d66BB0fE8651267f1c5d0957c569abfaB",
    savingsGateway: "0x7C82b33251eb78480E6Ca8536D4B9BD4e537cA56",
    mintingHubGateway: "0xa5446505BC6de50658A76F472aEBaa9773230e96",
    DEPSwrapper: "0x102b572d66BB0fE8651267f1c5d0957c569abfaB",
    bridgeEURT: "0xc4DfB4d90Ba1DBa9936eC92d795D47c7e938F96F",
    bridgeEURS: "0x83155A464deF9F3FDd35034bAB0489c5EE26Ec16",
    bridgeVEUR: "0x9099Ead5a4F0734c91344E6371a5D6e6CA8faAbc",
    bridgeEURC: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
    eurt: "0xC581b735A1688071A1746c968e0798D642EDE491",
    eurs: "0xdb25f211ab05b1c97d595516f45794528a807ad8",
    veur: "0x6ba75d640bebfe5da1197bb5a2aff3327789b5d3",
    eurc: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
    roller: "0xa5f63B2A73AaE2F4636F401D3A442082f2D92807",
    positionFactoryV2: "0xeCDE1EF432447ca4504B08DFe0b863BBe5eB62ac",
  },
};
