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
    decentralizedEURO: "0x8ab29D9Eb5343fE6029158340B462E4ee9caF23A",
    equity: "0xE80bC6275aEF1FC9664E5CFCFA2e2d92f342ec93",
    frontendGateway: "0x8db1CE6BCa7309430219793dA4Afb6742C125FEA",
    savingsGateway: "0x706eCBCD1f0cD0DdCC45D647200d216533aca105",
    mintingHubGateway: "0xB40c299D1cfB09A4e2bAc4EE52bB06b757110780",
    DEPSwrapper: "0x8F74217FdCE9403a06D29116dE2BA0779396214F",
    bridgeEURT: "0x478123B5bb15079e85455e59B865C16DE65A637f",
    bridgeEURS: "0x581DEb59a8c14424895186BaB49BD573e766fEF1",
    bridgeVEUR: "0x70E62B1aC8998622465707E3f110B9E76Ab2CBF3",
    bridgeEURC: "0x0759Fa43C5c103b11D7a62F4F699807a6FE62103",
    eurt: "0xC581b735A1688071A1746c968e0798D642EDE491",
    eurs: "0xdb25f211ab05b1c97d595516f45794528a807ad8",
    veur: "0x6ba75d640bebfe5da1197bb5a2aff3327789b5d3",
    eurc: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
    roller: "0x68887Cd0f3694d29BfCC5Be070802f5de27b9e98",
    positionFactoryV2: "0xdDE23B28007CBcc307976631990B2D831085385d",
  },
};
