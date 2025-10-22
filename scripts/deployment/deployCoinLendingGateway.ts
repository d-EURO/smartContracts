import { ethers } from 'hardhat';
import hre from 'hardhat';

async function main() {
  console.log("Deploying CoinLendingGateway...");

  // Get network configuration
  const networkName = hre.network.name;
  console.log(`Deploying to network: ${networkName}`);


  // Contract addresses for different networks
  const addresses: Record<string, { mintingHubGateway: string; wcbtc: string; jusd: string }> = {
    citrea: {
      mintingHubGateway: "0x...", // TODO: Add citrea MintingHubGateway address
      wcbtc: "0x...", // TODO: Add Wrapped cBTC (WcBTC) address on Citrea
      jusd: "0x...", // TODO: Add JuiceDollar address on Citrea
    },
    citreaTestnet: {
      mintingHubGateway: "0x...", // TODO: Add citrea testnet MintingHubGateway address
      wcbtc: "0x...", // TODO: Add Wrapped cBTC (WcBTC) address on Citrea Testnet
      jusd: "0x...", // TODO: Add JuiceDollar address on Citrea Testnet
    },
    hardhat: {
      // For local testing
      mintingHubGateway: process.env.MINTING_HUB_GATEWAY || "0x...",
      wcbtc: process.env.WCBTC_ADDRESS || "0x...",
      jusd: process.env.JUSD_ADDRESS || "0x...",
    },
  };

  // Get addresses for current network
  const networkAddresses = addresses[networkName];
  if (!networkAddresses) {
    throw new Error(`No addresses configured for network: ${networkName}`);
  }

  const { mintingHubGateway, wcbtc, jusd } = networkAddresses;

  // Validate addresses
  if (mintingHubGateway.includes("...") || wcbtc.includes("...") || jusd.includes("...")) {
    console.warn("⚠️  WARNING: Using placeholder addresses. Please update with actual contract addresses!");
  }

  console.log("Using addresses:");
  console.log(`  MintingHubGateway: ${mintingHubGateway}`);
  console.log(`  Wrapped cBTC (WcBTC): ${wcbtc}`);
  console.log(`  JuiceDollar: ${jusd}`);

  try {
    // Deploy CoinLendingGateway
    const CoinLendingGateway = await ethers.getContractFactory("CoinLendingGateway");
    const gateway = await CoinLendingGateway.deploy(mintingHubGateway, wcbtc, jusd);

    // Wait for deployment
    await gateway.waitForDeployment();
    const gatewayAddress = await gateway.getAddress();

    console.log("\n✅ CoinLendingGateway deployed successfully!");
    console.log(`   Address: ${gatewayAddress}`);

    // Quick sanity check - verify the immutable values were set
    const deployedHub = await gateway.MINTING_HUB();
    const deployedWcbtc = await gateway.WCBTC();
    const deployedJusd = await gateway.JUSD();

    console.log("\n📍 Deployment verification:");
    console.log(`   MINTING_HUB:     ${deployedHub === mintingHubGateway ? '✅' : '❌'} ${deployedHub}`);
    console.log(`   WCBTC:           ${deployedWcbtc === wcbtc ? '✅' : '❌'} ${deployedWcbtc}`);
    console.log(`   JUSD:            ${deployedJusd === jusd ? '✅' : '❌'} ${deployedJusd}`);

    // Wait for block confirmations on live networks
    if (networkName !== "hardhat" && networkName !== "localhost") {
      console.log("Waiting for block confirmations...");
      const deploymentTx = gateway.deploymentTransaction();
      if (deploymentTx) {
        await deploymentTx.wait(5);
      }

      // Verify contract on block explorer
      console.log("Verifying contract on block explorer...");
      try {
        await hre.run("verify:verify", {
          address: gatewayAddress,
          constructorArguments: [mintingHubGateway, wcbtc, jusd],
        });
        console.log("Contract verified successfully");
      } catch (error: any) {
        if (error.message.includes("Already Verified")) {
          console.log("Contract is already verified");
        } else {
          console.error("Verification failed:", error.message);
        }
      }
    }

    // Return deployed contract information
    return {
      address: gatewayAddress,
      gateway,
      networkAddresses,
    };
  } catch (error) {
    console.error("Deployment failed:", error);
    throw error;
  }
}

// Execute deployment
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export default main;