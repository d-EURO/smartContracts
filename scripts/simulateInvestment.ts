import { ethers } from "hardhat";

async function main() {
  const equityAddress = "0xD82010E94737A4E4C3fc26314326Ff606E2Dcdf4";
  const jusdAddress = "0x1Dd3057888944ff1f914626aB4BD47Dc8b6285Fe";

  const equity = await ethers.getContractAt("Equity", equityAddress);
  const jusd = await ethers.getContractAt("JuiceDollar", jusdAddress);

  // Get current state
  const currentSupply = await equity.totalSupply();
  const currentEquity = await jusd.equity();
  const currentPrice = await equity.price();

  console.log("\n=== CURRENT STATE ===");
  console.log("Current JUICE Supply:", ethers.formatEther(currentSupply), "JUICE");
  console.log("Current Equity Reserve:", ethers.formatEther(currentEquity), "JUSD");
  console.log("Current JUICE Price:", ethers.formatEther(currentPrice), "JUSD per JUICE");
  console.log("Current Market Cap:", ethers.formatEther(currentSupply * currentPrice / BigInt(1e18)), "JUSD");

  // Simulate investment
  const investmentAmount = ethers.parseEther("2000000"); // 2M JUSD
  
  console.log("\n=== SIMULATING INVESTMENT ===");
  console.log("Investment Amount:", ethers.formatEther(investmentAmount), "JUSD");

  // Calculate shares that would be received
  const sharesReceived = await equity.calculateShares(investmentAmount);
  
  console.log("Shares to be received:", ethers.formatEther(sharesReceived), "JUICE");

  // Calculate new state
  const newSupply = currentSupply + sharesReceived;
  const investmentExFees = investmentAmount * BigInt(980) / BigInt(1000); // 2% fee
  const newEquity = currentEquity + investmentExFees;
  
  // New price = (VALUATION_FACTOR * equity * 1e18) / totalSupply
  // VALUATION_FACTOR = 10
  const newPrice = (BigInt(10) * newEquity * BigInt(1e18)) / newSupply;

  console.log("\n=== AFTER INVESTMENT ===");
  console.log("New JUICE Supply:", ethers.formatEther(newSupply), "JUICE");
  console.log("New Equity Reserve:", ethers.formatEther(newEquity), "JUSD");
  console.log("New JUICE Price:", ethers.formatEther(newPrice), "JUSD per JUICE");
  console.log("New Market Cap:", ethers.formatEther(newSupply * newPrice / BigInt(1e18)), "JUSD");

  console.log("\n=== CHANGES ===");
  const priceIncrease = Number(newPrice - currentPrice) / Number(currentPrice) * 100;
  const supplyIncrease = Number(sharesReceived) / Number(currentSupply) * 100;
  console.log("Price increase:", priceIncrease.toFixed(2), "%");
  console.log("Supply increase:", supplyIncrease.toFixed(2), "%");
  console.log("Price multiplier:", (Number(newPrice) / Number(currentPrice)).toFixed(2), "x");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
