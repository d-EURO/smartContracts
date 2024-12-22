import { expect } from "chai";
import { floatToDec18 } from "../scripts/math";
import { ethers } from "hardhat";
import {
  Equity,
  DecentralizedEURO,
  MintingHub,
  Position,
  PositionFactory,
  PositionRoller,
  Savings,
  TestToken,
} from "../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { evm_increaseTime } from "./helper";
import { float } from "hardhat/internal/core/params/argumentTypes";

describe("Savings Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let deuro: DecentralizedEURO;
  let equity: Equity;
  let roller: PositionRoller;
  let savings: Savings;

  let positionFactory: PositionFactory;
  let mintingHub: MintingHub;

  let position: Position;
  let coin: TestToken;

  // Helper function to read the current block timestamp
  const getTimeStamp = async () => {
    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    return blockBefore?.timestamp ?? null;
  };

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    // Deploy DecentralizedEURO
    const DecentralizedEUROFactory = await ethers.getContractFactory("DecentralizedEURO");
    deuro = await DecentralizedEUROFactory.deploy(10 * 86400);

    // Obtain Equity contract from the reserve() address
    const equityAddr = await deuro.reserve();
    equity = await ethers.getContractAt("Equity", equityAddr);

    // Deploy PositionFactory
    const positionFactoryFactory = await ethers.getContractFactory("PositionFactory");
    positionFactory = await positionFactoryFactory.deploy();

    // Deploy Savings
    const savingsFactory = await ethers.getContractFactory("Savings");
    savings = await savingsFactory.deploy(deuro.getAddress(), 20000n);

    // Deploy PositionRoller
    const rollerFactory = await ethers.getContractFactory("PositionRoller");
    roller = await rollerFactory.deploy(deuro.getAddress());

    // Deploy MintingHub
    const mintingHubFactory = await ethers.getContractFactory("MintingHub");
    mintingHub = await mintingHubFactory.deploy(
      await deuro.getAddress(),
      await savings.getAddress(),
      await roller.getAddress(),
      await positionFactory.getAddress(),
    );

    // Initialize the ecosystem
    await deuro.initialize(owner.address, "owner");

    // Mint some initial dEURO to owner, then transfer to Alice and Bob
    await deuro.mint(owner.address, floatToDec18(2_000_000));
    await deuro.transfer(alice.address, floatToDec18(100_000));
    await deuro.transfer(bob.address, floatToDec18(100_000));

    // Kickstart equity
    await equity.invest(floatToDec18(1000), 0);
    await equity.connect(alice).invest(floatToDec18(10_000), 0);
    await equity.connect(bob).invest(floatToDec18(10_000), 0);
    await equity.invest(floatToDec18(1_000_000), 0);

    // Deploy a test token (unrelated, just for completeness)
    const coinFactory = await ethers.getContractFactory("TestToken");
    coin = await coinFactory.deploy("Supercoin", "XCOIN", 18);
  });

  const amount = floatToDec18(1000);

  describe("Save some deuro", () => {

    it("requires user approval in order to save now", async () => {
      const testAmount = floatToDec18(1000);

      // We now need explicit approval since the global free allowance for minters was removed:
      await deuro.approve(await savings.getAddress(), testAmount);

      await savings["save(uint192)"](testAmount);

      const r = await savings.savings(owner.address);
      expect(r.saved).to.be.equal(testAmount);
    });

    it("simple save", async () => {
      await deuro.approve(savings.getAddress(), amount);
      await savings["save(uint192)"](amount);
      const r = await savings.savings(owner.address);
      expect(r.saved).to.be.approximately(amount, 10 ** 12);
    });

    it("multi save", async () => {
      // We plan to save 3 times, so let's approve thrice the amount in one go
      await deuro.approve(savings.getAddress(), 3n * amount);

      await savings["save(uint192)"](amount);
      await savings["save(uint192)"](amount); // collects interest in between
      await savings["save(uint192)"](amount); // collects interest in between

      const r = await savings.savings(owner.address);
      expect(r.saved).to.be.greaterThanOrEqual(amount * 3n);
      expect(r.saved * 10n).to.be.lessThan(amount * 31n);
    });

    it("should allow to withdraw", async () => {
      // We save once, so we need approval
      await deuro.approve(savings.getAddress(), amount);
      await savings["save(uint192)"](amount);

      // Now test withdrawing more than was saved (it will withdraw everything that's available)
      await savings.withdraw(owner.address, 2n * amount);
      const r = await savings.savings(owner.address);
      expect(r.saved).to.be.eq(0n);
    });

    it("should not pay any interest if nothing is saved", async () => {
      // We withdraw without ever having saved anything
      const b0 = await deuro.balanceOf(owner.address);
      await savings.withdraw(owner.address, 2n * amount);
      const b1 = await deuro.balanceOf(owner.address);
      expect(b1).to.be.eq(b0);
    });

    it("any interests after 365days", async () => {
      const i0 = await deuro.balanceOf(owner.address);
      const amount = floatToDec18(10_000);

      // Must approve for saving
      await deuro.approve(savings.getAddress(), amount);
      await savings["save(uint192)"](amount);

      await evm_increaseTime(365 * 86_400);

      // Attempt to withdraw more than we have, so it withdraws all
      await savings.withdraw(owner.address, 2n * amount);

      const i1 = await deuro.balanceOf(owner.address);
      expect(i1).to.be.greaterThan(i0);
    });

    it("correct interest after 365days", async () => {
      const i0 = await deuro.balanceOf(owner.address);
      const amount = floatToDec18(10_000);

      // Need approval
      await deuro.approve(savings.getAddress(), amount);
      await savings["save(uint192)"](amount);
      const t0 = await getTimeStamp();

      await evm_increaseTime(365 * 86_400);

      // Withdraw
      await savings.withdraw(owner.address, 2n * amount);
      const t1 = await getTimeStamp();

      const i1 = await deuro.balanceOf(owner.address);
      const iDiff = i1 - i0;
      const tDiff = t1! - t0!;
      const toCheck =
        (floatToDec18(10_000) * 20000n * BigInt(tDiff)) /
        (365n * 86_400n * 1_000_000n);

      expect(iDiff).to.be.equal(toCheck);
    });

    it("correct interest after 1000days", async () => {
      const b0 = await deuro.balanceOf(owner.address);
      const amount = floatToDec18(10_000);

      // Approve needed
      await deuro.approve(savings.getAddress(), amount);
      await savings["save(uint192)"](amount);
      const t0 = await getTimeStamp();

      await evm_increaseTime(1000 * 86_400);

      // Attempt to withdraw everything
      await savings.withdraw(owner.address, 2n * amount);
      const t1 = await getTimeStamp();
      const b1 = await deuro.balanceOf(owner.address);
      const bDiff = b1 - b0;
      const tDiff = t1! - t0!;
      const toCheck =
        (floatToDec18(10_000) * 20000n * BigInt(tDiff)) /
        (365n * 86_400n * 1_000_000n);

      expect(bDiff).to.be.equal(toCheck);
    });

    it("approx. interest after 2x saves", async () => {
      const b0 = await deuro.balanceOf(owner.address);
      const amount = floatToDec18(10_000);

      // We plan to do two saves; let's approve for 2 * amount
      await deuro.approve(savings.getAddress(), 2n * amount);

      // First save
      await savings["save(uint192)"](amount);
      const t0 = await getTimeStamp();
      await evm_increaseTime(200 * 86_400);

      // Second save
      await savings["save(uint192)"](amount);
      const t1 = await getTimeStamp();
      await evm_increaseTime(200 * 86_400);

      // Withdraw afterwards
      await savings.withdraw(owner.address, 10n * amount);
      const t2 = await getTimeStamp();
      const b1 = await deuro.balanceOf(owner.address);
      const bDiff = b1 - b0;

      const tDiff0 = t1! - t0!;
      const tDiff1 = t2! - t1!;
      const toCheck0 =
        (floatToDec18(10_000) * 20000n * BigInt(tDiff0)) /
        (365n * 86_400n * 1_000_000n);
      const toCheck1 =
        ((floatToDec18(10_000) + toCheck0) * 20000n * BigInt(tDiff1)) /
        (365n * 86_400n * 1_000_000n);
      // toCheck2 is an alternate approach or breakdown for partial calculation:
      const toCheck2 =
        (floatToDec18(10_000) * 20000n * BigInt(tDiff1)) /
        (365n * 86_400n * 1_000_000n);

      // We allow some approximation tolerance
      expect(bDiff).to.be.approximately(toCheck0 + toCheck1 + toCheck2, 1_000_000_000n);
    });

    it("refresh my balance", async () => {
      const amount = floatToDec18(10_000);

      // Approve
      await deuro.approve(savings.getAddress(), amount);

      // Save
      await savings["save(uint192)"](amount);
      const t0 = await getTimeStamp();

      await evm_increaseTime(365 * 86_400);

      // Refresh
      await savings.refreshMyBalance();
      const t1 = await getTimeStamp();
      const tDiff = t1! - t0!;
      const toCheck =
        (floatToDec18(10_000) * 20000n * BigInt(tDiff)) /
        (365n * 86_400n * 1_000_000n);

      const r = await savings.savings(owner.address);
      expect(r.saved).to.be.equal(amount + toCheck);
    });

    it("refresh balance", async () => {
      const amount = floatToDec18(10_000);

      // Approve
      await deuro.approve(savings.getAddress(), amount);

      // Save
      await savings["save(uint192)"](amount);
      const t0 = await getTimeStamp();

      await evm_increaseTime(365 * 86_400);

      // Refresh for the owner
      await savings.refreshBalance(owner.address);
      const t1 = await getTimeStamp();
      const tDiff = t1! - t0!;
      const toCheck =
        (floatToDec18(10_000) * 20000n * BigInt(tDiff)) /
        (365n * 86_400n * 1_000_000n);

      const r = await savings.savings(owner.address);
      expect(r.saved).to.be.equal(amount + toCheck);
    });

    it("withdraw partial", async () => {
      const amount = floatToDec18(10_000);

      // Approve
      await deuro.approve(savings.getAddress(), amount);

      // Save
      await savings["save(uint192)"](amount);
      const t0 = await getTimeStamp();

      await evm_increaseTime(365 * 86_400);

      // Withdraw a fraction
      await savings.withdraw(owner.address, amount / 10n);
      const t1 = await getTimeStamp();
      const tDiff = t1! - t0!;
      const toCheck =
        (floatToDec18(10_000) * 20000n * BigInt(tDiff)) /
        (365n * 86_400n * 1_000_000n);

      const r = await savings.savings(owner.address);
      // We withdrew 1/10 of the principal, so 9/10 plus the interest remains
      expect(r.saved).to.be.equal((amount * 9n) / 10n + toCheck);
    });

    it("withdraw savings", async () => {
      // We save 4x 'amount', so let's approve 4x that amount
      await deuro.approve(savings.getAddress(), 4n * amount);

      // Save 4 times 'amount'
      await savings["save(uint192)"](4n * amount);
      const account = await savings.savings(owner.address);
      expect(account.saved).to.be.eq(4n * amount);

      // Let some time pass
      await evm_increaseTime(100_000n);

      // Check that the on-chain 'saved' does not auto-increment unless we call refresh
      const account2 = await savings.savings(owner.address);
      expect(account2.saved).to.be.eq(4n * amount);

      // Withdraw partial
      await savings.withdraw(owner.address, amount);

      // Now refresh
      await savings.refreshBalance(owner.address);
      await evm_increaseTime(1234);

      const oldBalance = (await savings.savings(owner.address)).saved;
      const oldReserve = await deuro.balanceOf(await deuro.reserve());
      const oldUserTicks = (await savings.savings(owner.address)).ticks;
      const oldSystemTicks = await savings.currentTicks();

      // Refresh again
      await savings.refreshBalance(owner.address);

      const newBalance = (await savings.savings(owner.address)).saved;
      const newReserve = await deuro.balanceOf(await deuro.reserve());
      const newUserTicks = (await savings.savings(owner.address)).ticks;
      const newSystemTicks = await savings.currentTicks();

      expect(newUserTicks).to.be.eq(newSystemTicks);
      expect(newBalance - oldBalance).to.be.eq(oldReserve - newReserve);
      expect(newBalance - oldBalance).to.be.eq(
        ((newUserTicks - oldUserTicks) * oldBalance) /
          1000000n /
          365n /
          24n /
          3600n
      );

      // Withdraw everything else
      await savings.withdraw(owner.address, 10n * amount);
      expect((await savings.savings(owner.address)).saved).to.be.eq(0n);
    });
  });
});