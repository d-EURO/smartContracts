import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployContract, verify } from "../utils";
import { deploymentConfig } from "../deploymentConfig";
import { floatToDec18 } from "../../math";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, network } = hre;
  const { get } = deployments;
  const chainId = network.config["chainId"];

  if (chainId === undefined) {
    throw new Error("Chain ID is undefined");
  }

  // Fetch constructor arguments
  const stablecoinBridgeConfig = deploymentConfig.stablecoinBridge[chainId];
  const decentralizedEURODeployment = await get("DecentralizedEURO");

  const bridges = stablecoinBridgeConfig.bridges;
  for (let i = 0; i < bridges.length; i++) {
    // Fetch constructor arguments
    const bridge = bridges[i];
    const bridgeName = bridge.name;
    const otherAddress = bridge.other;
    const decentralizedEURO = decentralizedEURODeployment.address
    const limit = bridge.limit;
    const weeks = bridge.weeks;
    const args = [otherAddress, decentralizedEURO, limit, weeks];
    
    // Deploy contract
    const deployment = await deployContract(hre, `StablecoinBridge${bridgeName}`, args, "StablecoinBridge");

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
  }
};

export default deploy;
deploy.tags = ["main", "StablecoinBridge"];
