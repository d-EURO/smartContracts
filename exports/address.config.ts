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
  genesisPosition: Address;
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
    genesisPosition: zeroAddress,
  },
  5115: {
    juiceDollar: "0xFdB0a83d94CD65151148a131167Eb499Cb85d015",
    equity: "0x7b2A560bf72B0Dd2EAbE3271F829C2597c8420d5",
    frontendGateway: "0x3EB394f950abf90aC78127C0f4c78545E0eD3DFe",
    savingsGateway: "0xbfE44EE0471D0cF4759B97A458240f26c2D340Ca",
    savingsVaultJUSD: "0x9580498224551E3f2e3A04330a684BF025111C53",
    mintingHubGateway: "0x372368ca530B4d55622c24E28F0347e26caDc64A",
    bridgeStartUSD: "0x25F8599Be1D25501212b20bD72DF1caA97b496b1",
    startUSD: "0xDFa3153E1eDa84F966BD01bc4C6D9A4FF36AcAeA",
    roller: "0x09d24251654e5B89d5fcd35d087f0CB4163471aC",
    positionFactoryV2: "0xB22a0701237a226d17aE0C4FE8263Edf5Be5f20d",
    genesisPosition: "0xE2D4Ca089457ECfabF89F472568eac4e94b21d8C",
  },
};
