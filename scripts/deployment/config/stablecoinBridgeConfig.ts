export interface StablecoinBridgeConfig {
  name: string;
  sourceToken: string;    // Address of source stablecoin
  limitAmount: string;    // Max mint amount in JUSD
  durationWeeks: number;
  description: string;
}

export const bridgeConfigs: Record<string, StablecoinBridgeConfig> = {
  StartUSD: {
    name: "StablecoinBridgeStartUSD",
    sourceToken: "", // Set to StartUSD address during deployment
    limitAmount: "10000", // 10'000 limit
    durationWeeks: 3,
    description: "StartUSD Bridge"
  }
};
