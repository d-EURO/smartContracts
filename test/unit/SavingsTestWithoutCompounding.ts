import { expect } from "chai";
import { floatToDec18 } from "../../scripts/utils/math";
import { ethers } from "hardhat";
import { evm_increaseTime } from "../utils";
import {
  JuiceDollar,
  Equity,
  MintingHub,
  Savings,
  PositionRoller,
  PositionFactory,
  StablecoinBridge,
  TestToken,
} from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Savings Optional Compounding Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let jusd: JuiceDollar;
  let equity: Equity;
  let savings: Savings;
  let mintingHub: MintingHub;
  let roller: PositionRoller;
  let bridge: StablecoinBridge;
  let mockXUSD: TestToken;

  before(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    const JuiceDollarFactory = await ethers.getContractFactory("JuiceDollar");
    jusd = await JuiceDollarFactory.deploy(10 * 86400);

    const equityAddress = await jusd.reserve();
    equity = await ethers.getContractAt("Equity", equityAddress);

    const positionFactoryFactory = await ethers.getContractFactory("PositionFactory");
    const positionFactory = await positionFactoryFactory.deploy();

    const savingsFactory = await ethers.getContractFactory("Savings");
    savings = await savingsFactory.deploy(jusd.getAddress(), 100_000n); // 10% APR

    const rollerFactory = await ethers.getContractFactory("PositionRoller");
    roller = await rollerFactory.deploy(jusd.getAddress());

    const mintingHubFactory = await ethers.getContractFactory("MintingHub");
    mintingHub = await mintingHubFactory.deploy(
      await jusd.getAddress(),
      100_000, // initialRatePPM (10%)
      await roller.getAddress(),
      await positionFactory.getAddress(),
      ethers.ZeroAddress,
    );

    // Bootstrap with bridge
    const coinFactory = await ethers.getContractFactory("TestToken");
    mockXUSD = await coinFactory.deploy("MockUSD", "MUSD", 18);

    const limit = floatToDec18(1_000_000);
    const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
    bridge = await bridgeFactory.deploy(
      await mockXUSD.getAddress(),
      await jusd.getAddress(),
      limit,
      30,
    );

    await jusd.initialize(owner.address, "owner");
    await jusd.initialize(await mintingHub.getAddress(), "mintingHub");
    await jusd.initialize(await savings.getAddress(), "savings");
    await jusd.initialize(await bridge.getAddress(), "bridge");

    // Mint JUSD via bridge
    await mockXUSD.mint(owner.address, floatToDec18(500_000));
    await mockXUSD.approve(await bridge.getAddress(), floatToDec18(500_000));
    await bridge.mint(floatToDec18(300_000));

    // Fund equity for interest distribution
    await jusd.approve(await equity.getAddress(), floatToDec18(100_000));
    await equity.invest(floatToDec18(100_000), 0);

    // Fund alice and bob
    await jusd.transfer(alice.address, floatToDec18(50_000));
    await jusd.transfer(bob.address, floatToDec18(50_000));
  });

  describe("Default compounding behavior", () => {
    it("should compound by default (nonCompounding is false)", async () => {
      expect(await savings.nonCompounding(alice.address)).to.be.false;
    });

    it("should add interest to saved balance when compounding", async () => {
      const saveAmount = floatToDec18(10_000);
      await jusd.connect(alice).approve(await savings.getAddress(), saveAmount);
      await savings.connect(alice)["save(uint192)"](saveAmount);

      const balanceBefore = (await savings.savings(alice.address)).saved;

      // Advance time to accrue interest
      await evm_increaseTime(365 * 86400); // 1 year

      await savings.connect(alice).refreshMyBalance();
      const balanceAfter = (await savings.savings(alice.address)).saved;

      expect(balanceAfter).to.be.gt(balanceBefore);
      expect(await savings.claimableInterest(alice.address)).to.equal(0);
    });
  });

  describe("Non-compounding mode", () => {
    it("should set non-compounding mode via save(amount, false)", async () => {
      const saveAmount = floatToDec18(10_000);
      await jusd.connect(bob).approve(await savings.getAddress(), saveAmount);
      await savings.connect(bob)["save(uint192,bool)"](saveAmount, false);

      expect(await savings.nonCompounding(bob.address)).to.be.true;
    });

    it("should route interest to claimableInterest when non-compounding", async () => {
      // Advance time to accrue interest
      await evm_increaseTime(365 * 86400); // 1 year

      await savings.connect(bob).refreshMyBalance();
      const savedBalance = (await savings.savings(bob.address)).saved;
      const claimable = await savings.claimableInterest(bob.address);

      // Saved balance should remain roughly the same (only the initial deposit)
      expect(savedBalance).to.equal(floatToDec18(10_000));
      // Claimable interest should be > 0
      expect(claimable).to.be.gt(0);
    });

    it("should emit InterestCollected with compounded=false", async () => {
      await evm_increaseTime(30 * 86400); // 30 days

      await expect(savings.connect(bob).refreshMyBalance())
        .to.emit(savings, "InterestCollected")
        .withArgs(bob.address, (val: bigint) => val > 0n, false);
    });
  });

  describe("claimInterest", () => {
    it("should transfer claimable interest and zero the balance", async () => {
      // Refresh first to lock in claimable, then claim in the same block concept
      await savings.connect(bob).refreshMyBalance();
      const claimableBefore = await savings.claimableInterest(bob.address);
      expect(claimableBefore).to.be.gt(0);

      const jusdBalanceBefore = await jusd.balanceOf(bob.address);
      await savings.connect(bob).claimInterest(bob.address);
      const jusdBalanceAfter = await jusd.balanceOf(bob.address);

      // claimInterest calls refresh again, which may accrue tiny additional interest
      // so the transferred amount will be >= claimableBefore but bounded
      expect(jusdBalanceAfter - jusdBalanceBefore).to.be.gte(claimableBefore);
      expect(jusdBalanceAfter - jusdBalanceBefore).to.be.lte(claimableBefore + floatToDec18(1));
      expect(await savings.claimableInterest(bob.address)).to.equal(0);
    });

    it("should transfer claimable interest to a different target", async () => {
      // Accrue more interest for bob
      await evm_increaseTime(90 * 86400);
      await savings.connect(bob).refreshMyBalance();

      const claimableBefore = await savings.claimableInterest(bob.address);
      expect(claimableBefore).to.be.gt(0);

      const aliceBalanceBefore = await jusd.balanceOf(alice.address);

      // Bob claims interest but sends to alice
      await savings.connect(bob).claimInterest(alice.address);

      const aliceBalanceAfter = await jusd.balanceOf(alice.address);

      // Tokens should go to alice, not bob
      expect(aliceBalanceAfter - aliceBalanceBefore).to.be.gte(claimableBefore);
      // Bob's claimable should be zeroed
      expect(await savings.claimableInterest(bob.address)).to.equal(0);
    });

    it("should preserve claimableInterest after full withdrawal", async () => {
      // Accrue more interest for bob
      await evm_increaseTime(90 * 86400);
      await savings.connect(bob).refreshMyBalance();

      const claimableBefore = await savings.claimableInterest(bob.address);
      expect(claimableBefore).to.be.gt(0);

      // Full withdrawal
      const savedBalance = (await savings.savings(bob.address)).saved;
      await savings.connect(bob).withdraw(bob.address, savedBalance);

      // claimableInterest should still be > 0 after withdrawal
      const claimableAfter = await savings.claimableInterest(bob.address);
      expect(claimableAfter).to.be.gte(claimableBefore);

      // Claiming should succeed and transfer the interest
      const bobBalanceBefore = await jusd.balanceOf(bob.address);
      await savings.connect(bob).claimInterest(bob.address);
      const bobBalanceAfter = await jusd.balanceOf(bob.address);

      expect(bobBalanceAfter - bobBalanceBefore).to.be.gte(claimableAfter);
      expect(await savings.claimableInterest(bob.address)).to.equal(0);
    });

    it("should emit InterestClaimed event", async () => {
      // Re-deposit for bob (previous test did full withdrawal + claim)
      const redeposit = floatToDec18(10_000);
      await jusd.connect(bob).approve(await savings.getAddress(), redeposit);
      await savings.connect(bob)["save(uint192,bool)"](redeposit, false);

      // Accrue more interest first
      await evm_increaseTime(90 * 86400);
      await savings.connect(bob).refreshMyBalance();

      // Claim and check the event is emitted (don't check exact amount as more may accrue)
      await expect(savings.connect(bob).claimInterest(bob.address))
        .to.emit(savings, "InterestClaimed");
    });

    it("should return 0 when no interest to claim", async () => {
      // Bob just claimed, so claimable should be 0
      const claimable = await savings.claimableInterest(bob.address);
      expect(claimable).to.equal(0);

      const result = await savings.connect(bob).claimInterest.staticCall(bob.address);
      expect(result).to.equal(0);
    });
  });

  describe("Mode switching", () => {
    it("should switch from compounding to non-compounding", async () => {
      expect(await savings.nonCompounding(alice.address)).to.be.false;

      // Save with non-compounding
      await jusd.connect(alice).approve(await savings.getAddress(), floatToDec18(100));
      await savings.connect(alice)["save(uint192,bool)"](floatToDec18(100), false);

      expect(await savings.nonCompounding(alice.address)).to.be.true;
    });

    it("should switch from non-compounding back to compounding", async () => {
      expect(await savings.nonCompounding(alice.address)).to.be.true;

      await jusd.connect(alice).approve(await savings.getAddress(), floatToDec18(100));
      await savings.connect(alice)["save(uint192,bool)"](floatToDec18(100), true);

      expect(await savings.nonCompounding(alice.address)).to.be.false;
    });
  });

  describe("Multi-user isolation", () => {
    it("should not affect other users' compounding mode", async () => {
      // At this point: Alice switched back to compounding, Bob is non-compounding
      expect(await savings.nonCompounding(alice.address)).to.be.false;
      expect(await savings.nonCompounding(bob.address)).to.be.true;
    });

    it("should route interest correctly per user's mode", async () => {
      // Claim any pending interest for both users first to start clean
      await savings.connect(alice).claimInterest(alice.address);
      await savings.connect(bob).claimInterest(bob.address);

      // Advance time to accrue new interest
      await evm_increaseTime(180 * 86400);

      // Refresh both
      await savings.connect(alice).refreshMyBalance();
      await savings.connect(bob).refreshMyBalance();

      // Alice: compounding -> no new claimable interest (interest added to saved)
      const aliceClaimable = await savings.claimableInterest(alice.address);
      expect(aliceClaimable).to.equal(0);

      // Bob: non-compounding -> interest in claimable
      const bobClaimable = await savings.claimableInterest(bob.address);
      expect(bobClaimable).to.be.gt(0);
    });
  });

  describe("Non-compounding interest is linear", () => {
    it("interest across multiple periods equals simple interest, not compound", async () => {
      const saveAmount = floatToDec18(10_000);
      const RATE_PPM = 100_000n; // matches the 10% rate used in before()

      // Owner: non-compounding
      await jusd.approve(await savings.getAddress(), saveAmount);
      await savings["save(uint192,bool)"](saveAmount, false);
      const t0 = (await ethers.provider.getBlock("latest"))?.timestamp ?? 0;

      // Alice: compounding — same amount, approximately same time
      await jusd.connect(alice).approve(await savings.getAddress(), saveAmount);
      await savings.connect(alice)["save(uint192)"](saveAmount);

      // Period 1
      await evm_increaseTime(180 * 86_400);
      await savings.refreshBalance(owner.address);
      await savings.refreshBalance(alice.address);

      // Period 2
      await evm_increaseTime(180 * 86_400);
      await savings.refreshBalance(owner.address);
      const t2 = (await ethers.provider.getBlock("latest"))?.timestamp ?? 0;
      await savings.refreshBalance(alice.address);

      // Non-compounding: principal unchanged
      const ownerAccount = await savings.savings(owner.address);
      expect(ownerAccount.saved).to.eq(saveAmount);

      // Total claimable matches linear formula for the entire duration
      const totalClaimable = await savings.claimableInterest(owner.address);
      const totalTime = BigInt(t2 - t0);
      const expectedLinear =
        (saveAmount * RATE_PPM * totalTime) / (1_000_000n * 365n * 86_400n);
      // Integer division across two periods may lose at most 1 wei vs single-shot formula
      expect(totalClaimable).to.be.gte(expectedLinear - 1n);
      expect(totalClaimable).to.be.lte(expectedLinear);

      // Compounding user earns strictly more (interest-on-interest effect)
      const aliceAccount = await savings.savings(alice.address);
      const aliceInterest = aliceAccount.saved - saveAmount;
      expect(aliceInterest).to.be.gt(totalClaimable);

      // Clean up
      await savings.withdraw(owner.address, saveAmount * 2n);
      await savings.claimInterest(owner.address);
      await savings.connect(alice).withdraw(alice.address, saveAmount * 2n);
    });
  });

  describe("Mode switching (detailed)", () => {
    let snapshotId: string;

    beforeEach(async () => {
      snapshotId = await ethers.provider.send("evm_snapshot", []);
    });

    afterEach(async () => {
      await ethers.provider.send("evm_revert", [snapshotId]);
    });

    it("save(amount, true) switches to compounding; prior non-compounding interest preserved in claimable", async () => {
      const saveAmount = floatToDec18(10_000);

      // Withdraw any residual state from previous tests
      const bobSaved = (await savings.savings(bob.address)).saved;
      if (bobSaved > 0n) await savings.connect(bob).withdraw(bob.address, bobSaved * 2n);
      const bobClaim = await savings.claimableInterest(bob.address);
      if (bobClaim > 0n) await savings.connect(bob).claimInterest(bob.address);

      // Start non-compounding
      await jusd.connect(bob).approve(await savings.getAddress(), saveAmount);
      await savings.connect(bob)["save(uint192,bool)"](saveAmount, false);
      expect(await savings.nonCompounding(bob.address)).to.eq(true);

      await evm_increaseTime(180 * 86_400);

      // Verify non-compounding phase accumulated interest before switching
      const pendingInterest = await savings["accruedInterest(address)"](bob.address);
      expect(pendingInterest).to.be.gt(0n);

      // Switch to compounding — pending interest settles under OLD mode (non-compounding),
      // so it goes to claimableInterest, not saved
      await savings.connect(bob)["save(uint192,bool)"](0, true);
      expect(await savings.nonCompounding(bob.address)).to.eq(false);

      const accountAfterSwitch = await savings.savings(bob.address);
      expect(accountAfterSwitch.saved).to.eq(saveAmount);
      // Interest settled under old non-compounding mode goes to claimable
      expect(await savings.claimableInterest(bob.address)).to.be.gt(0n);

      // Interest earned from here should compound under new mode
      await evm_increaseTime(180 * 86_400);
      await savings.refreshBalance(bob.address);

      const account = await savings.savings(bob.address);
      expect(account.saved).to.be.gt(saveAmount);

      // Clean up
      await savings.connect(bob).withdraw(bob.address, account.saved * 2n);
      await savings.connect(bob).claimInterest(bob.address);
    });

    it("save(amount, false) switches to non-compounding; pending interest compounded under old mode", async () => {
      const saveAmount = floatToDec18(10_000);

      // Withdraw any residual state from previous tests
      const aliceSaved = (await savings.savings(alice.address)).saved;
      if (aliceSaved > 0n) await savings.connect(alice).withdraw(alice.address, aliceSaved * 2n);
      const aliceClaim = await savings.claimableInterest(alice.address);
      if (aliceClaim > 0n) await savings.connect(alice).claimInterest(alice.address);
      // Reset non-compounding flag if set
      if (await savings.nonCompounding(alice.address)) {
        await savings.connect(alice)["save(uint192,bool)"](0, true);
      }

      // Start compounding (default)
      await jusd.connect(alice).approve(await savings.getAddress(), saveAmount);
      await savings.connect(alice)["save(uint192)"](saveAmount);
      expect(await savings.nonCompounding(alice.address)).to.eq(false);

      await evm_increaseTime(180 * 86_400);

      // Nothing in claimable yet (compounding mode adds to saved)
      expect(await savings.claimableInterest(alice.address)).to.eq(0n);

      // Switch to non-compounding — pending interest settles under OLD mode (compounding),
      // so it gets compounded into saved
      await savings.connect(alice)["save(uint192,bool)"](0, false);
      expect(await savings.nonCompounding(alice.address)).to.eq(true);

      const savedAfterSwitch = (await savings.savings(alice.address)).saved;
      // Interest was compounded under old compounding mode into saved
      expect(savedAfterSwitch).to.be.gt(saveAmount);
      // No claimable interest (compounding mode adds to saved, not claimable)
      expect(await savings.claimableInterest(alice.address)).to.eq(0n);

      // Interest earned from here should go to claimable under new non-compounding mode
      await evm_increaseTime(180 * 86_400);
      await savings.refreshBalance(alice.address);

      // Saved unchanged under non-compounding mode
      expect((await savings.savings(alice.address)).saved).to.eq(savedAfterSwitch);
      // New interest goes to claimable
      expect(await savings.claimableInterest(alice.address)).to.be.gt(0n);

      // Clean up
      await savings.connect(alice).withdraw(alice.address, savedAfterSwitch * 2n);
      await savings.connect(alice).claimInterest(alice.address);
    });

    it("save(amount) without bool does not change the flag", async () => {
      const saveAmount = floatToDec18(5_000);
      await jusd.connect(bob).approve(await savings.getAddress(), saveAmount * 2n);

      await savings.connect(bob)["save(uint192,bool)"](saveAmount, false);
      expect(await savings.nonCompounding(bob.address)).to.eq(true);

      // Deposit more without specifying mode
      await savings.connect(bob)["save(uint192)"](saveAmount);
      expect(await savings.nonCompounding(bob.address)).to.eq(true);

      // Clean up
      await savings.connect(bob).withdraw(bob.address, saveAmount * 10n);
      await savings.connect(bob).claimInterest(bob.address);
    });
  });

  describe("accruedInterest view", () => {
    it("returns pending interest without settling state", async () => {
      // Clean up any residual state from previous tests
      const bobSaved = (await savings.savings(bob.address)).saved;
      if (bobSaved > 0n) await savings.connect(bob).withdraw(bob.address, bobSaved * 2n);
      const bobClaim = await savings.claimableInterest(bob.address);
      if (bobClaim > 0n) await savings.connect(bob).claimInterest(bob.address);

      const saveAmount = floatToDec18(10_000);
      await jusd.connect(bob).approve(await savings.getAddress(), saveAmount);
      await savings.connect(bob)["save(uint192,bool)"](saveAmount, false);
      await evm_increaseTime(365 * 86_400);

      const pending = await savings["accruedInterest(address)"](bob.address);
      expect(pending).to.be.gt(0n);

      // State unchanged — claimableInterest still 0 (view doesn't settle)
      expect(await savings.claimableInterest(bob.address)).to.eq(0n);

      // Clean up
      await savings.connect(bob).withdraw(bob.address, saveAmount * 2n);
      await savings.connect(bob).claimInterest(bob.address);
    });
  });

  describe("Flag persistence", () => {
    it("nonCompounding persists after full withdrawal and re-deposit", async () => {
      // Clean up any residual state from previous tests
      const bobSaved = (await savings.savings(bob.address)).saved;
      if (bobSaved > 0n) await savings.connect(bob).withdraw(bob.address, bobSaved * 2n);
      const bobClaim = await savings.claimableInterest(bob.address);
      if (bobClaim > 0n) await savings.connect(bob).claimInterest(bob.address);
      // Reset non-compounding flag
      if (await savings.nonCompounding(bob.address)) {
        await savings.connect(bob)["save(uint192,bool)"](0, true);
      }

      const saveAmount = floatToDec18(10_000);
      await jusd.connect(bob).approve(await savings.getAddress(), saveAmount * 2n);

      await savings.connect(bob)["save(uint192,bool)"](saveAmount, false);
      expect(await savings.nonCompounding(bob.address)).to.eq(true);

      // Full withdrawal triggers delete savings[msg.sender]
      await savings.connect(bob).withdraw(bob.address, saveAmount * 2n);
      const deleted = await savings.savings(bob.address);
      expect(deleted.saved).to.eq(0n);

      // Flag persists because it's in a separate mapping
      expect(await savings.nonCompounding(bob.address)).to.eq(true);

      // Re-deposit without specifying mode
      await savings.connect(bob)["save(uint192)"](saveAmount);
      expect(await savings.nonCompounding(bob.address)).to.eq(true);

      // Verify interest still goes to claimable (non-compounding behavior)
      await evm_increaseTime(365 * 86_400);
      await savings.refreshBalance(bob.address);

      expect((await savings.savings(bob.address)).saved).to.eq(saveAmount);
      expect(await savings.claimableInterest(bob.address)).to.be.gt(0n);

      // Clean up
      await savings.connect(bob).withdraw(bob.address, saveAmount * 2n);
      await savings.connect(bob).claimInterest(bob.address);
    });
  });

  describe("ModuleDisabled", () => {
    it("reverts save(amount, false) when rate is 0", async () => {
      const jusdFactory = await ethers.getContractFactory("JuiceDollar");
      const jusdZero = await jusdFactory.deploy(10 * 86400);
      const savingsFactory = await ethers.getContractFactory("Savings");
      const savingsZero = await savingsFactory.deploy(
        jusdZero.getAddress(),
        0
      );

      await expect(
        savingsZero["save(uint192,bool)"](floatToDec18(10_000), false)
      ).to.be.revertedWithCustomError(savingsZero, "ModuleDisabled");
    });
  });
});
