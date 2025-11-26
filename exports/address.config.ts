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
    juiceDollar: "0x258e525B6F9f62195478fe94d14AE20178AB2545",
    equity: "0xDd965FCdcb4022414204B9BDc5dF949c2761e7Cc",
    frontendGateway: "0xA9DAD130a5744Bc6DBD7151e184352BFfc57BC87",
    savingsGateway: "0x71335aa01FB04C234B7CfA72361d7CdC355fE097",
    savingsVaultJUSD: "0xA049fc273034D44515A81A564c8F43400B3f77B3",
    mintingHubGateway: "0xF2D5F2F3fA1d048284a9d669805478F8ad677e5a",
    coinLendingGateway: "0x16c530290662Dc04Dba3040e5e6EBD8e7D3bfe03",
    bridgeStartUSD: "0x568965b5f8Fa9e6EE56b670e684F85b277545EFE",
    startUSD: "0xD4A183699d0AbCf774b1ea23CDfC0B4b1d5cB30f",
    roller: "0x2017C636AA98c7BAAAa68b48195d31Ef5869e37C",
    positionFactoryV2: "0x171dAe92afc8AC3D581178163a1F993533a94c4B",
  },
};
