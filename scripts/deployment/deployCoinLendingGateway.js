const hre = require("hardhat");

async function main() {
  console.log("Deploying CoinLendingGateway...");

  // Get network configuration
  const network = hre.network.name;
  console.log(`Deploying to network: ${network}`);

  // Contract addresses for different networks
  const addresses = {
    mainnet: {
      mintingHubGateway: "0x...", // TODO: Add mainnet MintingHubGateway address
      weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
    },
    sepolia: {
      mintingHubGateway: "0x...", // TODO: Add sepolia MintingHubGateway address
      weth: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9"
    },
    polygon: {
      mintingHubGateway: "0x...", // TODO: Add polygon MintingHubGateway address
      weth: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619"
    },
    hardhat: {
      // For local testing, these will be deployed separately
      mintingHubGateway: process.env.MINTING_HUB_GATEWAY || "0x...",
      weth: process.env.WETH_ADDRESS || "0x..."
    }
  };

  // Get addresses for current network
  const networkAddresses = addresses[network];
  if (!networkAddresses) {
    throw new Error(`No addresses configured for network: ${network}`);
  }

  const { mintingHubGateway, weth } = networkAddresses;

  console.log("Using addresses:");
  console.log(`  MintingHubGateway: ${mintingHubGateway}`);
  console.log(`  WETH: ${weth}`);

  // Deploy CoinLendingGateway
  const CoinLendingGateway = await hre.ethers.getContractFactory("CoinLendingGateway");
  const gateway = await CoinLendingGateway.deploy(mintingHubGateway, weth);

  await gateway.deployed();

  console.log(`CoinLendingGateway deployed to: ${gateway.address}`);

  // Wait for a few block confirmations
  if (network !== "hardhat" && network !== "localhost") {
    console.log("Waiting for block confirmations...");
    await gateway.deployTransaction.wait(5);

    // Verify contract on Etherscan
    console.log("Verifying contract on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: gateway.address,
        constructorArguments: [mintingHubGateway, weth],
      });
      console.log("Contract verified successfully");
    } catch (error) {
      console.error("Verification failed:", error);
    }
  }

  // Return deployed contract for further use
  return {
    address: gateway.address,
    gateway,
    networkAddresses
  };
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

module.exports = main;