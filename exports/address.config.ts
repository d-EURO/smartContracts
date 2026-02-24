import { mainnet } from "viem/chains";
import { Address, zeroAddress } from "viem";

export interface ChainAddress {
  // Shared (version-independent)
  decentralizedEURO: Address;
  equity: Address;
  DEPSwrapper: Address;

  // V2 (deployed on mainnet, immutable)
  frontendGateway: Address;
  savingsGateway: Address;
  mintingHubGateway: Address;
  coinLendingGateway: Address;
  rollerV2: Address;
  positionFactoryV2: Address;
  savingsVaultV2: Address;

  // V3 (populate after running deployV3Migration.ts)
  savings: Address;
  mintingHub: Address;
  savingsVaultV3: Address;
  rollerV3: Address;
  positionFactoryV3: Address;

  // Bridges
  bridgeEURT: Address;
  bridgeEURS: Address;
  bridgeVEUR: Address;
  bridgeEURC: Address;
  bridgeEURR: Address;
  bridgeEUROP: Address;
  bridgeEURI: Address;
  bridgeEURE: Address;
  bridgeEURA: Address;

  // Bridge underlying tokens
  eurt: Address;
  eurs: Address;
  veur: Address;
  eurc: Address;
  eurr: Address;
  europ: Address;
  euri: Address;
  eure: Address;
  eura: Address;
}

export const ADDRESS: Record<number, ChainAddress> = {
  [mainnet.id]: {
    // Shared (version-independent)
    decentralizedEURO: "0xbA3f535bbCcCcA2A154b573Ca6c5A49BAAE0a3ea",
    equity: "0xc71104001A3CCDA1BEf1177d765831Bd1bfE8eE6",
    DEPSwrapper: "0x103747924E74708139a9400e4Ab4BEA79FFFA380",

    // V2 (deployed on mainnet, immutable)
    frontendGateway: "0x5c49C00f897bD970d964BFB8c3065ae65a180994",
    savingsGateway: "0x073493d73258C4BEb6542e8dd3e1b2891C972303",
    mintingHubGateway: "0x8B3c41c649B9c7085C171CbB82337889b3604618",
    coinLendingGateway: "0x1DA37D613FB590eeD37520b72e9c6F0F6eee89D2",
    rollerV2: "0x4CE0AB2FC21Bd27a47A64F594Fdf7654Ea57Dc79",
    positionFactoryV2: "0x167144d66AC1D02EAAFCa3649ef3305ea31Ee5A8",
    savingsVaultV2: "0x1e9f008B1C538bE32F190516735bF1C634B4FA40",

    // V3 (populate after running deployV3Migration.ts)
    savings: zeroAddress,
    mintingHub: zeroAddress,
    savingsVaultV3: zeroAddress,
    rollerV3: zeroAddress,
    positionFactoryV3: zeroAddress,

    // Bridges
    bridgeEURT: "0x2353D16869F717BFCD22DaBc0ADbf4Dca62C609f",
    bridgeEURS: "0x73f38ca06b27eaefb1612d062d885f58924f5897",
    bridgeVEUR: "0x76d8f514554a4a8e5d6103875f2dd7a67543692b",
    bridgeEURC: "0xB4fF7412f08C22d7381885e8BdA9EE9825092fd1",
    bridgeEURR: "0x20B0a153fF16c7B1e962FD3D3352A00cf019f1a7",
    bridgeEUROP: "0x3EF3d03EFCc1338d6210946f8cF5Fb1a8b630341",
    bridgeEURI: "0xb66A40934a996373fA7602de9820C6bf3e8c9afE",
    bridgeEURE: "0x4dfd460d54854087af195906a2f260aa483a13b1",
    bridgeEURA: "0x05620F4bB92246b4e067EBC0B6f5c7FF6B771702",

    // Bridge underlying tokens
    eurt: "0xC581b735A1688071A1746c968e0798D642EDE491",
    eurs: "0xdb25f211ab05b1c97d595516f45794528a807ad8",
    veur: "0x6ba75d640bebfe5da1197bb5a2aff3327789b5d3",
    eurc: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
    eurr: "0x50753CfAf86c094925Bf976f218D043f8791e408",
    europ: "0x888883b5F5D21fb10Dfeb70e8f9722B9FB0E5E51",
    euri: "0x9d1A7A3191102e9F900Faa10540837ba84dCBAE7",
    eure: "0x3231Cb76718CDeF2155FC47b5286d82e6eDA273f",
    eura: "0x1a7e4e63778b4f12a199c062f3efdd288afcbce8",
  },
};
