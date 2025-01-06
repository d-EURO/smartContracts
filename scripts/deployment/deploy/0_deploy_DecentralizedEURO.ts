import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployContract } from "../deployUtils";
import { verify } from "../../verify";
import { getParams } from "../../utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { network } = hre;
  const chainId = network.config["chainId"];

  if (chainId === undefined) {
    throw new Error("Chain ID is undefined");
  }

  // Fetch constructor arguments
  const params = getParams("paramsDecentralizedEURO", chainId);

  const minApplicationPeriod = params.minApplicationPeriod;
  const args = [minApplicationPeriod];

  // Deploy contract
  const deployment = await deployContract(hre, "DecentralizedEURO", args);
  
  // Verify contract
  const deploymentAddress = await deployment.getAddress();
  const reserveAddress = await deployment.reserve();

  if(network.name === "mainnet" && process.env.ETHERSCAN_API_KEY){
    await verify(deploymentAddress, args);
    await verify(reserveAddress, [deploymentAddress]);
  } else {
    console.log(`Verify:\nnpx hardhat verify --network ${network.name} ${deploymentAddress} ${args.join(" ")}\n`);
    console.log(`Verify:\nnpx hardhat verify --network ${network.name} ${reserveAddress} ${deploymentAddress}\n`);
  }

  console.log("-------------------------------------------------------------------");
};

export default deploy;
deploy.tags = ["main", "DecentralizedEURO"];
