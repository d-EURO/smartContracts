import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Contract } from "ethers";
import { confirmAndProceed } from "../utils";

export const deployContract = async (
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  args?: any[],
  verbose = true
): Promise<Contract> => {
  const {
    deployments: { deploy, log },
    getNamedAccounts,
    network,
    ethers,
  } = hre;

  const { deployer } = await getNamedAccounts();

  if (process.env.CONFIRM_DEPLOYMENT === "true") {
    await confirmAndProceed(deployer, network, contractName, args);
  }

  const deployment = await deploy(contractName, {
    from: deployer,
    args: args,
    log: true,
  });


  if (verbose) {
    log(`Contract ${contractName} deployed to: ${deployment.address} with args: ${args}`);
  }

  return ethers.getContractAt(contractName, deployment.address);
};