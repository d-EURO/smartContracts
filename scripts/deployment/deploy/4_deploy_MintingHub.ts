import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployContract } from "../deployUtils";
import { verify } from "../../verify";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, network } = hre;
  const { get } = deployments;
  const chainId = network.config["chainId"];

  if (chainId === undefined) {
    throw new Error("Chain ID is undefined");
  }

  // Fetch constructor arguments
  const decentralizedEURODeployment = await get("DecentralizedEURO");
  const savingsDeployment = await get("Savings");
  const positionRollerDeployment = await get("PositionRoller");
  const positionFactoryDeployment = await get("PositionFactory");

  const decentralizedEURO = decentralizedEURODeployment.address;
  const savings = savingsDeployment.address;
  const positionRoller = positionRollerDeployment.address;
  const positionFactory = positionFactoryDeployment.address;
  const args = [decentralizedEURO, savings, positionRoller, positionFactory];

  // Deploy contract
  const deployment = await deployContract(hre, "MintingHub", args);

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
deploy.tags = ["main", "MintingHub"];
