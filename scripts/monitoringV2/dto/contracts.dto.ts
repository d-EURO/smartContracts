import { ethers } from "ethers";

export interface ContractSet {
  deuroContract: ethers.Contract;
  equityContract: ethers.Contract;
  depsContract: ethers.Contract;
  savingsContract: ethers.Contract;
  frontendGatewayContract: ethers.Contract;
  mintingHubContract: ethers.Contract;
  rollerContract: ethers.Contract;
}