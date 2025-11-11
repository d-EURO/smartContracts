import { ethers } from "hardhat";

async function main() {
  console.log("=== SINGLE LARGE INVESTMENT SIMULATION ===\n");

  // Initial state after first 1,000 JUSD
  let currentSupply = ethers.parseEther("10000000");
  let currentEquity = ethers.parseEther("1000");
  const VALUATION_FACTOR = 10n;
  const FEE_RATE = 980n;

  function calculatePrice(equity: bigint, supply: bigint): bigint {
    return (VALUATION_FACTOR * equity * ethers.parseEther("1")) / supply;
  }

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
      if (diff < 1000n) break;
    }
    return x;
  }

  function calculateShares(capitalBefore: bigint, investment: bigint, totalShares: bigint): bigint {
    const investmentExFees = (investment * FEE_RATE) / 1000n;
    const ONE = ethers.parseEther("1");
    const ratio = (capitalBefore + investmentExFees) * ONE / capitalBefore;
    const tenthRootRatio = tenthRoot(ratio);
    const newTotalShares = (totalShares * tenthRootRatio) / ONE;
    return newTotalShares - totalShares;
  }

  console.log("INITIAL STATE (after first 1,000 JUSD):");
  console.log("  Supply:", ethers.formatEther(currentSupply), "JUICE");
  console.log("  Equity:", ethers.formatEther(currentEquity), "JUSD");
  console.log("  Price:", ethers.formatEther(calculatePrice(currentEquity, currentSupply)), "JUSD per JUICE\n");

  // Single large investment of 2,000,000 JUSD
  const largeInvestment = ethers.parseEther("2000000");
  
  console.log("SINGLE INVESTMENT:", ethers.formatEther(largeInvestment), "JUSD\n");

  const sharesReceived = calculateShares(currentEquity, largeInvestment, currentSupply);
  currentSupply += sharesReceived;
  currentEquity += largeInvestment;

  const finalPrice = calculatePrice(currentEquity, currentSupply);
  const finalMarketCap = (currentSupply * finalPrice) / ethers.parseEther("1");

  console.log("=== AFTER SINGLE 2M INVESTMENT ===");
  console.log("Shares received:", ethers.formatEther(sharesReceived), "JUICE");
  console.log("Total Supply:", ethers.formatEther(currentSupply), "JUICE");
  console.log("Equity Reserve:", ethers.formatEther(currentEquity), "JUSD");
  console.log("Final JUICE Price:", ethers.formatEther(finalPrice), "JUSD per JUICE");
  console.log("Market Cap:", ethers.formatEther(finalMarketCap), "JUSD");
  console.log("\nPrice increase from start:", (Number(finalPrice) / Number(ethers.parseEther("0.001"))).toFixed(2) + "x");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
