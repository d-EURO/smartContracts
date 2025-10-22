export interface StablecoinBridgeConfig {
  name: string;
  sourceToken: string;    // Address of source stablecoin (set during deployment for Citrea)
  limitAmount: string;    // Max mint amount in JUSD
  durationWeeks: number;
  description: string;
}

export const bridgeConfigs: Record<string, StablecoinBridgeConfig> = {
  USDT: {
    name: "StablecoinBridgeUSDT",
    sourceToken: "0x0000000000000000000000000000000000000000", // ⚠️ TODO: Get official USDT contract address on Citrea
    limitAmount: "1000000000000000000000000", // 1'000'000 JUSD (18 decimals) - Max bridge capacity
    durationWeeks: 52, // 1 year
    description: "USDT ↔ JUSD Bridge (1:1 swap) - Citrea Mainnet"
  }
};
