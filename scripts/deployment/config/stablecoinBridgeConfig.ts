export interface StablecoinBridgeConfig {
  name: string;
  sourceToken: string;    // Address of source stablecoin
  limitAmount: string;    // Max mint amount in dEURO
  durationWeeks: number;
  description: string;
}

export const bridgeConfigs: Record<string, StablecoinBridgeConfig> = {
  EUROP: {
    name: "StablecoinBridgeEUROP",
    sourceToken: "0x888883b5F5D21fb10Dfeb70e8f9722B9FB0E5E51",
    limitAmount: "100000", // 100'000 limit
    durationWeeks: 26,
    description: "EUROP Bridge"
  },
  EURR: {
    name: "StablecoinBridgeEURR",
    sourceToken: "0x50753CfAf86c094925Bf976f218D043f8791e408",
    limitAmount: "100000", // 100'000 limit
    durationWeeks: 26,
    description: "EURR Bridge"
  },
  EURe: {
    name: "StablecoinBridgeEURe",
    sourceToken: "0x3231Cb76718CDeF2155FC47b5286d82e6eDA273f",
    limitAmount: "100000", // 100'000 limit
    durationWeeks: 26,
    description: "EURe Bridge"
  },
  EURI: {
    name: "StablecoinBridgeEURI",
    sourceToken: "0x9d1A7A3191102e9F900Faa10540837ba84dCBAE7",
    limitAmount: "100000", // 100'000 limit
    durationWeeks: 26,
    description: "EURI Bridge"
  },
  EURA: {
    name: "StablecoinBridgeEURA",
    sourceToken: "0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8",
    limitAmount: "100000", // 100'000 limit
    durationWeeks: 26, // 6 months
    description: "EURA Bridge"
  }
};
