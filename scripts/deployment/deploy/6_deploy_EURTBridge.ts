import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployContract, sleep } from "../deployUtils";
import { floatToDec18 } from "../../math";

var prompt = require("prompt");

async function getAddress() {
  // local node address
  let addr = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";

  console.log("Is this address for MOCKEUR ok? [y,N]", addr);
  prompt.start();
  const { isOk } = await prompt.get(["isOk"]);
  if (isOk != "y" && isOk != "Y") {
    return "";
  }
  return addr;
}

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  let eurtAddress;
  const limit = 5_000;
  const weeks = 30;
  const {
    deployments: { get },
    run,
  } = hre;
  let applicationMsg;
  if (["hardhat", "localhost", "sepolia"].includes(hre.network.name)) {
    console.log("\nSetting MockEURT Token Bridge");
    try {
      const mockTokenDeployment = await get("TestToken");
      eurtAddress = mockTokenDeployment.address;
    } catch (err: unknown) {
      eurtAddress = await getAddress();
      if (eurtAddress == "") {
        throw err;
      }
    }

    applicationMsg = "MockEURT Token Bridge";
  } else {
    console.log("\nDeploying EURT Token Bridge");
    eurtAddress = "0xc581b735a1688071a1746c968e0798d642ede491";
    applicationMsg = "EURT Bridge";
  }
  const dEURODeployment = await get("EuroCoin");

  let dLimit = floatToDec18(limit);
  console.log("Deploying EURT StablecoinBridge with other =", eurtAddress, "limit = ", limit, "EUR", "and weeks =", weeks);


  await deployContract(hre, "StablecoinBridge", [
    eurtAddress,
    dEURODeployment.address,
    dLimit,
    weeks,
  ]);

  const bridgeDeployment = await get("StablecoinBridge");
  let bridgeAddr: string = bridgeDeployment.address;

  // Automate verification
  if (!["hardhat", "localhost"].includes(hre.network.name)) {
    console.log("Verifying contract on Etherscan...");
    
    console.log(
      `Verify StablecoinBridge:\nnpx hardhat verify --network ${hre.network.name} ${bridgeAddr} ${eurtAddress} ${dEURODeployment.address} ${dLimit}\n`
    );
  
    try {
      await run("verify:verify", {
        address: bridgeAddr,
        constructorArguments: [eurtAddress, dEURODeployment.address, dLimit, weeks],
      });
      console.log("Contract verified successfully!");
    } catch (err) {
      console.error("Verification failed:", err);
    }
  }
};

export default deploy;
deploy.tags = ["main", "EURTBridge"];
