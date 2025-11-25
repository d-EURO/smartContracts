import { ethers } from "hardhat";

async function main() {
  console.log("=== COMPLETE INVESTMENT PROCESS SIMULATION ===\n");

  // Investment configuration
  const firstInvestment = ethers.parseEther("1000");
  const batchCount = 40;
  const batchAmount = ethers.parseEther("50000");

  // Calculate total invested
  const totalInvested = firstInvestment + (BigInt(batchCount) * batchAmount);

  // Calculate equity after fees (98% of each investment)
  const firstAfterFee = (firstInvestment * 980n) / 1000n;
  const batchTotalAfterFee = (BigInt(batchCount) * batchAmount * 980n) / 1000n;
  const totalEquityAfterFees = firstAfterFee + batchTotalAfterFee;

  // Total fees
  const totalFees = totalInvested - totalEquityAfterFees;

  console.log("INVESTMENT BREAKDOWN:");
  console.log("  First Investment:", ethers.formatEther(firstInvestment), "JUSD");
  console.log("  Batch Count:", batchCount);
  console.log("  Amount per Batch:", ethers.formatEther(batchAmount), "JUSD");
  console.log("  Batch Total:", ethers.formatEther(BigInt(batchCount) * batchAmount), "JUSD");
  console.log("  Total Invested (gross):", ethers.formatEther(totalInvested), "JUSD");
  console.log();

  console.log("AFTER 2% INVESTMENT FEE:");
  console.log("  First Investment (after fee):", ethers.formatEther(firstAfterFee), "JUSD");
  console.log("  Batch Total (after fees):", ethers.formatEther(batchTotalAfterFee), "JUSD");
  console.log("  Total Equity Reserve:", ethers.formatEther(totalEquityAfterFees), "JUSD");
  console.log("  Total Fees Collected:", ethers.formatEther(totalFees), "JUSD");
  console.log();

  // Now simulate the actual price calculation
  const equityAddress = "0xD82010E94737A4E4C3fc26314326Ff606E2Dcdf4";
  const jusdAddress = "0x1Dd3057888944ff1f914626aB4BD47Dc8b6285Fe";

  console.log("SIMULATION ON CITREA TESTNET:");
  console.log("  Equity Contract:", equityAddress);
  console.log("  JUSD Contract:", jusdAddress);
  console.log();

  try {
    const equity = await ethers.getContractAt("Equity", equityAddress);
    const jusd = await ethers.getContractAt("JuiceDollar", jusdAddress);

    const currentSupply = await equity.totalSupply();
    const currentEquity = await jusd.equity();
    const currentPrice = await equity.price();

    console.log("CURRENT TESTNET STATE:");
    console.log("  Current JUICE Supply:", ethers.formatEther(currentSupply), "JUICE");
    console.log("  Current Equity Reserve:", ethers.formatEther(currentEquity), "JUSD");
    console.log("  Current JUICE Price:", ethers.formatEther(currentPrice), "JUSD");
  } catch (error) {
    console.log("(Could not connect to testnet - offline simulation only)");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
