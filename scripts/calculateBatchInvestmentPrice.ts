import { ethers } from "hardhat";

/**
 * Simulates the batch investment process:
 * 1. Initial investment: 1,000 JUSD -> 10,000,000 JUICE
 * 2. 40 batch investments: 50,000 JUSD each
 *
 * Calculates the final JUICE price after all investments.
 */
async function main() {
  console.log("=== SIMULATING BATCH INVESTMENT DEPLOYMENT ===\n");

  // Initial state
  let currentSupply = ethers.parseEther("10000000"); // 10M JUICE after first investment
  let currentEquity = ethers.parseEther("1000"); // 1,000 JUSD after first investment
  const VALUATION_FACTOR = 10n;
  const FEE_RATE = 980n; // 98% (2% fee)

  // Helper function to calculate price
  function calculatePrice(equity: bigint, supply: bigint): bigint {
    return (VALUATION_FACTOR * equity * ethers.parseEther("1")) / supply;
  }

  // Helper function to calculate 10th root using Newton's method
  function tenthRoot(value: bigint): bigint {
    const ONE = ethers.parseEther("1");
    let x = value > ONE && value < ethers.parseEther("10")
      ? (value - ONE) / 10n + ONE
      : ONE;

    const power10 = (val: bigint): bigint => {
      let result = val;
      for (let i = 0; i < 9; i++) {
        result = (result * val) / ONE;
      }
      return result;
    };

    const mulD18 = (a: bigint, b: bigint): bigint => (a * b) / ONE;
    const divD18 = (a: bigint, b: bigint): bigint => (a * ONE) / b;

    for (let iter = 0; iter < 20; iter++) {
      const powX10 = power10(x);
      const xnew = mulD18(x, divD18(11n * value + 9n * powX10, 9n * value + 11n * powX10));
      const diff = xnew > x ? xnew - x : x - xnew;
      x = xnew;
      if (diff < 1000n) break; // convergence threshold
    }
    return x;
  }

  // Helper function to calculate shares from investment
  function calculateShares(capitalBefore: bigint, investment: bigint, totalShares: bigint): bigint {
    const investmentExFees = (investment * FEE_RATE) / 1000n;
    const ONE = ethers.parseEther("1");
    const ratio = (capitalBefore + investmentExFees) * ONE / capitalBefore;
    const tenthRootRatio = tenthRoot(ratio);
    const newTotalShares = (totalShares * tenthRootRatio) / ONE;
    return newTotalShares - totalShares;
  }

  console.log("INITIAL STATE (after first 1,000 JUSD investment):");
  console.log("  Supply:", ethers.formatEther(currentSupply), "JUICE");
  console.log("  Equity:", ethers.formatEther(currentEquity), "JUSD");
  console.log("  Price:", ethers.formatEther(calculatePrice(currentEquity, currentSupply)), "JUSD per JUICE");
  console.log();

  // Simulate 40 batch investments
  const batchCount = 40;
  const batchAmount = ethers.parseEther("50000"); // 50,000 JUSD

  console.log(`SIMULATING ${batchCount} INVESTMENTS OF ${ethers.formatEther(batchAmount)} JUSD EACH:\n`);

  for (let i = 1; i <= batchCount; i++) {
    const sharesReceived = calculateShares(currentEquity, batchAmount, currentSupply);

    // The FULL investment amount goes into equity reserve
    // The 2% fee only affects share calculation, not the reserve
    currentSupply += sharesReceived;
    currentEquity += batchAmount;

    const newPrice = calculatePrice(currentEquity, currentSupply);

    if (i % 5 === 0 || i === 1 || i === batchCount) {
      console.log(`After Investment #${i}:`);
      console.log(`  Shares received: ${ethers.formatEther(sharesReceived)} JUICE`);
      console.log(`  Total Supply: ${ethers.formatEther(currentSupply)} JUICE`);
      console.log(`  Total Equity: ${ethers.formatEther(currentEquity)} JUSD`);
      console.log(`  Price: ${ethers.formatEther(newPrice)} JUSD per JUICE`);
      console.log();
    }
  }

  const finalPrice = calculatePrice(currentEquity, currentSupply);
  const finalMarketCap = (currentSupply * finalPrice) / ethers.parseEther("1");

  console.log("=== FINAL STATE ===");
  console.log("Total SUSD minted:", ethers.formatEther(ethers.parseEther("2001000")), "SUSD");
  console.log("Total JUSD invested:", ethers.formatEther(ethers.parseEther("1000") + (BigInt(batchCount) * ethers.parseEther("50000"))), "JUSD");
  console.log("Equity Reserve (all JUSD goes in):", ethers.formatEther(currentEquity), "JUSD");
  console.log("Total JUICE Supply:", ethers.formatEther(currentSupply), "JUICE");
  console.log("Final JUICE Price:", ethers.formatEther(finalPrice), "JUSD per JUICE");
  console.log("Market Cap:", ethers.formatEther(finalMarketCap), "JUSD");
  console.log();
  console.log("Note: 2% fee affects share calculation only, not equity reserve");
  console.log("Price increase from start: " +
    ((Number(finalPrice) / Number(ethers.parseEther("0.001"))).toFixed(2)) + "x");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
