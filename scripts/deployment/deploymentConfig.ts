import { floatToDec18 } from "../math";

export interface DecentralizedEUROConfig {
    name: string;
    minApplicationPeriod: number;
  }
  
  export interface SavingsGatewayConfig {
    name: string;
    initialRatePPM: number;
  }
  
  export interface BridgeConfig {
    name: string;
    other: string;
    limit: bigint;
    weeks: number;
    applicationMsg: string;
  }
  
  export interface StablecoinBridgeConfig {
    name: string;
    bridges: BridgeConfig[];
  }
  
  export interface DeploymentConfig {
    decentralizedEURO: { [chainId: string]: DecentralizedEUROConfig };
    savingsGateway: { [chainId: string]: SavingsGatewayConfig };
    stablecoinBridge: { [chainId: string]: StablecoinBridgeConfig };
  }
  
  export const deploymentConfig: DeploymentConfig = {
    decentralizedEURO: {
      "1": {
        name: "mainnet",
        minApplicationPeriod: 1209600, // 14 days
      },
      "31337": {
        name: "local",
        minApplicationPeriod: 900,
      },
      "11155111": {
        name: "sepolia",
        minApplicationPeriod: 900,
      },
    },
    savingsGateway: {
      "1": {
        name: "mainnet",
        initialRatePPM: 100000, // 10% per year
      },
      "31337": {
        name: "local",
        initialRatePPM: 100000,
      },
      "11155111": {
        name: "sepolia",
        initialRatePPM: 100000,
      },
    },
    stablecoinBridge: {
      "1": {
        name: "mainnet",
        bridges: [
          {
            name: "EURT",
            other: "0xc581b735a1688071a1746c968e0798d642ede491",
            limit: floatToDec18(5000),
            weeks: 30,
            applicationMsg: "EURT Bridge",
          },
          {
            name: "EURC",
            other: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
            limit: floatToDec18(500),
            weeks: 30,
            applicationMsg: "EURC Bridge",
          },
          {
            name: "VEUR",
            other: "0x6ba75d640bebfe5da1197bb5a2aff3327789b5d3",
            limit: floatToDec18(500),
            weeks: 30,
            applicationMsg: "VEUR Bridge",
          },
          {
            name: "EURS",
            other: "0xdb25f211ab05b1c97d595516f45794528a807ad8",
            limit: floatToDec18(500),
            weeks: 30,
            applicationMsg: "EURS Bridge",
          },
        ],
      },
    },
  };