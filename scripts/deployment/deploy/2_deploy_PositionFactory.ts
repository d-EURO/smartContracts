import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployContract } from "../deployUtils";
import { verify } from "../../verify";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { network } = hre;

  // Deploy contract
  const deployment = await deployContract(hre, "PositionFactory");

  // Verify contract
  const deploymentAddress = await deployment.getAddress();

  if(network.name === "mainnet" && process.env.ETHERSCAN_API_KEY){
    await verify(deploymentAddress, []);
  } else {
    console.log(
      `Verify:\nnpx hardhat verify --network ${network.name} ${deploymentAddress}}`
    );
  }
};
export default deploy;
deploy.tags = ["main", "PositionFactory"];
