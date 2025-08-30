import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  floatToDec18,
  dec18ToFloat,
} from "../../scripts/utils/math";
import {
  Position,
  DecentralizedEURO,
  MintingHub,
  Equity,
  TestToken,
} from "../../typechain";
import { evm_increaseTime } from "../utils";

describe("Repayment Integration Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let dEURO: DecentralizedEURO;
  let mintingHub: MintingHub;
  let equity: Equity;
  let position: Position;
  let mockCollateral: TestToken;

  // Realistic test parameters matching production
  const initialCollateral = 10000; // 10k tokens
  const initialLimit = 1000000; // 1M dEURO limit
  const initialPrice = floatToDec18(2.5); // 2.5 dEURO per collateral
  const reserveContribution = 100000; // 10% (100000 PPM) - production value
  const annualRatePPM = 30000; // 3% annual interest rate - realistic rate
  const challengePeriod = 3n * 24n * 3600n; // 3 days

  before(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    
    // Deploy full stack
    const DecentralizedEUROFactory = await ethers.getContractFactory("DecentralizedEURO");
    dEURO = await DecentralizedEUROFactory.deploy(10 * 24 * 3600);
    
    equity = await ethers.getContractAt("Equity", await dEURO.reserve());
    
    const MintingHubFactory = await ethers.getContractFactory("MintingHub");
    mintingHub = await MintingHubFactory.deploy(
      await dEURO.getAddress(),
      await equity.getAddress()
    );

    await dEURO.initialize(await mintingHub.getAddress(), "Integration Test Hub");

    // Deploy and setup collateral
    const TestTokenFactory = await ethers.getContractFactory("TestToken");
    mockCollateral = await TestTokenFactory.deploy("Integration Collateral", "IC", 18);
    
    await mockCollateral.mint(alice.address, floatToDec18(initialCollateral * 2));
    await mockCollateral.mint(bob.address, floatToDec18(initialCollateral));
    
    // Create position with realistic parameters
    await mockCollateral.connect(alice).approve(await mintingHub.getAddress(), floatToDec18(initialCollateral));
    await dEURO.connect(alice).approve(await mintingHub.getAddress(), await mintingHub.OPENING_FEE());
    
    const tx = await mintingHub.connect(alice).openPosition(
      await mockCollateral.getAddress(),
      floatToDec18(1000), // min collateral
      floatToDec18(initialCollateral),
      floatToDec18(initialLimit),
      7n * 24n * 3600n,
      365n * 24n * 3600n, // 1 year duration
      challengePeriod,
      floatToDec18(10000), // realistic fees
      initialPrice,
      reserveContribution
    );

    const receipt = await tx.wait();
    const positionOpenedTopic = "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175";
    const log = receipt?.logs.find((x) => x.topics.indexOf(positionOpenedTopic) >= 0);
    const positionAddr = "0x" + log?.topics[2].substring(26);
    
    position = await ethers.getContractAt("Position", positionAddr);
    
    await evm_increaseTime(challengePeriod + 1n);
  });

  describe("Real-world Repayment Scenarios", () => {
    it("should handle typical MAX button scenario (empty wallet)", async () => {
      // Mint some dEURO to create debt
      const mintAmount = floatToDec18(50000); // 50k dEURO debt
      await position.connect(alice).mint(alice.address, mintAmount);
      
      // Let some time pass to accrue interest (typical user might wait months)
      await evm_increaseTime(180n * 24n * 3600n); // 6 months
      
      // Simulate user wallet balance - they have less than total debt
      const walletBalance = floatToDec18(45000); // 45k dEURO in wallet
      
      // UI would call getGrossRepayAmount with wallet balance
      const grossAmount = await position.getGrossRepayAmount(walletBalance);
      
      // Verify the calculation is sane
      expect(grossAmount).to.be.greaterThan(walletBalance);
      expect(grossAmount).to.be.lessThan(walletBalance + floatToDec18(10000)); // Reasonable upper bound
      
      // Record initial balance
      const balanceBefore = await dEURO.balanceOf(alice.address);
      await dEURO.connect(alice).mint(alice.address, grossAmount); // Give alice enough tokens
      
      // Execute repayment using gross amount
      await position.connect(alice).repay(grossAmount);
      
      // Check that approximately walletBalance was spent
      const balanceAfter = await dEURO.balanceOf(alice.address);
      const actualSpent = balanceBefore + grossAmount - balanceAfter;
      
      // Should be very close to target wallet balance
      const diff = actualSpent > walletBalance ? 
        actualSpent - walletBalance : 
        walletBalance - actualSpent;
      expect(diff).to.be.lessThan(walletBalance / 1000n); // Within 0.1%
    });

    it("should prevent the overflow bug at critical amounts", async () => {
      // Create a scenario similar to the bug we fixed
      const largeDebt = floatToDec18(140000); // Large debt like in production
      await position.connect(alice).mint(alice.address, largeDebt);
      
      // Accrue significant interest over time
      await evm_increaseTime(365n * 24n * 3600n); // 1 year
      
      // Test amounts around the problematic range (5946 dEURO was failing)
      const criticalAmounts = [
        floatToDec18(5946.15),
        floatToDec18(5946.16),
        floatToDec18(5946.17),
        floatToDec18(5946.20)
      ];
      
      for (const criticalAmount of criticalAmounts) {
        // This should not revert (was causing MathOverflowedMulDiv before)
        const grossAmount = await position.getGrossRepayAmount(criticalAmount);
        
        expect(grossAmount).to.be.greaterThan(criticalAmount);
        expect(grossAmount).to.be.lessThan(floatToDec18(10000)); // Reasonable upper bound
        
        // Verify we can actually execute the repayment
        await dEURO.connect(alice).mint(alice.address, grossAmount);
        
        const balanceBefore = await dEURO.balanceOf(alice.address);
        await position.connect(alice).repay(grossAmount);
        const balanceAfter = await dEURO.balanceOf(alice.address);
        
        const actualSpent = balanceBefore - balanceAfter;
        
        // Verify the amount spent is approximately what we intended
        const diff = actualSpent > criticalAmount ? 
          actualSpent - criticalAmount : 
          criticalAmount - actualSpent;
        expect(diff).to.be.lessThan(floatToDec18(1)); // Within 1 dEURO
      }
    });

    it("should handle interest accrual between calculation and execution", async () => {
      // Create debt
      const mintAmount = floatToDec18(30000);
      await position.connect(alice).mint(alice.address, mintAmount);
      
      // Let some interest accrue
      await evm_increaseTime(90n * 24n * 3600n); // 3 months
      
      const targetAmount = floatToDec18(5000);
      const grossAmount = await position.getGrossRepayAmount(targetAmount);
      
      // Simulate time passing between calculation and execution (like in real UI)
      await evm_increaseTime(300n); // 5 minutes (typical time for user to submit tx)
      
      // Execute the repayment
      await dEURO.connect(alice).mint(alice.address, grossAmount);
      const balanceBefore = await dEURO.balanceOf(alice.address);
      await position.connect(alice).repay(grossAmount);
      const balanceAfter = await dEURO.balanceOf(alice.address);
      
      const actualSpent = balanceBefore - balanceAfter;
      
      // Should still be close to target amount despite small interest accrual
      const diff = actualSpent > targetAmount ? 
        actualSpent - targetAmount : 
        targetAmount - actualSpent;
      expect(diff).to.be.lessThan(floatToDec18(0.1)); // Within 0.1 dEURO
    });

    it("should work correctly with partial repayments", async () => {
      // Create substantial debt
      const mintAmount = floatToDec18(100000);
      await position.connect(alice).mint(alice.address, mintAmount);
      
      await evm_increaseTime(60n * 24n * 3600n); // 2 months
      
      const initialDebt = await position.getDebt();
      
      // Make several partial repayments
      const partialAmounts = [
        floatToDec18(2000),
        floatToDec18(3500),
        floatToDec18(1200),
        floatToDec18(4800)
      ];
      
      let totalSpent = 0n;
      
      for (const partialAmount of partialAmounts) {
        const grossAmount = await position.getGrossRepayAmount(partialAmount);
        
        await dEURO.connect(alice).mint(alice.address, grossAmount);
        const balanceBefore = await dEURO.balanceOf(alice.address);
        await position.connect(alice).repay(grossAmount);
        const balanceAfter = await dEURO.balanceOf(alice.address);
        
        totalSpent += balanceBefore - balanceAfter;
        
        // Let some time pass between repayments
        await evm_increaseTime(7n * 24n * 3600n); // 1 week
      }
      
      const finalDebt = await position.getDebt();
      const actualDebtReduction = initialDebt - finalDebt;
      
      // The debt reduction should be approximately equal to total amount we intended to pay
      const expectedTotal = partialAmounts.reduce((sum, amount) => sum + amount, 0n);
      const diff = actualDebtReduction > expectedTotal ? 
        actualDebtReduction - expectedTotal : 
        expectedTotal - actualDebtReduction;
      
      // Should be close (allowing for interest accrual between payments)
      expect(diff).to.be.lessThan(expectedTotal / 20n); // Within 5%
    });

    it("should maintain precision with very small amounts", async () => {
      // Create small debt
      const mintAmount = floatToDec18(100);
      await position.connect(alice).mint(alice.address, mintAmount);
      
      // Test very small repayment amounts
      const smallAmounts = [
        1n, // 1 wei
        1000n, // 1000 wei
        floatToDec18(0.001), // 0.001 dEURO
        floatToDec18(0.1), // 0.1 dEURO
      ];
      
      for (const smallAmount of smallAmounts) {
        const grossAmount = await position.getGrossRepayAmount(smallAmount);
        
        expect(grossAmount).to.be.greaterThanOrEqual(smallAmount);
        expect(grossAmount).to.be.lessThan(smallAmount * 2n); // Reasonable bound
        
        // Should not revert on actual execution
        await dEURO.connect(alice).mint(alice.address, grossAmount);
        await expect(position.connect(alice).repay(grossAmount)).to.not.be.reverted;
      }
    });
  });

  describe("UI Integration Scenarios", () => {
    beforeEach(async () => {
      // Reset with fresh debt for each test
      await position.connect(alice).mint(alice.address, floatToDec18(75000));
      await evm_increaseTime(120n * 24n * 3600n); // 4 months for interest
    });

    it("should simulate complete UI repayment flow", async () => {
      // Simulate UI flow:
      // 1. User enters amount in input field
      // 2. UI calls getGrossRepayAmount
      // 3. UI submits transaction with gross amount
      // 4. User balance should decrease by net amount
      
      const userInputAmount = floatToDec18(8000); // User wants to pay 8k from wallet
      
      // Step 1: UI calculates gross amount
      const grossAmount = await position.getGrossRepayAmount(userInputAmount);
      
      // Step 2: Give user enough tokens and record balance
      await dEURO.connect(alice).mint(alice.address, grossAmount);
      const balanceBefore = await dEURO.balanceOf(alice.address);
      
      // Step 3: Submit transaction (what UI would do)
      const tx = await position.connect(alice).repay(grossAmount);
      await tx.wait();
      
      // Step 4: Verify result
      const balanceAfter = await dEURO.balanceOf(alice.address);
      const actualSpent = balanceBefore - balanceAfter;
      
      // User should have spent approximately their input amount
      const diff = actualSpent > userInputAmount ? 
        actualSpent - userInputAmount : 
        userInputAmount - actualSpent;
      expect(diff).to.be.lessThan(userInputAmount / 100n); // Within 1%
    });

    it("should handle edge case of repaying exactly available balance", async () => {
      // User has exactly 6000 dEURO and wants to use MAX button
      const availableBalance = floatToDec18(6000);
      await dEURO.connect(alice).mint(alice.address, availableBalance);
      
      const initialBalance = await dEURO.balanceOf(alice.address);
      expect(initialBalance).to.equal(availableBalance);
      
      // UI calls getGrossRepayAmount with available balance
      const grossAmount = await position.getGrossRepayAmount(availableBalance);
      
      // This was problematic before - might need more tokens than available
      if (grossAmount > availableBalance) {
        // UI should detect this and reduce the amount slightly
        const adjustedNetAmount = (availableBalance * 999n) / 1000n; // 0.1% reduction
        const adjustedGrossAmount = await position.getGrossRepayAmount(adjustedNetAmount);
        
        expect(adjustedGrossAmount).to.be.lessThanOrEqual(availableBalance);
        
        // Execute with adjusted amount
        await position.connect(alice).repay(adjustedGrossAmount);
        
        const finalBalance = await dEURO.balanceOf(alice.address);
        expect(finalBalance).to.be.lessThan(floatToDec18(10)); // Nearly empty wallet
      } else {
        // Can execute with exact amount
        await position.connect(alice).repay(grossAmount);
        
        const finalBalance = await dEURO.balanceOf(alice.address);
        expect(finalBalance).to.equal(0n); // Exactly empty wallet
      }
    });
  });

  describe("Stress Tests", () => {
    it("should handle rapid succession of calculations", async () => {
      await position.connect(alice).mint(alice.address, floatToDec18(80000));
      await evm_increaseTime(200n * 24n * 3600n); // Significant interest
      
      // Simulate rapid UI updates (user typing quickly)
      const rapidCalculations = [];
      for (let i = 1000; i <= 10000; i += 500) {
        const amount = floatToDec18(i);
        rapidCalculations.push(position.getGrossRepayAmount(amount));
      }
      
      // All calculations should succeed
      const results = await Promise.all(rapidCalculations);
      
      // Results should be monotonically increasing
      for (let i = 1; i < results.length; i++) {
        expect(results[i]).to.be.greaterThan(results[i-1]);
      }
    });

    it("should handle extreme interest accrual scenarios", async () => {
      await position.connect(alice).mint(alice.address, floatToDec18(60000));
      
      // Extreme time passage (2 years)
      await evm_increaseTime(2n * 365n * 24n * 3600n);
      
      const extremeInterest = await position.getInterest();
      expect(extremeInterest).to.be.greaterThan(floatToDec18(3000)); // Should have significant interest
      
      // Test calculation with extreme interest
      const testAmount = floatToDec18(5000);
      const grossAmount = await position.getGrossRepayAmount(testAmount);
      
      expect(grossAmount).to.be.greaterThan(testAmount);
      
      // Should still be able to execute
      await dEURO.connect(alice).mint(alice.address, grossAmount);
      await expect(position.connect(alice).repay(grossAmount)).to.not.be.reverted;
    });
  });
});