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
  const addresses: Record<string, { mintingHubGateway: string; weth: string; deuro: string }> = {
    mainnet: {
      mintingHubGateway: "0x8B3c41c649B9c7085C171CbB82337889b3604618", // MintingHubGateway on mainnet
      weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH on mainnet
      deuro: "0xbA3f535bbCcCcA2A154b573Ca6c5A49BAAE0a3ea", // DecentralizedEURO on mainnet
    },
    sepolia: {
      mintingHubGateway: "0x...", // TODO: Add sepolia MintingHubGateway address
      weth: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9", // WETH on sepolia
      deuro: "0x...", // TODO: Add sepolia DecentralizedEURO address
    },
    polygon: {
      mintingHubGateway: "0x...", // TODO: Add polygon MintingHubGateway address
      weth: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC (native token on Polygon)
      deuro: "0x...", // TODO: Add polygon DecentralizedEURO address
    },
    hardhat: {
      // For local testing or forking
      // If forking from mainnet, use mainnet addresses
      // Otherwise use env vars for local deployments
      mintingHubGateway: process.env.MINTING_HUB_GATEWAY || "0x8B3c41c649B9c7085C171CbB82337889b3604618",
      weth: process.env.WETH_ADDRESS || "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      deuro: process.env.DEURO_ADDRESS || "0xbA3f535bbCcCcA2A154b573Ca6c5A49BAAE0a3ea",
    },
  };

  // Get addresses for current network
  const networkAddresses = addresses[networkName];
  if (!networkAddresses) {
    throw new Error(`No addresses configured for network: ${networkName}`);
  }

  const { mintingHubGateway, weth, deuro } = networkAddresses;

  // Validate addresses
  if (mintingHubGateway.includes("...") || deuro.includes("...")) {
    console.warn("⚠️  WARNING: Using placeholder addresses. Please update with actual contract addresses!");
  }

  console.log("Using addresses:");
  console.log(`  MintingHubGateway: ${mintingHubGateway}`);
  console.log(`  ${networkName === 'polygon' ? 'WMATIC' : 'WETH'}: ${weth}`);
  console.log(`  DecentralizedEURO: ${deuro}`);

  try {
    // Deploy CoinLendingGateway
    const CoinLendingGateway = await ethers.getContractFactory("CoinLendingGateway");
    const gateway = await CoinLendingGateway.deploy(mintingHubGateway, weth, deuro);

    // Wait for deployment
    await gateway.waitForDeployment();
    const gatewayAddress = await gateway.getAddress();

    console.log("\n✅ CoinLendingGateway deployed successfully!");
    console.log(`   Address: ${gatewayAddress}`);

    // Quick sanity check - verify the immutable values were set
    const deployedHub = await gateway.MINTING_HUB();
    const deployedWeth = await gateway.WETH();
    const deployedDeuro = await gateway.DEURO();

    console.log("\n📍 Deployment verification:");
    console.log(`   MINTING_HUB: ${deployedHub === mintingHubGateway ? '✅' : '❌'} ${deployedHub}`);
    console.log(`   ${networkName === 'polygon' ? 'WMATIC' : 'WETH'}:        ${deployedWeth === weth ? '✅' : '❌'} ${deployedWeth}`);
    console.log(`   DEURO:       ${deployedDeuro === deuro ? '✅' : '❌'} ${deployedDeuro}`);

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
          constructorArguments: [mintingHubGateway, weth, deuro],
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