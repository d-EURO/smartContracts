import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployContract, verify } from "../utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, network } = hre;
  const { get } = deployments;
  const chainId = network.config["chainId"];
  
  if (chainId === undefined) {
    throw new Error("Chain ID is undefined");
  }

  // Fetch constructor arguments
  const decentralizedEURODeployment = await get("DecentralizedEURO");
  const savingsGatewayDeployment = await get("SavingsGateway");
  const positionRollerDeployment = await get("PositionRoller");
  const positionFactoryDeployment = await get("PositionFactory");
  const frontendGatewayDeployment = await get("FrontendGateway");
  const decentralizedEURO = decentralizedEURODeployment.address;
  const savingsGateway = savingsGatewayDeployment.address;
  const positionRoller = positionRollerDeployment.address;
  const positionFactory = positionFactoryDeployment.address;
  const frontendGateway = frontendGatewayDeployment.address;
  const args = [decentralizedEURO, savingsGateway, positionRoller, positionFactory, frontendGateway];

  // Deploy contract
  const deployment = await deployContract(hre, "MintingHubGateway", args);

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
deploy.tags = ["main", "MintingHubGateway"];
