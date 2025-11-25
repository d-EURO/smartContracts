import { ethers } from "hardhat";

async function main() {
  console.log("=== COMPLETE INVESTMENT STRATEGY COMPARISON ===\n");

  const equityAddress = "0xD82010E94737A4E4C3fc26314326Ff606E2Dcdf4";
  const jusdAddress = "0x1Dd3057888944ff1f914626aB4BD47Dc8b6285Fe";

  console.log("Querying live contracts on Citrea Testnet...\n");

  const equity = await ethers.getContractAt("Equity", equityAddress);
  const jusd = await ethers.getContractAt("JuiceDollar", jusdAddress);

  // Get current state
  const currentSupply = await equity.totalSupply();
  const currentEquity = await jusd.equity();
  const currentPrice = await equity.price();

  console.log("CURRENT TESTNET STATE:");
  console.log("  JUICE Supply:", ethers.formatEther(currentSupply), "JUICE");
  console.log("  Equity Reserve:", ethers.formatEther(currentEquity), "JUSD");
  console.log("  JUICE Price:", ethers.formatEther(currentPrice), "JUSD\n");

  console.log("=" .repeat(70));
  console.log("STRATEGY 1: 40 BATCH INVESTMENTS (50k each)");
  console.log("=" .repeat(70) + "\n");

  let batch_supply = currentSupply;
  let batch_equity = currentEquity;
  const batchAmount = ethers.parseEther("50000");

  // Simulate first investment of 1000 JUSD
  const firstInvestment = ethers.parseEther("1000");
  let shares1 = await equity.calculateShares(firstInvestment);
  batch_supply += shares1;
  batch_equity += firstInvestment;

  console.log("After first 1,000 JUSD investment:");
  console.log("  Shares received:", ethers.formatEther(shares1), "JUICE");
  console.log("  Total Supply:", ethers.formatEther(batch_supply), "JUICE");
  console.log("  Equity:", ethers.formatEther(batch_equity), "JUSD");

  const price1 = (10n * batch_equity * ethers.parseEther("1")) / batch_supply;
  console.log("  Price:", ethers.formatEther(price1), "JUSD\n");

  console.log("Simulating 40 investments of 50,000 JUSD each:\n");

  for (let i = 1; i <= 40; i++) {
    // Calculate shares based on CURRENT equity (before this investment)
    const sharesForBatch = await equity.calculateShares(batchAmount);

    // For proper simulation, we need to calculate with current equity state
    // Using contract's calculateShares which uses JUSD.equity()
    // We need to simulate incrementally

    const investmentExFees = (batchAmount * 980n) / 1000n;
    const ratio = (batch_equity + investmentExFees) * ethers.parseEther("1") / batch_equity;

    // Calculate 10th root
    let x = ratio;
    const ONE = ethers.parseEther("1");

    // Newton's method for 10th root
    for (let iter = 0; iter < 20; iter++) {
      let powX10 = x;
      for (let j = 0; j < 9; j++) {
        powX10 = (powX10 * x) / ONE;
      }
      const xnew = (x * ((11n * ratio + 9n * powX10) * ONE / (9n * ratio + 11n * powX10))) / ONE;
      const diff = xnew > x ? xnew - x : x - xnew;
      x = xnew;
      if (diff < 1000n) break;
    }

    const newTotalShares = (batch_supply * x) / ONE;
    const sharesReceived = newTotalShares - batch_supply;

    batch_supply = newTotalShares;
    batch_equity += batchAmount;

    if (i === 1 || i === 10 || i === 20 || i === 30 || i === 40) {
      const price = (10n * batch_equity * ethers.parseEther("1")) / batch_supply;
      console.log(`After Investment #${i}:`);
      console.log(`  Shares: ${ethers.formatEther(sharesReceived)} | Supply: ${ethers.formatEther(batch_supply)} | Price: ${ethers.formatEther(price)}`);
    }
  }

  const final_batch_price = (10n * batch_equity * ethers.parseEther("1")) / batch_supply;
  const final_batch_mcap = (batch_supply * final_batch_price) / ethers.parseEther("1");

  console.log("\n" + "=" .repeat(70));
  console.log("STRATEGY 2: SINGLE 2M INVESTMENT");
  console.log("=" .repeat(70) + "\n");

  let single_supply = currentSupply;
  let single_equity = currentEquity;

  // First 1000 JUSD
  let shares_first = await equity.calculateShares(firstInvestment);
  single_supply += shares_first;
  single_equity += firstInvestment;

  console.log("After first 1,000 JUSD investment:");
  console.log("  Shares received:", ethers.formatEther(shares_first), "JUICE");
  console.log("  Total Supply:", ethers.formatEther(single_supply), "JUICE");
  console.log("  Equity:", ethers.formatEther(single_equity), "JUSD");

  const price_first = (10n * single_equity * ethers.parseEther("1")) / single_supply;
  console.log("  Price:", ethers.formatEther(price_first), "JUSD\n");

  // Single 2M investment
  const largeInvestment = ethers.parseEther("2000000");
  console.log("Single investment of 2,000,000 JUSD:\n");

  const investmentExFees_large = (largeInvestment * 980n) / 1000n;
  const ratio_large = (single_equity + investmentExFees_large) * ethers.parseEther("1") / single_equity;

  // Calculate 10th root
  let x_large = ratio_large;
  const ONE = ethers.parseEther("1");

  for (let iter = 0; iter < 20; iter++) {
    let powX10 = x_large;
    for (let j = 0; j < 9; j++) {
      powX10 = (powX10 * x_large) / ONE;
    }
    const xnew = (x_large * ((11n * ratio_large + 9n * powX10) * ONE / (9n * ratio_large + 11n * powX10))) / ONE;
    const diff = xnew > x_large ? xnew - x_large : x_large - xnew;
    x_large = xnew;
    if (diff < 1000n) break;
  }

  const newTotalShares_large = (single_supply * x_large) / ONE;
  const sharesReceived_large = newTotalShares_large - single_supply;

  single_supply = newTotalShares_large;
  single_equity += largeInvestment;

  console.log("  Shares received:", ethers.formatEther(sharesReceived_large), "JUICE");
  console.log("  Total Supply:", ethers.formatEther(single_supply), "JUICE");
  console.log("  Equity:", ethers.formatEther(single_equity), "JUSD");

  const final_single_price = (10n * single_equity * ethers.parseEther("1")) / single_supply;
  const final_single_mcap = (single_supply * final_single_price) / ethers.parseEther("1");
  console.log("  Price:", ethers.formatEther(final_single_price), "JUSD");

  console.log("\n" + "=" .repeat(70));
  console.log("FINAL COMPARISON");
  console.log("=" .repeat(70) + "\n");

  console.log("STRATEGY 1 (40x 50k JUSD):");
  console.log("  Total Supply:", ethers.formatEther(batch_supply), "JUICE");
  console.log("  Final Price:", ethers.formatEther(final_batch_price), "JUSD/JUICE");
  console.log("  Market Cap:", ethers.formatEther(final_batch_mcap), "JUSD");

  console.log("\nSTRATEGY 2 (1x 2M JUSD):");
  console.log("  Total Supply:", ethers.formatEther(single_supply), "JUICE");
  console.log("  Final Price:", ethers.formatEther(final_single_price), "JUSD/JUICE");
  console.log("  Market Cap:", ethers.formatEther(final_single_mcap), "JUSD");

  console.log("\nDIFFERENCE:");
  const supply_diff = single_supply - batch_supply;
  const price_diff = final_single_price - final_batch_price;

  console.log("  Supply Difference:", ethers.formatEther(supply_diff), "JUICE");
  console.log("  Price Difference:", ethers.formatEther(price_diff), "JUSD");
  console.log("  More shares with single investment:", supply_diff > 0n ? "YES" : "NO");
  console.log("  Lower price with single investment:", price_diff < 0n ? "YES" : "NO");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
