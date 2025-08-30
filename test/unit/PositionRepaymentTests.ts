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

describe("Position Repayment Tests - getGrossRepayAmount", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let dEURO: DecentralizedEURO;
  let mintingHub: MintingHub;
  let equity: Equity;
  let position: Position;
  let mockCollateral: TestToken;

  // Test constants
  const initialCollateral = 1000; // 1000 tokens
  const initialLimit = 100000; // 100k dEURO limit
  const initialPrice = floatToDec18(2); // 2 dEURO per collateral
  const reserveContribution = 100000; // 10% (100000 PPM)
  const annualRatePPM = 50000; // 5% annual interest rate
  const challengePeriod = 3n * 24n * 3600n; // 3 days

  before(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    
    // Deploy core contracts
    const DecentralizedEUROFactory = await ethers.getContractFactory("DecentralizedEURO");
    dEURO = await DecentralizedEUROFactory.deploy(10 * 24 * 3600); // 10 days min application period
    
    equity = await ethers.getContractAt("Equity", await dEURO.reserve());
    
    const MintingHubFactory = await ethers.getContractFactory("MintingHub");
    mintingHub = await MintingHubFactory.deploy(
      await dEURO.getAddress(),
      await equity.getAddress()
    );

    // Initialize dEURO with minting hub
    await dEURO.initialize(await mintingHub.getAddress(), "Minting Hub V2");

    // Deploy test token as collateral
    const TestTokenFactory = await ethers.getContractFactory("TestToken");
    mockCollateral = await TestTokenFactory.deploy("Test Collateral", "TC", 18);
    
    // Mint some test collateral to alice
    await mockCollateral.mint(alice.address, floatToDec18(initialCollateral));
    
    // Create a position
    await mockCollateral.connect(alice).approve(await mintingHub.getAddress(), floatToDec18(initialCollateral));
    await dEURO.connect(alice).approve(await mintingHub.getAddress(), await mintingHub.OPENING_FEE());
    
    const tx = await mintingHub.connect(alice).openPosition(
      await mockCollateral.getAddress(),
      floatToDec18(100), // min collateral
      floatToDec18(initialCollateral),
      floatToDec18(initialLimit),
      7n * 24n * 3600n, // 7 days expiration offset  
      30n * 24n * 3600n, // 30 days duration
      challengePeriod,
      floatToDec18(1000), // fees
      initialPrice,
      reserveContribution
    );

    // Get position address from transaction
    const receipt = await tx.wait();
    const positionOpenedTopic = "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175";
    const log = receipt?.logs.find((x) => x.topics.indexOf(positionOpenedTopic) >= 0);
    const positionAddr = "0x" + log?.topics[2].substring(26);
    
    position = await ethers.getContractAt("Position", positionAddr);
    
    // Wait for cooldown period to pass
    await evm_increaseTime(challengePeriod + 1n);
  });

  describe("getGrossRepayAmount - Basic Tests", () => {
    beforeEach(async () => {
      // Mint some dEURO to create debt
      const mintAmount = floatToDec18(10000); // 10k dEURO
      await position.connect(alice).mint(alice.address, mintAmount);
    });

    it("should return correct gross amount when paying only interest", async () => {
      // Accrue some interest by advancing time
      await evm_increaseTime(365n * 24n * 3600n); // 1 year
      
      const interest = await position.getInterest();
      const netAmount = interest / 2n; // Pay half of interest
      
      const grossAmount = await position.getGrossRepayAmount(netAmount);
      
      // When paying only interest, gross amount should equal net amount
      expect(grossAmount).to.equal(netAmount);
    });

    it("should return correct gross amount when paying interest + principal", async () => {
      // Accrue some interest
      await evm_increaseTime(30n * 24n * 3600n); // 1 month
      
      const interest = await position.getInterest();
      const netAmount = interest + floatToDec18(1000); // Interest + 1000 dEURO
      
      const grossAmount = await position.getGrossRepayAmount(netAmount);
      
      // Calculate expected gross amount
      const principalNet = netAmount - interest;
      const expectedPrincipalGross = (principalNet * 1000000n) / (1000000n - BigInt(reserveContribution));
      const expectedGrossAmount = interest + expectedPrincipalGross;
      
      expect(grossAmount).to.equal(expectedGrossAmount);
    });

    it("should handle zero interest correctly", async () => {
      // No time passed, so interest should be minimal/zero
      const netAmount = floatToDec18(1000);
      const grossAmount = await position.getGrossRepayAmount(netAmount);
      
      // With minimal interest, almost all goes to principal
      const expectedGrossAmount = (netAmount * 1000000n) / (1000000n - BigInt(reserveContribution));
      
      // Should be approximately equal (allowing for small interest accrual)
      const diff = grossAmount > expectedGrossAmount ? 
        grossAmount - expectedGrossAmount : 
        expectedGrossAmount - grossAmount;
      
      // Difference should be less than 1 dEURO (due to minimal interest)
      expect(diff).to.be.lessThan(floatToDec18(1));
    });
  });

  describe("getGrossRepayAmount - Edge Cases", () => {
    beforeEach(async () => {
      // Mint some dEURO to create debt
      const mintAmount = floatToDec18(50000); // 50k dEURO
      await position.connect(alice).mint(alice.address, mintAmount);
    });

    it("should handle very small amounts", async () => {
      const netAmount = 1n; // 1 wei
      const grossAmount = await position.getGrossRepayAmount(netAmount);
      
      expect(grossAmount).to.be.greaterThan(0n);
      expect(grossAmount).to.be.greaterThanOrEqual(netAmount);
    });

    it("should handle maximum realistic amounts", async () => {
      // Test with a very large amount (but within uint256 bounds)
      const netAmount = floatToDec18(100000); // 100k dEURO
      const grossAmount = await position.getGrossRepayAmount(netAmount);
      
      expect(grossAmount).to.be.greaterThan(netAmount);
      
      // Verify the calculation is correct
      const interest = await position.getInterest();
      if (netAmount <= interest) {
        expect(grossAmount).to.equal(netAmount);
      } else {
        const principalNet = netAmount - interest;
        const expectedPrincipalGross = (principalNet * 1000000n) / (1000000n - BigInt(reserveContribution));
        const expectedGrossAmount = interest + expectedPrincipalGross;
        expect(grossAmount).to.equal(expectedGrossAmount);
      }
    });

    it("should handle amount equal to current interest", async () => {
      await evm_increaseTime(365n * 24n * 3600n); // 1 year to accrue significant interest
      
      const interest = await position.getInterest();
      const grossAmount = await position.getGrossRepayAmount(interest);
      
      // When net amount equals interest, gross should equal net (no principal)
      expect(grossAmount).to.equal(interest);
    });

    it("should handle amount slightly above current interest", async () => {
      await evm_increaseTime(365n * 24n * 3600n); // 1 year
      
      const interest = await position.getInterest();
      const netAmount = interest + 1n; // 1 wei more than interest
      
      const grossAmount = await position.getGrossRepayAmount(netAmount);
      
      // Should include the grossed-up 1 wei of principal
      const expectedPrincipalGross = (1n * 1000000n) / (1000000n - BigInt(reserveContribution));
      const expectedGrossAmount = interest + expectedPrincipalGross;
      
      expect(grossAmount).to.equal(expectedGrossAmount);
    });
  });

  describe("getGrossRepayAmount - Interest Accrual Tests", () => {
    beforeEach(async () => {
      // Mint some dEURO to create debt
      const mintAmount = floatToDec18(20000); // 20k dEURO
      await position.connect(alice).mint(alice.address, mintAmount);
    });

    it("should account for interest accrual over time", async () => {
      const netAmount = floatToDec18(5000);
      
      // Get gross amount immediately
      const grossAmountBefore = await position.getGrossRepayAmount(netAmount);
      
      // Wait some time for interest to accrue
      await evm_increaseTime(180n * 24n * 3600n); // 6 months
      
      // Get gross amount after time passes
      const grossAmountAfter = await position.getGrossRepayAmount(netAmount);
      
      // Gross amount should be different (likely larger) due to increased interest
      expect(grossAmountAfter).to.not.equal(grossAmountBefore);
      
      // Since interest increased, more of the net amount goes to interest,
      // less to principal, so gross amount should actually be smaller
      expect(grossAmountAfter).to.be.lessThan(grossAmountBefore);
    });

    it("should be consistent with actual repayment calculation", async () => {
      await evm_increaseTime(90n * 24n * 3600n); // 3 months
      
      const netAmount = floatToDec18(3000);
      const grossAmount = await position.getGrossRepayAmount(netAmount);
      
      // Record balances before
      const aliceBalanceBefore = await dEURO.balanceOf(alice.address);
      
      // Perform actual repayment
      await position.connect(alice).repay(grossAmount);
      
      // Check balance after
      const aliceBalanceAfter = await dEURO.balanceOf(alice.address);
      const actualAmountSpent = aliceBalanceBefore - aliceBalanceAfter;
      
      // The actual amount spent should be very close to our net amount
      // (allowing for small rounding differences)
      const diff = actualAmountSpent > netAmount ? 
        actualAmountSpent - netAmount : 
        netAmount - actualAmountSpent;
      
      // Difference should be less than 0.01% (allowing for rounding)
      expect(diff).to.be.lessThan(netAmount / 10000n);
    });
  });

  describe("getGrossRepayAmount - Mathematical Properties", () => {
    beforeEach(async () => {
      // Mint some dEURO to create debt
      const mintAmount = floatToDec18(30000); // 30k dEURO
      await position.connect(alice).mint(alice.address, mintAmount);
      
      // Let some interest accrue
      await evm_increaseTime(60n * 24n * 3600n); // 2 months
    });

    it("should be monotonically increasing", async () => {
      const amounts = [
        floatToDec18(1000),
        floatToDec18(2000),
        floatToDec18(3000),
        floatToDec18(4000),
        floatToDec18(5000)
      ];
      
      let previousGross = 0n;
      
      for (const netAmount of amounts) {
        const grossAmount = await position.getGrossRepayAmount(netAmount);
        expect(grossAmount).to.be.greaterThan(previousGross);
        previousGross = grossAmount;
      }
    });

    it("should satisfy gross >= net for all amounts", async () => {
      const testAmounts = [
        1n, // 1 wei
        floatToDec18(0.1), // 0.1 dEURO
        floatToDec18(100), // 100 dEURO
        floatToDec18(1000), // 1k dEURO
        floatToDec18(10000), // 10k dEURO
      ];
      
      for (const netAmount of testAmounts) {
        const grossAmount = await position.getGrossRepayAmount(netAmount);
        expect(grossAmount).to.be.greaterThanOrEqual(netAmount);
      }
    });

    it("should handle reserve contribution of 0% correctly", async () => {
      // Create a new position with 0% reserve contribution
      const zeroReserveContribution = 0;
      
      await mockCollateral.connect(bob).mint(bob.address, floatToDec18(initialCollateral));
      await mockCollateral.connect(bob).approve(await mintingHub.getAddress(), floatToDec18(initialCollateral));
      await dEURO.connect(bob).approve(await mintingHub.getAddress(), await mintingHub.OPENING_FEE());
      
      const tx = await mintingHub.connect(bob).openPosition(
        await mockCollateral.getAddress(),
        floatToDec18(100),
        floatToDec18(initialCollateral),
        floatToDec18(initialLimit),
        7n * 24n * 3600n,
        30n * 24n * 3600n,
        challengePeriod,
        floatToDec18(1000),
        initialPrice,
        zeroReserveContribution
      );
      
      const receipt = await tx.wait();
      const positionOpenedTopic = "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175";
      const log = receipt?.logs.find((x) => x.topics.indexOf(positionOpenedTopic) >= 0);
      const positionAddr = "0x" + log?.topics[2].substring(26);
      
      const zeroReservePosition = await ethers.getContractAt("Position", positionAddr);
      
      // Wait for cooldown and mint some debt
      await evm_increaseTime(challengePeriod + 1n);
      await zeroReservePosition.connect(bob).mint(bob.address, floatToDec18(5000));
      
      // With 0% reserve, gross should equal net (after accounting for interest)
      const netAmount = floatToDec18(1000);
      const grossAmount = await zeroReservePosition.getGrossRepayAmount(netAmount);
      
      // Should be very close to net amount (only difference is interest handling)
      expect(grossAmount).to.be.approximately(netAmount, floatToDec18(1)); // Within 1 dEURO
    });
  });
});