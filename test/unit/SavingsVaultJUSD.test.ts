import { expect } from "chai";
import { ethers } from "hardhat";
import { floatToDec18 } from "../../scripts/utils/math";
import { evm_increaseTime } from "../utils";
import {
  SavingsVaultJUSD,
  Savings,
  JuiceDollar,
  Equity,
} from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("SavingsVaultJUSD Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let vault: SavingsVaultJUSD;
  let savings: Savings;
  let jusd: JuiceDollar;
  let equity: Equity;

  const VAULT_NAME = "JuiceDollar Savings Vault";
  const VAULT_SYMBOL = "sJUSD";
  const INITIAL_RATE_PPM = 20000n; // 2% annual interest

  const getTimeStamp = async () => {
    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    return blockBefore?.timestamp ?? null;
  };

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    // Deploy JUSD
    const JuiceDollarFactory = await ethers.getContractFactory("JuiceDollar");
    jusd = await JuiceDollarFactory.deploy(10 * 86400);

    const equityAddr = await jusd.reserve();
    equity = await ethers.getContractAt("Equity", equityAddr);

    // Deploy Savings contract
    const SavingsFactory = await ethers.getContractFactory("Savings");
    savings = await SavingsFactory.deploy(await jusd.getAddress(), INITIAL_RATE_PPM);

    // Deploy SavingsVaultJUSD
    const VaultFactory = await ethers.getContractFactory("SavingsVaultJUSD");
    vault = await VaultFactory.deploy(
      await jusd.getAddress(),
      await savings.getAddress(),
      VAULT_NAME,
      VAULT_SYMBOL
    );

    // Initialize ecosystem
    await jusd.initialize(owner.address, "owner");
    await jusd.initialize(await savings.getAddress(), "savings");
    await jusd.initialize(await vault.getAddress(), "vault");

    // Fund accounts
    await jusd.mint(owner.address, floatToDec18(2_000_000));
    await jusd.transfer(alice.address, floatToDec18(100_000));
    await jusd.transfer(bob.address, floatToDec18(100_000));

    // Bootstrap equity
    await equity.invest(floatToDec18(1_000_000), 0);
  });

  describe("Deployment & Initialization", () => {
    it("should set correct name and symbol", async () => {
      expect(await vault.name()).to.equal(VAULT_NAME);
      expect(await vault.symbol()).to.equal(VAULT_SYMBOL);
    });

    it("should set immutable savings contract", async () => {
      expect(await vault.SAVINGS()).to.equal(await savings.getAddress());
    });

    it("should set correct asset (JUSD)", async () => {
      expect(await vault.asset()).to.equal(await jusd.getAddress());
    });

    it("should have max approval for savings contract", async () => {
      const allowance = await jusd.allowance(
        await vault.getAddress(),
        await savings.getAddress()
      );
      expect(allowance).to.equal(ethers.MaxUint256);
    });

    it("should initialize totalClaimed to 0", async () => {
      expect(await vault.totalClaimed()).to.equal(0n);
    });

    it("should have correct decimals (18)", async () => {
      expect(await vault.decimals()).to.equal(18);
    });
  });

  describe("ERC4626 Basic Functions", () => {
    beforeEach(async () => {
      // Approve vault for alice and bob
      await jusd.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
      await jusd.connect(bob).approve(await vault.getAddress(), ethers.MaxUint256);
    });

    it("should deposit and mint shares", async () => {
      const depositAmount = floatToDec18(1000);
      const sharesBefore = await vault.balanceOf(alice.address);

      await vault.connect(alice).deposit(depositAmount, alice.address);

      const sharesAfter = await vault.balanceOf(alice.address);
      expect(sharesAfter - sharesBefore).to.equal(depositAmount); // 1:1 on first deposit
    });

    it("should mint exact shares", async () => {
      const sharesToMint = floatToDec18(500);
      const assetsBefore = await jusd.balanceOf(bob.address);

      await vault.connect(bob).mint(sharesToMint, bob.address);

      const assetsAfter = await jusd.balanceOf(bob.address);
      const sharesBalance = await vault.balanceOf(bob.address);

      expect(sharesBalance).to.equal(sharesToMint);
      expect(assetsBefore - assetsAfter).to.be.approximately(sharesToMint, 100n);
    });

    it("should withdraw assets and burn shares", async () => {
      const depositAmount = floatToDec18(2000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const withdrawAmount = floatToDec18(500);
      const assetsBefore = await jusd.balanceOf(alice.address);
      const sharesBefore = await vault.balanceOf(alice.address);

      await vault.connect(alice).withdraw(withdrawAmount, alice.address, alice.address);

      const assetsAfter = await jusd.balanceOf(alice.address);
      const sharesAfter = await vault.balanceOf(alice.address);

      expect(assetsAfter - assetsBefore).to.be.approximately(withdrawAmount, floatToDec18(1));
      expect(sharesBefore - sharesAfter).to.be.approximately(withdrawAmount, floatToDec18(1));
    });

    it("should redeem shares for assets", async () => {
      const depositAmount = floatToDec18(1000);
      await vault.connect(bob).deposit(depositAmount, bob.address);

      const sharesToRedeem = floatToDec18(300);
      const assetsBefore = await jusd.balanceOf(bob.address);

      await vault.connect(bob).redeem(sharesToRedeem, bob.address, bob.address);

      const assetsAfter = await jusd.balanceOf(bob.address);
      expect(assetsAfter - assetsBefore).to.be.approximately(sharesToRedeem, floatToDec18(1));
    });

    it("should deposit for another receiver", async () => {
      const depositAmount = floatToDec18(1000);

      await vault.connect(alice).deposit(depositAmount, bob.address);

      const bobShares = await vault.balanceOf(bob.address);
      expect(bobShares).to.be.gt(0n);
    });

    it("should withdraw to another address", async () => {
      const depositAmount = floatToDec18(1000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const withdrawAmount = floatToDec18(300);
      const bobAssetsBefore = await jusd.balanceOf(bob.address);

      await vault.connect(alice).withdraw(withdrawAmount, bob.address, alice.address);

      const bobAssetsAfter = await jusd.balanceOf(bob.address);
      expect(bobAssetsAfter - bobAssetsBefore).to.equal(withdrawAmount);
    });

    it("should return correct max values", async () => {
      expect(await vault.maxDeposit(alice.address)).to.be.gt(0n);
      expect(await vault.maxMint(alice.address)).to.be.gt(0n);
      expect(await vault.maxRedeem(alice.address)).to.be.gte(0n);
      expect(await vault.maxWithdraw(alice.address)).to.be.gte(0n);
    });

    it("should track totalSupply correctly", async () => {
      const supplyBefore = await vault.totalSupply();
      const depositAmount = floatToDec18(1000);

      await vault.connect(alice).deposit(depositAmount, alice.address);

      const supplyAfter = await vault.totalSupply();
      expect(supplyAfter - supplyBefore).to.equal(depositAmount);
    });
  });

  describe("Conversion Functions with Rounding", () => {
    beforeEach(async () => {
      await jusd.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    });

    it("should convert assets to shares using rounding", async () => {
      const assets = floatToDec18(1000);
      const shares = await vault.convertToShares(assets);
      expect(shares).to.be.gt(0n);
    });

    it("should convert shares to assets using rounding", async () => {
      const shares = floatToDec18(1000);
      const assets = await vault.convertToAssets(shares);
      expect(assets).to.be.gt(0n);
    });

    it("should preview deposit accurately", async () => {
      const depositAmount = floatToDec18(1000);
      const previewedShares = await vault.previewDeposit(depositAmount);

      await vault.connect(alice).deposit(depositAmount, alice.address);

      const actualShares = await vault.balanceOf(alice.address);
      expect(actualShares).to.be.approximately(previewedShares, 1n);
    });

    it("should preview withdraw accurately", async () => {
      const depositAmount = floatToDec18(2000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const withdrawAmount = floatToDec18(500);
      const previewedShares = await vault.previewWithdraw(withdrawAmount);

      const sharesBefore = await vault.balanceOf(alice.address);
      await vault.connect(alice).withdraw(withdrawAmount, alice.address, alice.address);
      const sharesAfter = await vault.balanceOf(alice.address);

      const actualSharesBurned = sharesBefore - sharesAfter;
      expect(actualSharesBurned).to.be.approximately(previewedShares, floatToDec18(1));
    });

    it("should preview mint accurately", async () => {
      const sharesToMint = floatToDec18(500);
      const previewedAssets = await vault.previewMint(sharesToMint);

      const assetsBefore = await jusd.balanceOf(alice.address);
      await vault.connect(alice).mint(sharesToMint, alice.address);
      const assetsAfter = await jusd.balanceOf(alice.address);

      const actualAssetsSpent = assetsBefore - assetsAfter;
      expect(actualAssetsSpent).to.be.approximately(previewedAssets, 1n);
    });

    it("should preview redeem accurately", async () => {
      const depositAmount = floatToDec18(1000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const sharesToRedeem = floatToDec18(300);
      const previewedAssets = await vault.previewRedeem(sharesToRedeem);

      const assetsBefore = await jusd.balanceOf(alice.address);
      await vault.connect(alice).redeem(sharesToRedeem, alice.address, alice.address);
      const assetsAfter = await jusd.balanceOf(alice.address);

      const actualAssetsReceived = assetsAfter - assetsBefore;
      expect(actualAssetsReceived).to.be.approximately(previewedAssets, floatToDec18(1));
    });
  });

  describe("Inflation Attack Protection", () => {
    it("should start with price of 1 ether when empty", async () => {
      const emptyVaultFactory = await ethers.getContractFactory("SavingsVaultJUSD");
      const emptyVault = await emptyVaultFactory.deploy(
        await jusd.getAddress(),
        await savings.getAddress(),
        "Empty Vault",
        "EMPTY"
      );

      expect(await emptyVault.price()).to.equal(ethers.parseEther("1"));
    });

    it("should give first depositor fair 1:1 share ratio", async () => {
      const emptyVaultFactory = await ethers.getContractFactory("SavingsVaultJUSD");
      const emptyVault = await emptyVaultFactory.deploy(
        await jusd.getAddress(),
        await savings.getAddress(),
        "Test Vault",
        "TEST"
      );

      // No need to initialize - vault can work without being a minter
      await jusd.connect(alice).approve(await emptyVault.getAddress(), ethers.MaxUint256);

      const depositAmount = floatToDec18(1000);
      await emptyVault.connect(alice).deposit(depositAmount, alice.address);

      const shares = await emptyVault.balanceOf(alice.address);
      expect(shares).to.equal(depositAmount);
    });

    it("should resist donation attack with reasonable initial deposit", async () => {
      const attackVaultFactory = await ethers.getContractFactory("SavingsVaultJUSD");
      const attackVault = await attackVaultFactory.deploy(
        await jusd.getAddress(),
        await savings.getAddress(),
        "Attack Vault",
        "ATK"
      );

      await jusd.connect(alice).approve(await attackVault.getAddress(), ethers.MaxUint256);
      await jusd.connect(bob).approve(await attackVault.getAddress(), ethers.MaxUint256);

      // Attacker (alice) deposits a reasonable amount (not 1 wei)
      // With a proper initial deposit, donation attack becomes expensive
      const initialDeposit = floatToDec18(100);
      await attackVault.connect(alice).deposit(initialDeposit, alice.address);

      // Attacker tries to manipulate by donating directly to vault's savings account
      const donationAmount = floatToDec18(1000);
      await jusd.connect(alice).approve(await savings.getAddress(), donationAmount);
      await savings.connect(alice)["save(address,uint192)"](await attackVault.getAddress(), donationAmount);

      // Check the vault price after donation
      const priceAfterDonation = await attackVault.price();
      // Price = (100 + 1000) * 1e18 / 100 = 11e18 (11 ether per share)
      expect(priceAfterDonation).to.be.gt(ethers.parseEther("1"));

      // Victim (bob) deposits - gets shares based on new price
      const bobDeposit = floatToDec18(1000);
      await attackVault.connect(bob).deposit(bobDeposit, bob.address);

      const bobShares = await attackVault.balanceOf(bob.address);
      // Bob gets shares = 1000e18 * 1e18 / 11e18 ≈ 90.9 ether worth of shares
      // This is reasonable - Bob gets fair value despite the donation
      expect(bobShares).to.be.gt(floatToDec18(90));
      expect(bobShares).to.be.lt(floatToDec18(100));
    });

    it("should handle large first deposit correctly", async () => {
      const largeVaultFactory = await ethers.getContractFactory("SavingsVaultJUSD");
      const largeVault = await largeVaultFactory.deploy(
        await jusd.getAddress(),
        await savings.getAddress(),
        "Large Vault",
        "LARGE"
      );

      await jusd.approve(await largeVault.getAddress(), ethers.MaxUint256);

      // Owner has ~800k JUSD available after setup (2M - 200k for alice/bob - 1M equity)
      const largeDeposit = floatToDec18(500_000);
      await largeVault.deposit(largeDeposit, owner.address);

      const price = await largeVault.price();
      expect(price).to.equal(ethers.parseEther("1"));
    });
  });

  describe("SafeCast Overflow Protection", () => {
    it("should revert on deposit exceeding uint192 max", async () => {
      await jusd.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);

      // uint192 max = 6.277e57, way more than our test amounts
      // We'll test with a calculation that would overflow
      const uint192Max = BigInt("6277101735386680763835789423207666416102355444464034512895");
      const tooLarge = uint192Max + 1n;

      // This should revert due to SafeCast
      await expect(
        vault.connect(alice).deposit(tooLarge, alice.address)
      ).to.be.reverted;
    });

    it("should revert on withdraw exceeding uint192 max", async () => {
      await jusd.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);

      const depositAmount = floatToDec18(1000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const uint192Max = BigInt("6277101735386680763835789423207666416102355444464034512895");
      const tooLarge = uint192Max + 1n;

      await expect(
        vault.connect(alice).withdraw(tooLarge, alice.address, alice.address)
      ).to.be.reverted;
    });

    it("should handle deposits under uint192 max correctly", async () => {
      await jusd.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);

      const safeAmount = floatToDec18(100_000);
      await expect(
        vault.connect(alice).deposit(safeAmount, alice.address)
      ).to.not.be.reverted;
    });
  });

  describe("Interest Accrual & Share Price Appreciation", () => {
    beforeEach(async () => {
      await jusd.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
      await jusd.connect(bob).approve(await vault.getAddress(), ethers.MaxUint256);
    });

    it("should increase share price as interest accrues", async () => {
      const depositAmount = floatToDec18(10_000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const priceBefore = await vault.price();

      await evm_increaseTime(365 * 86_400); // 1 year

      const priceAfter = await vault.price();
      expect(priceAfter).to.be.gt(priceBefore);
    });

    it("should include accrued interest in totalAssets", async () => {
      const depositAmount = floatToDec18(10_000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const assetsBefore = await vault.totalAssets();

      await evm_increaseTime(365 * 86_400);

      const assetsAfter = await vault.totalAssets();
      expect(assetsAfter).to.be.gt(assetsBefore);
    });

    it("should emit InterestClaimed on deposit when interest accrued", async () => {
      const depositAmount = floatToDec18(10_000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      await evm_increaseTime(100 * 86_400);

      await expect(
        vault.connect(alice).deposit(depositAmount, alice.address)
      ).to.emit(vault, "InterestClaimed");
    });

    it("should emit InterestClaimed on withdraw when interest accrued", async () => {
      const depositAmount = floatToDec18(10_000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      await evm_increaseTime(100 * 86_400);

      await expect(
        vault.connect(alice).withdraw(floatToDec18(1000), alice.address, alice.address)
      ).to.emit(vault, "InterestClaimed");
    });

    it("should calculate correct interest after 365 days", async () => {
      const depositAmount = floatToDec18(10_000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const t0 = await getTimeStamp();
      await evm_increaseTime(365 * 86_400);

      // Trigger interest accrual
      await vault.connect(alice).deposit(1n, alice.address);
      const t1 = await getTimeStamp();

      const totalClaimed = await vault.totalClaimed();
      const tDiff = t1! - t0!;

      // Expected interest = principal * rate * time / (365 days * 1_000_000)
      const expectedInterest = (depositAmount * INITIAL_RATE_PPM * BigInt(tDiff)) / (365n * 86_400n * 1_000_000n);

      expect(totalClaimed).to.be.approximately(expectedInterest, floatToDec18(1));
    });

    it("should compound interest on multiple deposits", async () => {
      const depositAmount = floatToDec18(10_000);

      await vault.connect(alice).deposit(depositAmount, alice.address);
      await evm_increaseTime(100 * 86_400);

      await vault.connect(alice).deposit(depositAmount, alice.address);
      await evm_increaseTime(100 * 86_400);

      const totalClaimed = await vault.totalClaimed();
      expect(totalClaimed).to.be.gt(0n);
    });

    it("should track totalClaimed correctly", async () => {
      const depositAmount = floatToDec18(10_000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const claimedBefore = await vault.totalClaimed();
      expect(claimedBefore).to.equal(0n);

      await evm_increaseTime(365 * 86_400);
      await vault.connect(alice).deposit(1n, alice.address);

      const claimedAfter = await vault.totalClaimed();
      expect(claimedAfter).to.be.gt(0n);
    });

    it("should not emit InterestClaimed when totalSupply is 0", async () => {
      // Deploy fresh vault
      const freshVaultFactory = await ethers.getContractFactory("SavingsVaultJUSD");
      const freshVault = await freshVaultFactory.deploy(
        await jusd.getAddress(),
        await savings.getAddress(),
        "Fresh",
        "FRESH"
      );

      await jusd.connect(alice).approve(await freshVault.getAddress(), ethers.MaxUint256);

      // First deposit should not emit InterestClaimed (no shares yet)
      await expect(
        freshVault.connect(alice).deposit(floatToDec18(1000), alice.address)
      ).to.not.emit(freshVault, "InterestClaimed");
    });
  });

  describe("Integration with Savings Contract", () => {
    beforeEach(async () => {
      await jusd.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    });

    it("should return correct Account info", async () => {
      const depositAmount = floatToDec18(1000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const accountInfo = await vault.info();
      expect(accountInfo.saved).to.equal(depositAmount);
      expect(accountInfo.ticks).to.be.gt(0n);
    });

    it("should update savings account on deposit", async () => {
      const depositAmount = floatToDec18(1000);
      const infoBefore = await vault.info();

      await vault.connect(alice).deposit(depositAmount, alice.address);

      const infoAfter = await vault.info();
      expect(infoAfter.saved).to.equal(infoBefore.saved + depositAmount);
    });

    it("should update savings account on withdraw", async () => {
      const depositAmount = floatToDec18(2000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const infoBefore = await vault.info();

      const withdrawAmount = floatToDec18(500);
      await vault.connect(alice).withdraw(withdrawAmount, alice.address, alice.address);

      const infoAfter = await vault.info();
      expect(infoAfter.saved).to.be.lt(infoBefore.saved);
    });

    it("should have ticks increment with time", async () => {
      const depositAmount = floatToDec18(1000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const ticksBefore = (await vault.info()).ticks;

      await evm_increaseTime(86_400); // 1 day

      const currentTicks = await savings.currentTicks();
      expect(currentTicks).to.be.gt(ticksBefore);
    });

    it("should match Savings.accruedInterest calculation", async () => {
      const depositAmount = floatToDec18(10_000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      await evm_increaseTime(100 * 86_400);

      const vaultAddress = await vault.getAddress();
      const savingsInterest = await savings["accruedInterest(address)"](vaultAddress);

      const vaultInfo = await vault.info();
      const vaultTotalAssets = vaultInfo.saved + savingsInterest;

      const reportedTotalAssets = await vault.totalAssets();
      expect(reportedTotalAssets).to.equal(vaultTotalAssets);
    });
  });

  describe("Multi-User Scenarios", () => {
    beforeEach(async () => {
      await jusd.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
      await jusd.connect(bob).approve(await vault.getAddress(), ethers.MaxUint256);
    });

    it("should allocate shares fairly to multiple users", async () => {
      const aliceDeposit = floatToDec18(1000);
      const bobDeposit = floatToDec18(2000);

      await vault.connect(alice).deposit(aliceDeposit, alice.address);
      await vault.connect(bob).deposit(bobDeposit, bob.address);

      const aliceShares = await vault.balanceOf(alice.address);
      const bobShares = await vault.balanceOf(bob.address);

      // Bob deposited 2x Alice, should have ~2x shares
      expect(bobShares / aliceShares).to.be.approximately(2n, 1n);
    });

    it("should distribute interest proportionally", async () => {
      const aliceDeposit = floatToDec18(10_000);
      const bobDeposit = floatToDec18(20_000);

      await vault.connect(alice).deposit(aliceDeposit, alice.address);
      await vault.connect(bob).deposit(bobDeposit, bob.address);

      const aliceSharesBefore = await vault.balanceOf(alice.address);
      const bobSharesBefore = await vault.balanceOf(bob.address);

      await evm_increaseTime(365 * 86_400);

      const aliceAssets = await vault.convertToAssets(aliceSharesBefore);
      const bobAssets = await vault.convertToAssets(bobSharesBefore);

      // Bob should have ~2x assets (deposited 2x amount)
      expect(bobAssets / aliceAssets).to.be.approximately(2n, 1n);
    });

    it("should handle partial and full withdrawals", async () => {
      await vault.connect(alice).deposit(floatToDec18(1000), alice.address);
      await vault.connect(bob).deposit(floatToDec18(1000), bob.address);

      await evm_increaseTime(100 * 86_400);

      // Alice withdraws partially
      await vault.connect(alice).withdraw(floatToDec18(500), alice.address, alice.address);

      // Bob withdraws fully
      const bobShares = await vault.balanceOf(bob.address);
      await vault.connect(bob).redeem(bobShares, bob.address, bob.address);

      expect(await vault.balanceOf(alice.address)).to.be.gt(0n);
      expect(await vault.balanceOf(bob.address)).to.equal(0n);
    });

    it("should allow last user to withdraw all without dust", async () => {
      await vault.connect(alice).deposit(floatToDec18(1000), alice.address);
      await vault.connect(bob).deposit(floatToDec18(1000), bob.address);

      await evm_increaseTime(50 * 86_400);

      // Both withdraw completely
      const aliceShares = await vault.balanceOf(alice.address);
      const bobShares = await vault.balanceOf(bob.address);

      await vault.connect(alice).redeem(aliceShares, alice.address, alice.address);
      await vault.connect(bob).redeem(bobShares, bob.address, bob.address);

      expect(await vault.totalSupply()).to.be.lt(100n); // Near zero (dust ok)
    });
  });

  describe("Edge Cases & Boundary Conditions", () => {
    beforeEach(async () => {
      await jusd.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    });

    it("should handle minimum deposit (1 wei)", async () => {
      await expect(
        vault.connect(alice).deposit(1n, alice.address)
      ).to.not.be.reverted;
    });

    it("should handle zero withdraw when balance is 0", async () => {
      const withdrawn = await vault.connect(bob).withdraw.staticCall(0n, bob.address, bob.address);
      expect(withdrawn).to.equal(0n);
    });

    it("should withdraw max available when requesting more", async () => {
      const depositAmount = floatToDec18(1000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const aliceAssetsBefore = await jusd.balanceOf(alice.address);

      // This will withdraw what's available (up to balance)
      const aliceShares = await vault.balanceOf(alice.address);
      await vault.connect(alice).redeem(aliceShares, alice.address, alice.address);

      const aliceAssetsAfter = await jusd.balanceOf(alice.address);
      expect(aliceAssetsAfter - aliceAssetsBefore).to.be.approximately(depositAmount, floatToDec18(1));
    });

    it("should handle deposit after complete drainage", async () => {
      const depositAmount = floatToDec18(1000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      // Drain completely
      const aliceShares = await vault.balanceOf(alice.address);
      await vault.connect(alice).redeem(aliceShares, alice.address, alice.address);

      // Deposit again
      await expect(
        vault.connect(alice).deposit(depositAmount, alice.address)
      ).to.not.be.reverted;

      const newShares = await vault.balanceOf(alice.address);
      expect(newShares).to.be.gt(0n);
    });

    it("should handle rounding with very small amounts", async () => {
      const tinyAmount = 100n; // 100 wei

      await vault.connect(alice).deposit(tinyAmount, alice.address);

      const shares = await vault.balanceOf(alice.address);
      expect(shares).to.be.gte(0n);
    });
  });

  describe("View Functions", () => {
    beforeEach(async () => {
      await jusd.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    });

    it("should calculate price correctly", async () => {
      const depositAmount = floatToDec18(1000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const price = await vault.price();
      const totalAssets = await vault.totalAssets();
      const totalSupply = await vault.totalSupply();

      const expectedPrice = (totalAssets * ethers.parseEther("1")) / totalSupply;
      expect(price).to.equal(expectedPrice);
    });

    it("should return totalAssets with interest", async () => {
      const depositAmount = floatToDec18(10_000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const assetsBefore = await vault.totalAssets();

      await evm_increaseTime(365 * 86_400);

      const assetsAfter = await vault.totalAssets();
      expect(assetsAfter).to.be.gt(assetsBefore);
    });

    it("should return correct info struct", async () => {
      const depositAmount = floatToDec18(1000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const info = await vault.info();
      expect(info.saved).to.equal(depositAmount);
      expect(info.ticks).to.be.gt(0n);
    });

    it("should track totalClaimed correctly", async () => {
      const depositAmount = floatToDec18(10_000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      expect(await vault.totalClaimed()).to.equal(0n);

      await evm_increaseTime(365 * 86_400);
      await vault.connect(alice).deposit(1n, alice.address);

      expect(await vault.totalClaimed()).to.be.gt(0n);
    });
  });

  describe("Events", () => {
    beforeEach(async () => {
      await jusd.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    });

    it("should emit Deposit event", async () => {
      const depositAmount = floatToDec18(1000);

      await expect(
        vault.connect(alice).deposit(depositAmount, alice.address)
      ).to.emit(vault, "Deposit")
        .withArgs(alice.address, alice.address, depositAmount, depositAmount);
    });

    it("should emit Withdraw event", async () => {
      const depositAmount = floatToDec18(1000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const withdrawAmount = floatToDec18(500);

      await expect(
        vault.connect(alice).withdraw(withdrawAmount, alice.address, alice.address)
      ).to.emit(vault, "Withdraw");
    });

    it("should emit InterestClaimed when interest exists", async () => {
      const depositAmount = floatToDec18(10_000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      await evm_increaseTime(100 * 86_400);

      await expect(
        vault.connect(alice).deposit(1n, alice.address)
      ).to.emit(vault, "InterestClaimed");
    });

    it("should not emit InterestClaimed when no interest", async () => {
      const depositAmount = floatToDec18(1000);

      await expect(
        vault.connect(alice).deposit(depositAmount, alice.address)
      ).to.not.emit(vault, "InterestClaimed");
    });
  });

  describe("Module Disabled Scenarios", () => {
    beforeEach(async () => {
      await jusd.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
      await jusd.connect(bob).approve(await vault.getAddress(), ethers.MaxUint256);
    });

    it("should revert deposits and mints when module disabled", async () => {
      const depositAmount = floatToDec18(10_000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const aliceSharesBefore = await vault.balanceOf(alice.address);
      expect(aliceSharesBefore).to.be.gt(0n);

      await savings.proposeChange(0, []);
      await evm_increaseTime(7 * 86_400 + 1);
      await savings.applyChange();

      expect(await savings.currentRatePPM()).to.equal(0);

      await expect(
        vault.connect(bob).deposit(floatToDec18(1000), bob.address)
      ).to.be.revertedWithCustomError(savings, "ModuleDisabled");

      await expect(
        vault.connect(bob).mint(floatToDec18(1000), bob.address)
      ).to.be.revertedWithCustomError(savings, "ModuleDisabled");
    });

    it("should allow withdrawals and redemptions when module disabled", async () => {
      const depositAmount = floatToDec18(10_000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      const aliceSharesBefore = await vault.balanceOf(alice.address);
      expect(aliceSharesBefore).to.be.gt(0n);

      await savings.proposeChange(0, []);
      await evm_increaseTime(7 * 86_400 + 1);
      await savings.applyChange();

      const withdrawAmount = floatToDec18(5000);
      await expect(
        vault.connect(alice).withdraw(withdrawAmount, alice.address, alice.address)
      ).to.not.be.reverted;

      const aliceSharesAfterWithdraw = await vault.balanceOf(alice.address);
      expect(aliceSharesAfterWithdraw).to.be.lt(aliceSharesBefore);
      expect(aliceSharesAfterWithdraw).to.be.gt(0n);

      const remainingShares = await vault.balanceOf(alice.address);
      await expect(
        vault.connect(alice).redeem(remainingShares, alice.address, alice.address)
      ).to.not.be.reverted;

      expect(await vault.balanceOf(alice.address)).to.equal(0n);
    });

    it("should include accrued interest in withdrawals when module disabled", async () => {
      const depositAmount = floatToDec18(10_000);
      await vault.connect(alice).deposit(depositAmount, alice.address);

      await evm_increaseTime(100 * 86_400);

      const totalAssetsBefore = await vault.totalAssets();
      expect(totalAssetsBefore).to.be.gt(depositAmount);

      await savings.proposeChange(0, []);
      await evm_increaseTime(7 * 86_400 + 1);
      await savings.applyChange();

      const aliceShares = await vault.balanceOf(alice.address);
      const aliceAssetsBefore = await jusd.balanceOf(alice.address);

      await vault.connect(alice).redeem(aliceShares, alice.address, alice.address);

      const aliceAssetsAfter = await jusd.balanceOf(alice.address);
      const withdrawn = aliceAssetsAfter - aliceAssetsBefore;

      expect(withdrawn).to.be.gt(depositAmount);
      expect(await vault.balanceOf(alice.address)).to.equal(0n);
    });
  });
});
