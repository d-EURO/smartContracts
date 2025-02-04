import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployContract } from "../deployUtils";
import { getParams } from "../../utils";
import { verify } from "../../verify";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, network } = hre;
  const { get } = deployments;
  const chainId = network.config["chainId"];
  
  if (chainId === undefined) {
    throw new Error("Chain ID is undefined");
  }

  // Fetch constructor arguments
  const params = getParams("paramsSavings", chainId);
  const decentralizedEURODeployment = await get("DecentralizedEURO");
  const frontendGatewayDeployment = await get("FrontendGateway");
  
  const initialRatePPM = params.initialRatePPM;
  const decentralizedEURO = decentralizedEURODeployment.address;
  const frontendGateway = frontendGatewayDeployment.address;
  const args = [decentralizedEURO, initialRatePPM, frontendGateway];

  // Deploy contract
  const deployment = await deployContract(hre, "SavingsGateway", args);

  // Verify contract
  const deploymentAddress = await deployment.getAddress();
 
  if(network.name === "mainnet" && process.env.ETHERSCAN_API_KEY){
    await verify(deploymentAddress, args);
  } else {
    console.log(
      `Verify:\nnpx hardhat verify --network ${network.name} ${deploymentAddress} ${args.join(" ")}`
    );
  }

  console.log("-------------------------------------------------------------------");
};

export default deploy;
deploy.tags = ["main", "SavingsGateway"];
