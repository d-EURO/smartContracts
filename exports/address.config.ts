import { Address, zeroAddress } from "viem";

export interface ChainAddress {
  juiceDollar: Address;
  equity: Address;
  frontendGateway: Address;
  savingsGateway: Address;
  savingsVaultJUSD: Address;
  mintingHubGateway: Address;
  bridgeStartUSD: Address;
  startUSD: Address;
  roller: Address;
  positionFactoryV2: Address;
}

// Citrea Mainnet Chain ID: 62831
// Citrea Testnet Chain ID: 5115
export const ADDRESS: Record<number, ChainAddress> = {
  62831: {
    // Citrea Mainnet - TODO: Add deployed contract addresses
    juiceDollar: zeroAddress,
    equity: zeroAddress,
    frontendGateway: zeroAddress,
    savingsGateway: zeroAddress,
    savingsVaultJUSD: zeroAddress,
    mintingHubGateway: zeroAddress,
    bridgeStartUSD: zeroAddress,
    startUSD: zeroAddress,
    roller: zeroAddress,
    positionFactoryV2: zeroAddress,
  },
  5115: {
    juiceDollar: "0x2742bb39221434bbfcac81959C8367fDE5d83ce9",
    equity: "0xD6B9d4600C45eC4388e45A474C1C153828B7C018",
    frontendGateway: "0x52C2d93DAC83Da412D93D035b017486DecCE782A",
    savingsGateway: "0x2e1697e7BaA6CE62B0c36B015B7a5BEC6157B99e",
    savingsVaultJUSD: "0x45DA5a722b591bBce0b87B192d846AB85EFA88d3",
    mintingHubGateway: "0x57c4aB0f9480AC52a58C820a58ad802B0D4c23EB",
    bridgeStartUSD: "0x8c5e5594c05205454BC09487ad53db4e4DB6564D",
    startUSD: "0xa37f823Bd1bae4379265A4fF9cD5a68f402dE2f5",
    roller: "0xB9B5f670A19E345fFb82D91e699a3f917E237f55",
    positionFactoryV2: "0x70dDC84C79B724b247C10BB9a11Bd98c08Ee3C1a",
  },
};
