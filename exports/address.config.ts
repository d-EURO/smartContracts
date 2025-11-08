import { Address, zeroAddress } from "viem";

export interface ChainAddress {
  juiceDollar: Address;
  equity: Address;
  frontendGateway: Address;
  savingsGateway: Address;
  savingsVaultJUSD: Address;
  mintingHubGateway: Address;
  coinLendingGateway: Address;
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
    coinLendingGateway: zeroAddress,
    bridgeStartUSD: zeroAddress,
    startUSD: zeroAddress,
    roller: zeroAddress,
    positionFactoryV2: zeroAddress,
  },
  5115: {
    // Citrea Testnet - Deployed 2025-11-07
    juiceDollar: "0x1Dd3057888944ff1f914626aB4BD47Dc8b6285Fe",
    equity: "0xD82010E94737A4E4C3fc26314326Ff606E2Dcdf4",
    frontendGateway: "0xe8757e121593bBD9f784F196026259085461aB17",
    savingsGateway: "0x13531a4E00B36Fdb5f9f9A7c8C85cBc08Fd8EbDb",
    savingsVaultJUSD: zeroAddress, // Not yet deployed
    mintingHubGateway: "0xFfcD888Eb52F0FdD894fef580370A2FF48d82279",
    coinLendingGateway: zeroAddress, // Not yet deployed
    bridgeStartUSD: "0xFf862f932eB215A9C4aC8F3d20dd6dAe69DeC6D8",
    startUSD: "0xf0229A29172E3541F5578dFC02aa024b3Bdb96A1",
    roller: "0x851FF9f1F5fb7eEf75257aAa0adD2121D6b1Bd49",
    positionFactoryV2: "0x4cc067EfcD6E6386BA8D6fd31c907Cad6C005318",
  },
};
