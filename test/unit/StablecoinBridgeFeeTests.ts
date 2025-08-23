import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  DecentralizedEURO,
  Equity,
  StablecoinBridge,
  TestToken,
} from "../../typechain";

describe("StablecoinBridge Fee Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let dEURO: DecentralizedEURO;
  let equity: Equity;
  let eur: TestToken;
  let bridge: StablecoinBridge;

  const BRIDGE_LIMIT = ethers.parseEther("1000000");
  const BRIDGE_DURATION_WEEKS = 30;
  const MINT_FEE_PPM = 10000; // 1% mint fee
  const BURN_FEE_PPM = 5000; // 0.5% burn fee

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    // Deploy DecentralizedEURO
    const DecentralizedEUROFactory = await ethers.getContractFactory("DecentralizedEURO");
    dEURO = await DecentralizedEUROFactory.deploy(10 * 86400);

    // Get Equity contract
    const equityAddr = await dEURO.reserve();
    equity = await ethers.getContractAt("Equity", equityAddr);

    // Deploy test EUR token
    const TestTokenFactory = await ethers.getContractFactory("TestToken");
    eur = await TestTokenFactory.deploy("Test EUR", "TEUR", 18);

    // Deploy bridge with fees
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
    await dEURO.initialize(await bridge.getAddress(), "Fee Test Bridge");
  });

  describe("Minting with fees", () => {
    it("should mint correct amount after fee deduction and send fee to reserve", async () => {
      const mintAmount = ethers.parseEther("1000");
      const expectedFee = (mintAmount * BigInt(MINT_FEE_PPM)) / 1000000n;
      const expectedUserAmount = mintAmount - expectedFee;

      // Mint EUR to alice and approve bridge
      await eur.mint(alice.address, mintAmount);
      await eur.connect(alice).approve(await bridge.getAddress(), mintAmount);

      // Check initial balances
      const reserveBalanceBefore = await dEURO.balanceOf(await equity.getAddress());
      
      // Mint through bridge
      await bridge.connect(alice).mint(mintAmount);

      // Check alice received correct amount (minus fee)
      const aliceBalance = await dEURO.balanceOf(alice.address);
      expect(aliceBalance).to.equal(expectedUserAmount);

      // Check reserve received the fee
      const reserveBalanceAfter = await dEURO.balanceOf(await equity.getAddress());
      expect(reserveBalanceAfter - reserveBalanceBefore).to.equal(expectedFee);

      // Check total minted matches
      const totalMinted = await bridge.minted();
      expect(totalMinted).to.equal(mintAmount);
    });

    it("should not charge fee when feePPM is 0", async () => {
      // Deploy bridge without fee
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

      const mintAmount = ethers.parseEther("1000");

      // Mint EUR to bob and approve bridge
      await eur.mint(bob.address, mintAmount);
      await eur.connect(bob).approve(await noFeeBridge.getAddress(), mintAmount);

      // Mint through bridge
      await noFeeBridge.connect(bob).mint(mintAmount);

      // Check bob received full amount
      const bobBalance = await dEURO.balanceOf(bob.address);
      expect(bobBalance).to.equal(mintAmount);

      // Check reserve received nothing
      const reserveBalance = await dEURO.balanceOf(await equity.getAddress());
      expect(reserveBalance).to.equal(0);
    });
  });

  describe("Burning with fees", () => {
    beforeEach(async () => {
      // Setup: Alice mints some dEURO first
      const mintAmount = ethers.parseEther("1000");
      await eur.mint(alice.address, mintAmount);
      await eur.connect(alice).approve(await bridge.getAddress(), mintAmount);
      await bridge.connect(alice).mint(mintAmount);
    });

    it("should burn correct amount and transfer fee to reserve", async () => {
      const burnAmount = ethers.parseEther("500");
      const feeAmount = (burnAmount * BigInt(BURN_FEE_PPM)) / 1000000n;
      const burnAmountNet = burnAmount - feeAmount;

      // Get initial balances
      const aliceEURBefore = await eur.balanceOf(alice.address);
      const alicedEUROBefore = await dEURO.balanceOf(alice.address);
      const reserveBalanceBefore = await dEURO.balanceOf(await equity.getAddress());

      // Approve and burn
      await dEURO.connect(alice).approve(await bridge.getAddress(), burnAmount);
      await bridge.connect(alice).burn(burnAmount);

      // Check alice's dEURO was deducted by full amount
      const alicedEUROAfter = await dEURO.balanceOf(alice.address);
      expect(alicedEUROBefore - alicedEUROAfter).to.equal(burnAmount);

      // Check alice received source tokens for net amount
      const aliceEURAfter = await eur.balanceOf(alice.address);
      expect(aliceEURAfter - aliceEURBefore).to.equal(burnAmountNet);

      // Check reserve received the fee
      const reserveBalanceAfter = await dEURO.balanceOf(await equity.getAddress());
      expect(reserveBalanceAfter - reserveBalanceBefore).to.equal(feeAmount);

      // Check minted was reduced by net amount
      const totalMinted = await bridge.minted();
      expect(totalMinted).to.be.lessThan(ethers.parseEther("1000"));
    });
  });

  describe("Fee calculations", () => {
    it("should calculate fees correctly for various amounts", async () => {
      const testAmounts = [
        ethers.parseEther("1"),
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        ethers.parseEther("10000"),
      ];

      for (const amount of testAmounts) {
        const expectedFee = (amount * BigInt(MINT_FEE_PPM)) / 1000000n;
        const expectedNet = amount - expectedFee;

        // Mint EUR and test
        await eur.mint(alice.address, amount);
        await eur.connect(alice).approve(await bridge.getAddress(), amount);

        const balanceBefore = await dEURO.balanceOf(alice.address);
        await bridge.connect(alice).mint(amount);
        const balanceAfter = await dEURO.balanceOf(alice.address);

        const received = balanceAfter - balanceBefore;
        expect(received).to.equal(expectedNet);
      }
    });
  });
});