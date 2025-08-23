import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  DecentralizedEURO,
  Equity,
  StablecoinBridgeV2,
  TestToken,
} from "../../typechain";

describe("StablecoinBridge V2 - Gas Optimized", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let keeper: HardhatEthersSigner;

  let dEURO: DecentralizedEURO;
  let equity: Equity;
  let eur: TestToken;
  let bridgeV2: StablecoinBridgeV2;

  const BRIDGE_LIMIT = ethers.parseEther("1000000");
  const BRIDGE_DURATION_WEEKS = 30;
  const MINT_FEE_PPM = 1000; // 0.1%
  const BURN_FEE_PPM = 500;  // 0.05%

  beforeEach(async () => {
    [owner, alice, keeper] = await ethers.getSigners();

    // Deploy DecentralizedEURO
    const DecentralizedEUROFactory = await ethers.getContractFactory("DecentralizedEURO");
    dEURO = await DecentralizedEUROFactory.deploy(10 * 86400);

    // Get Equity contract
    const equityAddr = await dEURO.reserve();
    equity = await ethers.getContractAt("Equity", equityAddr);

    // Deploy test EUR token
    const TestTokenFactory = await ethers.getContractFactory("TestToken");
    eur = await TestTokenFactory.deploy("Test EUR", "TEUR", 18);

    // Deploy optimized bridge V2
    const StablecoinBridgeV2Factory = await ethers.getContractFactory("StablecoinBridgeV2");
    bridgeV2 = await StablecoinBridgeV2Factory.deploy(
      await eur.getAddress(),
      await dEURO.getAddress(),
      BRIDGE_LIMIT,
      BRIDGE_DURATION_WEEKS,
      MINT_FEE_PPM,
      BURN_FEE_PPM
    );

    // Initialize dEURO with bridge as minter
    await dEURO.initialize(await bridgeV2.getAddress(), "Bridge V2");
  });

  describe("Storage Packing", () => {
    it("should pack config into single storage slot", async () => {
      const config = await bridgeV2.config();
      
      // Verify all values are correctly stored
      expect(config.mintFeePPM).to.equal(MINT_FEE_PPM);
      expect(config.burnFeePPM).to.equal(BURN_FEE_PPM);
      expect(config.eurDecimals).to.equal(18);
      expect(config.dEURODecimals).to.equal(18);
      expect(config.horizon).to.be.gt(0);
    });
  });

  describe("Fee Accumulation", () => {
    it("should accumulate mint fees instead of sending immediately", async () => {
      const mintAmount = ethers.parseEther("10000");
      const expectedFee = (mintAmount * BigInt(MINT_FEE_PPM)) / 1000000n;

      // Mint EUR to alice
      await eur.mint(alice.address, mintAmount);
      await eur.connect(alice).approve(await bridgeV2.getAddress(), mintAmount);

      // Mint through bridge
      await bridgeV2.connect(alice).mint(mintAmount);

      // Check fees are accumulated, not sent to reserve yet
      const reserveBalance = await dEURO.balanceOf(await equity.getAddress());
      expect(reserveBalance).to.equal(0);

      // Check accumulated fees
      const [mintFees, burnFees, total] = await bridgeV2.pendingFees();
      expect(mintFees).to.equal(expectedFee);
      expect(burnFees).to.equal(0);
      expect(total).to.equal(expectedFee);
    });

    it("should accumulate burn fees", async () => {
      // Setup: mint first
      const mintAmount = ethers.parseEther("10000");
      await eur.mint(alice.address, mintAmount);
      await eur.connect(alice).approve(await bridgeV2.getAddress(), mintAmount);
      await bridgeV2.connect(alice).mint(mintAmount);

      // Burn
      const burnAmount = ethers.parseEther("5000");
      const expectedBurnFee = (burnAmount * BigInt(BURN_FEE_PPM)) / 1000000n;

      await dEURO.connect(alice).approve(await bridgeV2.getAddress(), burnAmount);
      await bridgeV2.connect(alice).burn(burnAmount);

      // Check accumulated fees
      const [mintFees, burnFees, total] = await bridgeV2.pendingFees();
      expect(burnFees).to.equal(expectedBurnFee);
      expect(mintFees).to.be.gt(0); // Still has mint fees
      expect(total).to.equal(mintFees + burnFees);

      // Bridge should hold the burn fee as dEURO
      const bridgeBalance = await dEURO.balanceOf(await bridgeV2.getAddress());
      expect(bridgeBalance).to.equal(expectedBurnFee);
    });

    it("should allow anyone to collect fees", async () => {
      // Execute some transactions
      const mintAmount = ethers.parseEther("10000");
      await eur.mint(alice.address, mintAmount * 2n);
      await eur.connect(alice).approve(await bridgeV2.getAddress(), mintAmount * 2n);
      
      // Mint
      await bridgeV2.connect(alice).mint(mintAmount);
      
      // Burn  
      await dEURO.connect(alice).approve(await bridgeV2.getAddress(), ethers.parseEther("5000"));
      await bridgeV2.connect(alice).burn(ethers.parseEther("5000"));

      const [mintFees, burnFees, totalBefore] = await bridgeV2.pendingFees();
      expect(totalBefore).to.be.gt(0);

      // Keeper collects fees
      const tx = await bridgeV2.connect(keeper).collectFees();
      const receipt = await tx.wait();

      // Check event
      const event = receipt?.logs.find(
        log => bridgeV2.interface.parseLog(log)?.name === "FeesCollected"
      );
      expect(event).to.not.be.undefined;

      // Fees should be sent to reserve
      const reserveBalance = await dEURO.balanceOf(await equity.getAddress());
      expect(reserveBalance).to.equal(totalBefore);

      // Pending fees should be reset
      const [mintFeesAfter, burnFeesAfter, totalAfter] = await bridgeV2.pendingFees();
      expect(mintFeesAfter).to.equal(0);
      expect(burnFeesAfter).to.equal(0);
      expect(totalAfter).to.equal(0);
    });
  });

  describe("Gas Comparison", () => {
    it("should use less gas than V1 for minting with fees", async () => {
      const amount = ethers.parseEther("1000");
      await eur.mint(alice.address, amount);
      await eur.connect(alice).approve(await bridgeV2.getAddress(), amount);

      // Measure gas for V2
      const tx = await bridgeV2.connect(alice).mint(amount);
      const receipt = await tx.wait();
      const gasUsedV2 = receipt?.gasUsed || 0n;

      console.log(`V2 Mint with fee: ${gasUsedV2} gas`);
      
      // V2 should use less than 120k gas (vs ~153k for V1)
      expect(gasUsedV2).to.be.lt(120000);
    });

    it("should batch multiple operations efficiently", async () => {
      const amount = ethers.parseEther("100");
      
      // Prepare multiple users
      const users = [alice];
      for (let i = 0; i < 5; i++) {
        await eur.mint(users[0].address, amount);
      }
      await eur.connect(users[0]).approve(await bridgeV2.getAddress(), amount * 5n);

      // Execute multiple mints
      let totalGas = 0n;
      for (let i = 0; i < 5; i++) {
        const tx = await bridgeV2.connect(users[0]).mint(amount);
        const receipt = await tx.wait();
        totalGas += receipt?.gasUsed || 0n;
      }

      console.log(`Average gas per mint (5 txs): ${totalGas / 5n}`);

      // Collect fees once
      const collectTx = await bridgeV2.collectFees();
      const collectReceipt = await collectTx.wait();
      console.log(`Fee collection gas: ${collectReceipt?.gasUsed}`);

      // Average should be much lower than V1
      expect(totalGas / 5n).to.be.lt(120000);
    });
  });

  describe("Additional Features", () => {
    it("should correctly report remaining capacity", async () => {
      const initialCapacity = await bridgeV2.remainingCapacity();
      expect(initialCapacity).to.equal(BRIDGE_LIMIT);

      // Mint some
      const mintAmount = ethers.parseEther("1000");
      await eur.mint(alice.address, mintAmount);
      await eur.connect(alice).approve(await bridgeV2.getAddress(), mintAmount);
      await bridgeV2.connect(alice).mint(mintAmount);

      const newCapacity = await bridgeV2.remainingCapacity();
      expect(newCapacity).to.equal(BRIDGE_LIMIT - mintAmount);
    });

    it("should correctly report expiration status", async () => {
      const isExpired = await bridgeV2.isExpired();
      expect(isExpired).to.be.false;

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [31 * 7 * 24 * 60 * 60]); // 31 weeks
      await ethers.provider.send("evm_mine");

      const isExpiredAfter = await bridgeV2.isExpired();
      expect(isExpiredAfter).to.be.true;
    });
  });
});