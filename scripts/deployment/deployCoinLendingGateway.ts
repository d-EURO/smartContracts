import { ethers } from 'hardhat';
import hre from 'hardhat';

async function main() {
  console.log("Deploying CoinLendingGateway...");

  // Get network configuration
  const networkName = hre.network.name;
  console.log(`Deploying to network: ${networkName}`);

  // Check if we're on a fork
  if (networkName === 'hardhat') {
    const config = hre.network.config as any;
    if (config.forking) {
      console.log(`Running on a fork of: ${config.forking.url}`);
      console.log("Using mainnet addresses for deployment...");
    }
  }

  // Contract addresses for different networks
  const addresses: Record<string, { mintingHubGateway: string; weth: string; jusd: string }> = {
    citrea: {
      mintingHubGateway: process.env.MINTING_HUB_GATEWAY || "0x...", // TODO: Update after deployment
      weth: process.env.WETH_ADDRESS || "0x...", // TODO: Add wrapped BTC or native token address
      jusd: process.env.JUSD_ADDRESS || "0x...", // TODO: Update after JuiceDollar deployment
    },
    hardhat: {
      // For local testing
      mintingHubGateway: process.env.MINTING_HUB_GATEWAY || "0x0000000000000000000000000000000000000000",
      weth: process.env.WETH_ADDRESS || "0x0000000000000000000000000000000000000000",
      jusd: process.env.JUSD_ADDRESS || "0x0000000000000000000000000000000000000000",
    },
  };

  // Get addresses for current network
  const networkAddresses = addresses[networkName];
  if (!networkAddresses) {
    throw new Error(`No addresses configured for network: ${networkName}`);
  }

  const { mintingHubGateway, weth, jusd } = networkAddresses;

  // Validate addresses
  if (mintingHubGateway.includes("...") || jusd.includes("...")) {
    console.warn("⚠️  WARNING: Using placeholder addresses. Please update with actual contract addresses!");
  }

  console.log("Using addresses:");
  console.log(`  MintingHubGateway: ${mintingHubGateway}`);
  console.log(`  ${networkName === 'polygon' ? 'WMATIC' : 'WETH'}: ${weth}`);
  console.log(`  JuiceDollar: ${jusd}`);

  try {
    // Deploy CoinLendingGateway
    const CoinLendingGateway = await ethers.getContractFactory("CoinLendingGateway");
    const gateway = await CoinLendingGateway.deploy(mintingHubGateway, weth, jusd);

    // Wait for deployment
    await gateway.waitForDeployment();
    const gatewayAddress = await gateway.getAddress();

    console.log("\n✅ CoinLendingGateway deployed successfully!");
    console.log(`   Address: ${gatewayAddress}`);

    // Quick sanity check - verify the immutable values were set
    const deployedHub = await gateway.MINTING_HUB();
    const deployedWeth = await gateway.WETH();
    const deployedJUSD = await gateway.JUSD();

    console.log("\n📍 Deployment verification:");
    console.log(`   MINTING_HUB: ${deployedHub === mintingHubGateway ? '✅' : '❌'} ${deployedHub}`);
    console.log(`   ${networkName === 'polygon' ? 'WMATIC' : 'WETH'}:        ${deployedWeth === weth ? '✅' : '❌'} ${deployedWeth}`);
    console.log(`   JUSD:       ${deployedJUSD === jusd ? '✅' : '❌'} ${deployedJUSD}`);

    // Wait for block confirmations on live networks
    if (networkName !== "hardhat" && networkName !== "localhost") {
      console.log("Waiting for block confirmations...");
      const deploymentTx = gateway.deploymentTransaction();
      if (deploymentTx) {
        await deploymentTx.wait(5);
      }

      // Verify contract on Etherscan
      console.log("Verifying contract on Etherscan...");
      try {
        await hre.run("verify:verify", {
          address: gatewayAddress,
          constructorArguments: [mintingHubGateway, weth, jusd],
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