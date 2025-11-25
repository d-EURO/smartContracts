import { expect } from "chai";
import { ethers } from "hardhat";
import { Equity, JuiceDollar } from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Investment Strategy Comparison Test
 *
 * This test compares two investment strategies using ACTUAL contracts matching real deployment:
 * - Strategy A: 1,000 JUSD initial + 40 batch investments of 50,000 JUSD each
 * - Strategy B: 1,000 JUSD initial + 1 large investment of 2,000,000 JUSD
 *
 * Both strategies invest the same total amount (2,001,000 JUSD).
 *
 * Uses the REAL StartUSD contract (not TestToken) to match actual deployment in deployProtocol.ts.
 * NO CUSTOM MATH - All calculations are done by the actual Equity contract.
 */
describe("Investment Strategy Comparison", () => {
  let owner: HardhatEthersSigner;

  // Store results for comparison
  const results: any = {
    strategyA: {},
    strategyB: {}
  };

  // Helper to deploy fresh contracts (matching deployProtocol.ts exactly)
  async function deployContracts() {
    // 1. Deploy StartUSD - automatically mints 100M SUSD to deployer
    const StartUSDFactory = await ethers.getContractFactory("StartUSD");
    const startUSD = await StartUSDFactory.deploy();

    // 2. Deploy JuiceDollar with 10-day minter application period
    const juiceDollarFactory = await ethers.getContractFactory("JuiceDollar");
    const jusd = await juiceDollarFactory.deploy(10 * 86400);

    // 3. Deploy StablecoinBridge for StartUSD with 100M limit, 3 weeks application
    const bridgeLimit = ethers.parseEther("100000000"); // 100M JUSD limit (matches deploymentConfig)
    const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
    const bridge = await bridgeFactory.deploy(
      await startUSD.getAddress(),
      await jusd.getAddress(),
      bridgeLimit,
      3, // 3 weeks application period
    );

    // 4. Initialize JuiceDollar with bridge
    await jusd.initialize(await bridge.getAddress(), "");

    // 5. Bridge 2,001,000 SUSD to JUSD (StartUSD already has 100M minted in constructor)
    const amountToBridge = ethers.parseEther("2001000");
    await startUSD.approve(await bridge.getAddress(), amountToBridge);
    await bridge.mint(amountToBridge);

    // 6. Get Equity contract
    const equity = await ethers.getContractAt("Equity", await jusd.reserve());

    return { startUSD, jusd, bridge, equity };
  }

  before(async () => {
    [owner] = await ethers.getSigners();
  });

  describe("Strategy A: Batch Investments", () => {
    it("Should execute 40 batch investments correctly", async () => {
      // Deploy fresh contracts (matching real deployment)
      const { startUSD, jusd, bridge, equity } = await deployContracts();

      console.log("\n" + "═".repeat(80));
      console.log("STRATEGY A: BATCH INVESTMENTS (40 × 50,000 JUSD)");
      console.log("═".repeat(80));

      // Initial investment: 1,000 JUSD → 100M JUICE (hardcoded in contract)
      const initialInvestment = ethers.parseEther("1000");
      const expectedInitialShares = ethers.parseEther("100000000"); // 100M JUICE

      await equity.invest(initialInvestment, expectedInitialShares);

      const supplyAfterInitial = await equity.totalSupply();
      const priceAfterInitial = await equity.price();

      console.log("\nAfter initial 1,000 JUSD investment:");
      console.log(`  JUICE supply: ${ethers.formatEther(supplyAfterInitial)} JUICE`);
      console.log(`  JUICE price: ${ethers.formatEther(priceAfterInitial)} JUSD/JUICE`);

      expect(supplyAfterInitial).to.equal(expectedInitialShares);

      // Execute 40 batch investments (matching deployProtocol.ts)
      const batchCount = 40;
      const batchAmount = ethers.parseEther("50000");

      console.log(`\nExecuting ${batchCount} batch investments of ${ethers.formatEther(batchAmount)} JUSD each...`);

      for (let i = 0; i < batchCount; i++) {
        await equity.invest(batchAmount, 0); // 0 = no slippage protection

        if ((i + 1) % 10 === 0) {
          const supply = await equity.totalSupply();
          const price = await equity.price();
          console.log(`  After batch #${i + 1}: ${ethers.formatEther(supply)} JUICE @ ${ethers.formatEther(price)} JUSD/JUICE`);
        }
      }

      // Read final state from actual contracts
      const finalSupply = await equity.totalSupply();
      const finalPrice = await equity.price();
      const finalEquity = await jusd.equity();

      const marketCap = (finalSupply * finalPrice) / ethers.parseEther("1");

      console.log("\n" + "─".repeat(80));
      console.log("Strategy A Final State:");
      console.log(`  Total invested: 2,001,000 JUSD`);
      console.log(`  JUICE supply: ${ethers.formatEther(finalSupply)} JUICE`);
      console.log(`  Equity reserve: ${ethers.formatEther(finalEquity)} JUSD`);
      console.log(`  JUICE price: ${ethers.formatEther(finalPrice)} JUSD/JUICE`);
      console.log(`  Market cap: ${ethers.formatEther(marketCap)} JUSD`);
      console.log("─".repeat(80) + "\n");

      // Store results for comparison
      results.strategyA = {
        supply: finalSupply,
        price: finalPrice,
        equity: finalEquity,
      };

      // Verify expected outcomes
      expect(finalEquity).to.equal(ethers.parseEther("2001000")); // All JUSD goes into equity
      expect(finalSupply).to.be.gt(ethers.parseEther("100000000")); // More than initial 100M
    });
  });

  describe("Strategy B: Single Large Investment", () => {
    it("Should execute single large investment correctly", async () => {
      // Deploy fresh contracts (matching real deployment)
      const { startUSD, jusd, bridge, equity } = await deployContracts();

      console.log("\n" + "═".repeat(80));
      console.log("STRATEGY B: SINGLE LARGE INVESTMENT (1 × 2,000,000 JUSD)");
      console.log("═".repeat(80));

      // Initial investment: 1,000 JUSD (same as Strategy A)
      const initialInvestment = ethers.parseEther("1000");
      const expectedInitialShares = ethers.parseEther("100000000"); // 100M JUICE

      await equity.invest(initialInvestment, expectedInitialShares);

      const supplyAfterInitial = await equity.totalSupply();
      const priceAfterInitial = await equity.price();

      console.log("\nAfter initial 1,000 JUSD investment:");
      console.log(`  JUICE supply: ${ethers.formatEther(supplyAfterInitial)} JUICE`);
      console.log(`  JUICE price: ${ethers.formatEther(priceAfterInitial)} JUSD/JUICE`);

      expect(supplyAfterInitial).to.equal(expectedInitialShares);

      // Execute single large investment
      const largeInvestment = ethers.parseEther("2000000");
      console.log(`\nExecuting single large investment of ${ethers.formatEther(largeInvestment)} JUSD...`);

      await equity.invest(largeInvestment, 0);

      // Read final state from actual contracts
      const finalSupply = await equity.totalSupply();
      const finalPrice = await equity.price();
      const finalEquity = await jusd.equity();

      const marketCap = (finalSupply * finalPrice) / ethers.parseEther("1");

      console.log("\n" + "─".repeat(80));
      console.log("Strategy B Final State:");
      console.log(`  Total invested: 2,001,000 JUSD`);
      console.log(`  JUICE supply: ${ethers.formatEther(finalSupply)} JUICE`);
      console.log(`  Equity reserve: ${ethers.formatEther(finalEquity)} JUSD`);
      console.log(`  JUICE price: ${ethers.formatEther(finalPrice)} JUSD/JUICE`);
      console.log(`  Market cap: ${ethers.formatEther(marketCap)} JUSD`);
      console.log("─".repeat(80) + "\n");

      // Store results for comparison
      results.strategyB = {
        supply: finalSupply,
        price: finalPrice,
        equity: finalEquity,
      };

      // Verify expected outcomes
      expect(finalEquity).to.equal(ethers.parseEther("2001000")); // All JUSD goes into equity
      expect(finalSupply).to.be.gt(ethers.parseEther("100000000")); // More than initial 100M
    });
  });

  describe("Comparison", () => {
    it("Should show the difference between strategies", function() {
      const strategyA = results.strategyA;
      const strategyB = results.strategyB;

      if (!strategyA.supply || !strategyB.supply) {
        console.log("\n⚠️  Skipping comparison - strategy results not available");
        this.skip();
        return;
      }

      console.log("\n" + "═".repeat(80));
      console.log("COMPARISON: CONTRACT-BASED RESULTS (Real StartUSD Contract)");
      console.log("═".repeat(80));
      console.log("\nTotal Invested (both strategies): 2,001,000 JUSD\n");

      console.log(`Strategy A (40 batches):`);
      console.log(`  Supply: ${ethers.formatEther(strategyA.supply)} JUICE`);
      console.log(`  Price:  ${ethers.formatEther(strategyA.price)} JUSD/JUICE`);
      console.log(`  Equity: ${ethers.formatEther(strategyA.equity)} JUSD\n`);

      console.log(`Strategy B (1 large):`);
      console.log(`  Supply: ${ethers.formatEther(strategyB.supply)} JUICE`);
      console.log(`  Price:  ${ethers.formatEther(strategyB.price)} JUSD/JUICE`);
      console.log(`  Equity: ${ethers.formatEther(strategyB.equity)} JUSD\n`);

      const supplyDiff = strategyB.supply - strategyA.supply;
      const priceDiff = strategyB.price - strategyA.price;
      const supplyDiffPercent = (Number(supplyDiff) * 100) / Number(strategyA.supply);
      const priceDiffPercent = (Number(priceDiff) * 100) / Number(strategyA.price);

      console.log(`Difference:`);
      console.log(`  Supply: ${ethers.formatEther(supplyDiff)} JUICE (${supplyDiffPercent.toFixed(2)}%)`);
      console.log(`  Price:  ${ethers.formatEther(priceDiff)} JUSD (${priceDiffPercent.toFixed(2)}%)\n`);

      if (supplyDiff > 0n) {
        console.log(`✓ Strategy B results in ${ethers.formatEther(supplyDiff)} MORE JUICE tokens`);
      } else {
        console.log(`✓ Strategy A results in ${ethers.formatEther(-supplyDiff)} MORE JUICE tokens`);
      }

      if (priceDiff > 0n) {
        console.log(`✓ Strategy B results in ${ethers.formatEther(priceDiff)} HIGHER JUICE price`);
      } else {
        console.log(`✓ Strategy A results in ${ethers.formatEther(-priceDiff)} HIGHER JUICE price`);
      }

      console.log("\n" + "═".repeat(80) + "\n");

      // Both should have the same equity (all JUSD goes in)
      expect(strategyA.equity).to.equal(strategyB.equity);

      // Difference should be small (less than 1%)
      expect(Math.abs(supplyDiffPercent)).to.be.lessThan(1);
      expect(Math.abs(priceDiffPercent)).to.be.lessThan(1);
    });
  });
});
