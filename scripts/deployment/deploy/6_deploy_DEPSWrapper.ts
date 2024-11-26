import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployContract } from "../deployUtils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  let nDEPSDeploymentAddress;
  const { deployments: { get }, run } = hre;

  try { 
    const nDEPSDeployment = await get("nDEPS");
    nDEPSDeploymentAddress = nDEPSDeployment.address;
  } catch (err: unknown) {
    nDEPSDeploymentAddress = "0x1970620A749B29ad05345b3531c62F3964a557e3";
    // throw err;
  }

  await deployContract(hre, "DEPSWrapper", [ nDEPSDeploymentAddress ]);

  const DEPSWrapperDeployment = await get("DEPSWrapper");

  if (!["hardhat", "localhost"].includes(hre.network.name)) {
    console.log(
      `Verify DEPSWrapper:\nnpx hardhat verify --network ${hre.network.name} ${DEPSWrapperDeployment.address} ${nDEPSDeploymentAddress}`
    );
    
    // Automate verification
    // console.log("Verifying contract on Etherscan...");
    // try {
    //   await run("verify:verify", {
    //     address: bridgeAddr,
    //     constructorArguments: [otherAddress, dEURODeployment.address, dLimit, weeks],
    //   });
    //   console.log("Contract verified successfully!");
    // } catch (err) {
    //   console.error("Verification failed:", err);
    // }
  }
};

export default deploy;
deploy.tags = ["main", "DEPSWrapper"];