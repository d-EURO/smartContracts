// scripts/verifyDeployments.ts

import { ethers, deployments, network } from "hardhat";
import { verify } from "../deployment/utils";

/**
 * Verify all contracts deployed in the deployments folder.
 */
async function verifyContracts() {
  // Get all deployment artifacts from the deployments folder
  const allDeployments = await deployments.all();

  // Iterate over each deployment
  for (const [name, deployment] of Object.entries(allDeployments)) {
    if (!deployment.address) {
      console.log(`Skipping ${name} because no address was found.`);
      continue;
    }

    // Wait for block confirmations
    const numConfirmations = 6;
    if (deployment.transactionHash) {
      console.log(`Waiting for 6 confirmations for ${name}...`);
      await ethers.provider.waitForTransaction(deployment.transactionHash, numConfirmations);
    } else {
      console.log(`No transaction hash for ${name}, skipping confirmation wait.`);
    }

    // Verify contract
    if(network.name === "mainnet" && process.env.ETHERSCAN_API_KEY){
        await verify(deployment.address, deployment.args || [], name);
    }
  }
}

verifyContracts()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });