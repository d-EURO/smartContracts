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
    juiceDollar: "0x0D511a9C1662924dd8f9c12D2Bd72B0264E48583",
    equity: "0x8FF9be291A44CA3E7b45361bf6bbE1aCd0135c06",
    frontendGateway: "0x6721aC661e52C6BA092debb6cc33Ee58F1a4D10A",
    savingsGateway: "0xC638D446072416Aa1760A73748D291Af9f3925cB",
    savingsVaultJUSD: "0x4bD31350f611b469bA7fCC2c5945aAEBefD7A191",
    mintingHubGateway: "0x44B0727688F1839c2BF7b74686F04Cba0CfE89D6",
    bridgeStartUSD: "0x8d149f42C8F73F9fC90e2CbED8eE0644e8837623",
    startUSD: "0xf65BF14763699C08F9ff11e9Dc6706DdEB69b5b9",
    roller: "0xD09CeBBac7cA43430A505CA7A78123D83d53Af39",
    positionFactoryV2: "0xD6673d8Fc25094579Ae23802957e9084860F5d1a",
  },
};
