/**
 * Configuration for additional StablecoinBridge deployments
 *
 * NOTE: The bootstrap bridge (StartUSD → JUSD) is deployed via scripts/deployment/deployProtocol.ts
 * This config is for deploying additional external stablecoin bridges after initial deployment.
 *
 * To deploy a new bridge:
 * 1. Add configuration below
 * 2. Deploy: BRIDGE_KEY=<KEY> npx hardhat run scripts/deployment/deploy/deployBridge.ts --network citrea
 */

export interface StablecoinBridgeConfig {
  name: string;
  sourceToken: string;    // Address of source stablecoin on Citrea
  limitAmount: string;    // Max mint amount in JUSD (18 decimals)
  durationWeeks: number;  // Bridge expiration duration
  description: string;
}

export const bridgeConfigs: Record<string, StablecoinBridgeConfig> = {
  // Template for future external stablecoin bridges:
  // USDT: {
  //   name: "StablecoinBridgeUSDT",
  //   sourceToken: "0x...", // Official USDT address on Citrea
  //   limitAmount: "1000000000000000000000000", // 1M JUSD
  //   durationWeeks: 52, // 1 year
  //   description: "USDT ↔ JUSD Bridge (1:1 swap)"
  // }
};
