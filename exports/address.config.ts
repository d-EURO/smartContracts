import { Address, zeroAddress } from "viem";

export interface ChainAddress {
  juiceDollar: Address;
  equity: Address;
  frontendGateway: Address;
  savingsGateway: Address;
  savingsVaultJUSD: Address;
  mintingHubGateway: Address;
  coinLendingGateway: Address;
  bridgeUSDT: Address;
  usdt: Address;
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
    bridgeUSDT: zeroAddress,
    usdt: zeroAddress,
    roller: zeroAddress,
    positionFactoryV2: zeroAddress,
  },
  5115: {
    // Citrea Testnet - TODO: Add deployed contract addresses
    juiceDollar: zeroAddress,
    equity: zeroAddress,
    frontendGateway: zeroAddress,
    savingsGateway: zeroAddress,
    savingsVaultJUSD: zeroAddress,
    mintingHubGateway: zeroAddress,
    coinLendingGateway: zeroAddress,
    bridgeUSDT: zeroAddress,
    usdt: zeroAddress,
    roller: zeroAddress,
    positionFactoryV2: zeroAddress,
  },
};
