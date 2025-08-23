import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  DecentralizedEURO,
  Equity,
  StablecoinBridge,
  TestToken,
} from "../../typechain";

describe("Bidirectional Fee Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;

  let dEURO: DecentralizedEURO;
  let equity: Equity;
  let eur: TestToken;
  let bridge: StablecoinBridge;

  const BRIDGE_LIMIT = ethers.parseEther("1000000");
  const BRIDGE_DURATION_WEEKS = 30;
  
  // Different fees for each direction
  const MINT_FEE_PPM = 1000; // 0.1% for EUR → dEURO
  const BURN_FEE_PPM = 500;  // 0.05% for dEURO → EUR

  beforeEach(async () => {
    [owner, alice] = await ethers.getSigners();

    // Deploy DecentralizedEURO
    const DecentralizedEUROFactory = await ethers.getContractFactory("DecentralizedEURO");
    dEURO = await DecentralizedEUROFactory.deploy(10 * 86400);

    // Get Equity contract
    const equityAddr = await dEURO.reserve();
    equity = await ethers.getContractAt("Equity", equityAddr);

    // Deploy test EUR token
    const TestTokenFactory = await ethers.getContractFactory("TestToken");
    eur = await TestTokenFactory.deploy("Test EUR", "TEUR", 18);

    // Deploy bridge with different fees for each direction
    const StablecoinBridgeFactory = await ethers.getContractFactory("StablecoinBridge");
    bridge = await StablecoinBridgeFactory.deploy(
      await eur.getAddress(),
      await dEURO.getAddress(),
      BRIDGE_LIMIT,
      BRIDGE_DURATION_WEEKS,
      MINT_FEE_PPM,
      BURN_FEE_PPM
    );

    // Initialize dEURO with bridge as minter
    await dEURO.initialize(await bridge.getAddress(), "Bidirectional Fee Bridge");
  });

  describe("Different fees for mint and burn", () => {
    it("should apply 0.1% fee on minting (EUR → dEURO)", async () => {
      const mintAmount = ethers.parseEther("10000");
      const expectedMintFee = (mintAmount * BigInt(MINT_FEE_PPM)) / 1000000n; // 10 dEURO fee
      const expectedUserAmount = mintAmount - expectedMintFee; // 9990 dEURO

      // Mint EUR to alice and approve bridge
      await eur.mint(alice.address, mintAmount);
      await eur.connect(alice).approve(await bridge.getAddress(), mintAmount);

      // Mint through bridge
      await bridge.connect(alice).mint(mintAmount);

      // Check alice received correct amount after 0.1% fee
      const aliceBalance = await dEURO.balanceOf(alice.address);
      expect(aliceBalance).to.equal(expectedUserAmount);
      expect(aliceBalance).to.equal(ethers.parseEther("9990")); // 10000 - 0.1% = 9990

      // Check reserve received the mint fee
      const reserveBalance = await dEURO.balanceOf(await equity.getAddress());
      expect(reserveBalance).to.equal(expectedMintFee);
      expect(reserveBalance).to.equal(ethers.parseEther("10")); // 0.1% of 10000 = 10
    });

    it("should apply 0.05% fee on burning (dEURO → EUR)", async () => {
      // First mint some dEURO
      const mintAmount = ethers.parseEther("10000");
      await eur.mint(alice.address, mintAmount);
      await eur.connect(alice).approve(await bridge.getAddress(), mintAmount);
      await bridge.connect(alice).mint(mintAmount);

      // Now burn half of it
      const burnAmount = ethers.parseEther("5000");
      const expectedBurnFee = (burnAmount * BigInt(BURN_FEE_PPM)) / 1000000n; // 2.5 dEURO fee
      const expectedEurReturn = burnAmount - expectedBurnFee; // 4997.5 EUR

      const alicedEUROBefore = await dEURO.balanceOf(alice.address);
      const reserveBefore = await dEURO.balanceOf(await equity.getAddress());

      // Approve and burn
      await dEURO.connect(alice).approve(await bridge.getAddress(), burnAmount);
      await bridge.connect(alice).burn(burnAmount);

      // Check alice's dEURO was deducted by full amount
      const alicedEUROAfter = await dEURO.balanceOf(alice.address);
      expect(alicedEUROBefore - alicedEUROAfter).to.equal(burnAmount);

      // Check alice received EUR minus the 0.05% fee
      const aliceEURBalance = await eur.balanceOf(alice.address);
      expect(aliceEURBalance).to.equal(expectedEurReturn);
      expect(aliceEURBalance).to.equal(ethers.parseEther("4997.5")); // 5000 - 0.05% = 4997.5

      // Check reserve received the burn fee
      const reserveAfter = await dEURO.balanceOf(await equity.getAddress());
      expect(reserveAfter - reserveBefore).to.equal(expectedBurnFee);
      expect(reserveAfter - reserveBefore).to.equal(ethers.parseEther("2.5")); // 0.05% of 5000 = 2.5
    });

    it("should correctly track fee amounts in reserve", async () => {
      // Execute multiple transactions
      const transactions = [
        { type: "mint", amount: ethers.parseEther("1000") },
        { type: "mint", amount: ethers.parseEther("2000") },
        { type: "burn", amount: ethers.parseEther("500") },
        { type: "mint", amount: ethers.parseEther("1500") },
        { type: "burn", amount: ethers.parseEther("1000") },
      ];

      let totalMintFees = 0n;
      let totalBurnFees = 0n;
      let aliceEUR = ethers.parseEther("10000"); // Start with enough EUR
      
      await eur.mint(alice.address, aliceEUR);
      await eur.connect(alice).approve(await bridge.getAddress(), aliceEUR);

      for (const tx of transactions) {
        if (tx.type === "mint") {
          await bridge.connect(alice).mint(tx.amount);
          totalMintFees += (tx.amount * BigInt(MINT_FEE_PPM)) / 1000000n;
        } else {
          await dEURO.connect(alice).approve(await bridge.getAddress(), tx.amount);
          await bridge.connect(alice).burn(tx.amount);
          totalBurnFees += (tx.amount * BigInt(BURN_FEE_PPM)) / 1000000n;
        }
      }

      // Check total fees in reserve
      const reserveBalance = await dEURO.balanceOf(await equity.getAddress());
      const expectedTotalFees = totalMintFees + totalBurnFees;
      
      expect(reserveBalance).to.equal(expectedTotalFees);
      
      // Verify expected values
      // Mint fees: (1000 + 2000 + 1500) * 0.001 = 4.5 dEURO
      // Burn fees: (500 + 1000) * 0.0005 = 0.75 dEURO
      // Total: 5.25 dEURO
      expect(reserveBalance).to.equal(ethers.parseEther("5.25"));
    });
  });

  describe("Fee verification", () => {
    it("should have correct fee rates set", async () => {
      const mintFee = await bridge.mintFeePPM();
      const burnFee = await bridge.burnFeePPM();
      
      expect(mintFee).to.equal(MINT_FEE_PPM);
      expect(burnFee).to.equal(BURN_FEE_PPM);
    });

    it("should work with zero fees", async () => {
      // Deploy bridge with no fees
      const StablecoinBridgeFactory = await ethers.getContractFactory("StablecoinBridge");
      const noFeeBridge = await StablecoinBridgeFactory.deploy(
        await eur.getAddress(),
        await dEURO.getAddress(),
        BRIDGE_LIMIT,
        BRIDGE_DURATION_WEEKS,
        0, // No mint fee
        0  // No burn fee
      );

      await dEURO.initialize(await noFeeBridge.getAddress(), "No Fee Bridge");

      const amount = ethers.parseEther("1000");
      await eur.mint(alice.address, amount);
      await eur.connect(alice).approve(await noFeeBridge.getAddress(), amount);
      
      // Mint without fees
      await noFeeBridge.connect(alice).mint(amount);
      expect(await dEURO.balanceOf(alice.address)).to.equal(amount);
      
      // Burn without fees
      await dEURO.connect(alice).approve(await noFeeBridge.getAddress(), amount);
      await noFeeBridge.connect(alice).burn(amount);
      expect(await eur.balanceOf(alice.address)).to.equal(amount);
      
      // No fees should go to reserve
      expect(await dEURO.balanceOf(await equity.getAddress())).to.equal(0);
    });
  });
});