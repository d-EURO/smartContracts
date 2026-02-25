import { expect } from "chai";
import { floatToDec18 } from "../../scripts/utils/math";
import { ethers } from "hardhat";
import {
  Equity,
  DecentralizedEURO,
  MintingHub,
  PositionFactory,
  PositionRoller,
  Savings,
} from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { evm_increaseTime } from "../utils";

describe("Savings Without Compounding Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let deuro: DecentralizedEURO;
  let equity: Equity;
  let roller: PositionRoller;
  let savings: Savings;

  let positionFactory: PositionFactory;
  let mintingHub: MintingHub;

  const RATE_PPM = 20000n; // 2% annual

  const getTimeStamp = async () => {
    const blockNum = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNum);
    return block?.timestamp ?? null;
  };

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    const DecentralizedEUROFactory =
      await ethers.getContractFactory("DecentralizedEURO");
    deuro = await DecentralizedEUROFactory.deploy(10 * 86400);

    const equityAddr = await deuro.reserve();
    equity = await ethers.getContractAt("Equity", equityAddr);

    const positionFactoryFactory =
      await ethers.getContractFactory("PositionFactory");
    positionFactory = await positionFactoryFactory.deploy();

    const savingsFactory = await ethers.getContractFactory("Savings");
    savings = await savingsFactory.deploy(deuro.getAddress(), RATE_PPM);

    const rollerFactory = await ethers.getContractFactory("PositionRoller");
    roller = await rollerFactory.deploy(deuro.getAddress());

    const weth = await (await ethers.getContractFactory("TestWETH")).deploy();
    const mintingHubFactory = await ethers.getContractFactory("MintingHub");
    mintingHub = await mintingHubFactory.deploy(
      await deuro.getAddress(),
      RATE_PPM,
      await roller.getAddress(),
      await positionFactory.getAddress(),
      await weth.getAddress()
    );

    await deuro.initialize(owner.address, "owner");
    await deuro.initialize(await mintingHub.getAddress(), "mintingHub");
    await deuro.initialize(await savings.getAddress(), "savings");

    await deuro.mint(owner.address, floatToDec18(2_000_000));
    await deuro.transfer(alice.address, floatToDec18(100_000));
    await deuro.transfer(bob.address, floatToDec18(100_000));

    // bootstrap equity
    await equity.invest(floatToDec18(1000), 0);
    await deuro
      .connect(alice)
      .approve(await equity.getAddress(), floatToDec18(10_000));
    await equity.connect(alice).invest(floatToDec18(10_000), 0);
    await deuro
      .connect(bob)
      .approve(await equity.getAddress(), floatToDec18(10_000));
    await equity.connect(bob).invest(floatToDec18(10_000), 0);
    await equity.invest(floatToDec18(1_000_000), 0);
  });

  const amount = floatToDec18(10_000);

  describe("Default mode is compounding", () => {
    it("save(amount) compounds interest and emits InterestCollected with compounded=true", async () => {
      await savings["save(uint192)"](amount);
      await evm_increaseTime(365 * 86_400);
      const tx = await savings.refreshBalance(owner.address);

      const account = await savings.savings(owner.address);
      const interest = account.saved - amount;
      expect(interest).to.be.gt(0n);
      expect(await savings.claimableInterest(owner.address)).to.eq(0n);

      await expect(tx)
        .to.emit(savings, "InterestCollected")
        .withArgs(owner.address, interest, true);
    });
  });

  describe("Non-compounding mode", () => {
    it("save(amount, false) routes interest to claimableInterest with correct amount", async () => {
      await savings["save(uint192,bool)"](amount, false);
      const t0 = await getTimeStamp();

      await evm_increaseTime(365 * 86_400);
      await savings.refreshBalance(owner.address);
      const t1 = await getTimeStamp();

      // Principal unchanged
      const account = await savings.savings(owner.address);
      expect(account.saved).to.eq(amount);

      // Interest accumulated in claimableInterest
      const claimable = await savings.claimableInterest(owner.address);
      expect(claimable).to.be.gt(0n);

      // Verify correct interest amount
      const tDiff = BigInt(t1! - t0!);
      const expected =
        (amount * RATE_PPM * tDiff) / (1_000_000n * 365n * 86_400n);
      expect(claimable).to.eq(expected);
    });

    it("emits InterestCollected with compounded=false", async () => {
      await savings["save(uint192,bool)"](amount, false);
      await evm_increaseTime(365 * 86_400);
      const tx = await savings.refreshBalance(owner.address);

      const claimable = await savings.claimableInterest(owner.address);
      expect(claimable).to.be.gt(0n);

      await expect(tx)
        .to.emit(savings, "InterestCollected")
        .withArgs(owner.address, claimable, false);
    });

    it("third-party deposit via save(address, amount) does not affect nonCompounding flag", async () => {
      // Owner sets non-compounding
      await savings["save(uint192,bool)"](amount, false);
      expect(await savings.nonCompounding(owner.address)).to.eq(true);

      // Alice deposits into owner's account via save(address, amount)
      await deuro.connect(alice).approve(await savings.getAddress(), amount);
      await savings.connect(alice)["save(address,uint192)"](owner.address, amount);

      // Flag unchanged — third party cannot affect it
      expect(await savings.nonCompounding(owner.address)).to.eq(true);
      const account = await savings.savings(owner.address);
      expect(account.saved).to.eq(amount * 2n);
    });
  });

  describe("Non-compounding interest is linear", () => {
    it("interest across multiple periods equals simple interest, not compound", async () => {
      // Non-compounding user (owner)
      await savings["save(uint192,bool)"](amount, false);
      const t0 = await getTimeStamp();

      // Compounding user (alice) — same amount, approximately same time
      await deuro
        .connect(alice)
        .approve(await savings.getAddress(), amount);
      await savings.connect(alice)["save(uint192)"](amount);

      // Period 1
      await evm_increaseTime(180 * 86_400);
      await savings.refreshBalance(owner.address);
      await savings.refreshBalance(alice.address);

      // Period 2
      await evm_increaseTime(180 * 86_400);
      await savings.refreshBalance(owner.address);
      const t2 = await getTimeStamp();
      await savings.refreshBalance(alice.address);

      // Non-compounding: principal unchanged
      const ownerAccount = await savings.savings(owner.address);
      expect(ownerAccount.saved).to.eq(amount);

      // Total claimable matches linear formula for the entire duration
      const totalClaimable = await savings.claimableInterest(owner.address);
      const totalTime = BigInt(t2! - t0!);
      const expectedLinear =
        (amount * RATE_PPM * totalTime) / (1_000_000n * 365n * 86_400n);
      // Integer division across two periods may lose at most 1 wei vs single-shot formula
      expect(totalClaimable).to.be.gte(expectedLinear - 1n);
      expect(totalClaimable).to.be.lte(expectedLinear);

      // Compounding user earns strictly more (interest-on-interest effect)
      const aliceAccount = await savings.savings(alice.address);
      const aliceInterest = aliceAccount.saved - amount;
      expect(aliceInterest).to.be.gt(totalClaimable);
    });
  });

  describe("claimInterest", () => {
    it("transfers interest, zeros balance, emits InterestClaimed with correct args", async () => {
      await savings["save(uint192,bool)"](amount, false);
      await evm_increaseTime(365 * 86_400);
      await savings.refreshBalance(owner.address);

      const balBefore = await deuro.balanceOf(owner.address);
      const tx = await savings.claimInterest(owner.address);
      const balAfter = await deuro.balanceOf(owner.address);

      const actualAmount = balAfter - balBefore;
      expect(actualAmount).to.be.gt(0n);

      await expect(tx)
        .to.emit(savings, "InterestClaimed")
        .withArgs(owner.address, actualAmount);

      expect(await savings.claimableInterest(owner.address)).to.eq(0n);
    });

    it("returns 0 and does not revert when nothing to claim", async () => {
      const returned = await savings.claimInterest.staticCall(owner.address);
      expect(returned).to.eq(0n);
    });
  });

  describe("Mode switching", () => {
    it("save(amount, true) switches to compounding; prior non-compounding interest preserved", async () => {
      // Start non-compounding
      await savings["save(uint192,bool)"](amount, false);
      expect(await savings.nonCompounding(owner.address)).to.eq(true);

      await evm_increaseTime(180 * 86_400);

      // Verify non-compounding phase accumulated interest before switching
      const pendingInterest = await savings["accruedInterest(address)"](
        owner.address
      );
      expect(pendingInterest).to.be.gt(0n);

      // Switch to compounding — flag is set before refresh runs,
      // so the pending interest gets compounded into saved
      await savings["save(uint192,bool)"](0, true);
      expect(await savings.nonCompounding(owner.address)).to.eq(false);

      const accountAfterSwitch = await savings.savings(owner.address);
      expect(accountAfterSwitch.saved).to.be.gt(amount);
      // Interest went to saved, not claimable
      expect(await savings.claimableInterest(owner.address)).to.eq(0n);

      // Interest earned from here should also compound
      await evm_increaseTime(180 * 86_400);
      await savings.refreshBalance(owner.address);

      const account = await savings.savings(owner.address);
      expect(account.saved).to.be.gt(accountAfterSwitch.saved);
    });

    it("save(amount, false) switches to non-compounding; pending interest goes to claimable", async () => {
      // Start compounding (default)
      await savings["save(uint192)"](amount);
      expect(await savings.nonCompounding(owner.address)).to.eq(false);

      await evm_increaseTime(180 * 86_400);

      // Nothing in claimable yet (compounding mode adds to saved)
      expect(await savings.claimableInterest(owner.address)).to.eq(0n);

      // Switch to non-compounding — flag is set before refresh runs,
      // so the pending interest goes to claimableInterest instead of saved
      await savings["save(uint192,bool)"](0, false);
      expect(await savings.nonCompounding(owner.address)).to.eq(true);

      // Principal unchanged (pending interest NOT added to saved)
      expect((await savings.savings(owner.address)).saved).to.eq(amount);

      // Pending interest routed to claimable
      const claimable = await savings.claimableInterest(owner.address);
      expect(claimable).to.be.gt(0n);

      // Interest earned from here should also go to claimable
      await evm_increaseTime(180 * 86_400);
      await savings.refreshBalance(owner.address);

      expect((await savings.savings(owner.address)).saved).to.eq(amount);
      expect(await savings.claimableInterest(owner.address)).to.be.gt(
        claimable
      );
    });

    it("save(amount) without bool does not change the flag", async () => {
      await savings["save(uint192,bool)"](amount, false);
      expect(await savings.nonCompounding(owner.address)).to.eq(true);

      // Deposit more without specifying mode
      await savings["save(uint192)"](amount);
      expect(await savings.nonCompounding(owner.address)).to.eq(true);
    });
  });

  describe("accruedInterest view", () => {
    it("returns pending interest without settling state", async () => {
      await savings["save(uint192,bool)"](amount, false);
      await evm_increaseTime(365 * 86_400);

      const pending = await savings["accruedInterest(address)"](owner.address);
      expect(pending).to.be.gt(0n);

      // State unchanged — claimableInterest still 0 (view doesn't settle)
      expect(await savings.claimableInterest(owner.address)).to.eq(0n);
    });
  });

  describe("Withdraw", () => {
    it("partial withdraw reduces principal correctly", async () => {
      await savings["save(uint192,bool)"](amount, false);
      const half = amount / 2n;

      await savings.withdraw(owner.address, half);
      const account = await savings.savings(owner.address);
      expect(account.saved).to.eq(amount - half);
    });

    it("full withdrawal deletes account; claimable interest survives and is claimable", async () => {
      await savings["save(uint192,bool)"](amount, false);
      await evm_increaseTime(365 * 86_400);

      // Withdraw all principal (refresh inside accrues interest)
      await savings.withdraw(owner.address, amount * 2n);

      // Account deleted
      const account = await savings.savings(owner.address);
      expect(account.saved).to.eq(0n);
      expect(account.ticks).to.eq(0n);

      // Claimable interest survives full withdrawal
      const claimable = await savings.claimableInterest(owner.address);
      expect(claimable).to.be.gt(0n);

      // Can still claim it
      const balBefore = await deuro.balanceOf(owner.address);
      await savings.claimInterest(owner.address);
      const balAfter = await deuro.balanceOf(owner.address);
      expect(balAfter - balBefore).to.eq(claimable);
      expect(await savings.claimableInterest(owner.address)).to.eq(0n);
    });
  });

  describe("Flag persistence", () => {
    it("nonCompounding persists after full withdrawal and re-deposit", async () => {
      await savings["save(uint192,bool)"](amount, false);
      expect(await savings.nonCompounding(owner.address)).to.eq(true);

      // Full withdrawal triggers delete savings[msg.sender]
      await savings.withdraw(owner.address, amount * 2n);
      const deleted = await savings.savings(owner.address);
      expect(deleted.saved).to.eq(0n);

      // Flag persists because it's in a separate mapping
      expect(await savings.nonCompounding(owner.address)).to.eq(true);

      // Re-deposit without specifying mode
      await savings["save(uint192)"](amount);
      expect(await savings.nonCompounding(owner.address)).to.eq(true);

      // Verify interest still goes to claimable (non-compounding behavior)
      await evm_increaseTime(365 * 86_400);
      await savings.refreshBalance(owner.address);

      expect((await savings.savings(owner.address)).saved).to.eq(amount);
      expect(await savings.claimableInterest(owner.address)).to.be.gt(0n);
    });
  });

  describe("Multi-user isolation", () => {
    it("non-compounding and compounding users earn interest independently", async () => {
      // Alice: non-compounding
      await deuro
        .connect(alice)
        .approve(await savings.getAddress(), amount);
      await savings.connect(alice)["save(uint192,bool)"](amount, false);

      // Bob: compounding (default)
      await deuro
        .connect(bob)
        .approve(await savings.getAddress(), amount);
      await savings.connect(bob)["save(uint192)"](amount);

      await evm_increaseTime(365 * 86_400);
      await savings.refreshBalance(alice.address);
      await savings.refreshBalance(bob.address);

      // Alice: principal unchanged, interest in claimable
      const aliceAccount = await savings.savings(alice.address);
      expect(aliceAccount.saved).to.eq(amount);
      const aliceClaimable = await savings.claimableInterest(alice.address);
      expect(aliceClaimable).to.be.gt(0n);

      // Bob: principal grew, no claimable
      const bobAccount = await savings.savings(bob.address);
      expect(bobAccount.saved).to.be.gt(amount);
      expect(await savings.claimableInterest(bob.address)).to.eq(0n);
    });
  });

  describe("ModuleDisabled", () => {
    it("reverts save(amount, false) when rate is 0", async () => {
      const deuroFactory = await ethers.getContractFactory("DecentralizedEURO");
      const deuroZero = await deuroFactory.deploy(10 * 86400);
      const savingsFactory = await ethers.getContractFactory("Savings");
      const savingsZero = await savingsFactory.deploy(
        deuroZero.getAddress(),
        0
      );

      await expect(
        savingsZero["save(uint192,bool)"](amount, false)
      ).to.be.revertedWithCustomError(savingsZero, "ModuleDisabled");
    });
  });
});
