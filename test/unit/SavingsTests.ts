import { expect } from "chai";
import { floatToDec18 } from "../../scripts/utils/math";
import { ethers } from "hardhat";
import {
  Equity,
  JuiceDollar,
  MintingHub,
  Position,
  PositionFactory,
  PositionRoller,
  Savings,
  TestToken,
} from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { evm_increaseTime } from "../utils";

describe("Savings Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let jusd: JuiceDollar;
  let equity: Equity;
  let roller: PositionRoller;
  let savings: Savings;

  let positionFactory: PositionFactory;
  let mintingHub: MintingHub;

  let position: Position;
  let coin: TestToken;

  const getTimeStamp = async () => {
    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    return blockBefore?.timestamp ?? null;
  };

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    const JuiceDollarFactory =
      await ethers.getContractFactory("JuiceDollar");
    jusd = await JuiceDollarFactory.deploy(10 * 86400);

    const equityAddr = await jusd.reserve();
    equity = await ethers.getContractAt("Equity", equityAddr);

    const positionFactoryFactory =
      await ethers.getContractFactory("PositionFactory");
    positionFactory = await positionFactoryFactory.deploy();

    const savingsFactory = await ethers.getContractFactory("Savings");
    savings = await savingsFactory.deploy(jusd.getAddress(), 20000n);

    const rollerFactory = await ethers.getContractFactory("PositionRoller");
    roller = await rollerFactory.deploy(jusd.getAddress());

    const mintingHubFactory = await ethers.getContractFactory("MintingHub");
    mintingHub = await mintingHubFactory.deploy(
      await jusd.getAddress(),
      await savings.getAddress(),
      await roller.getAddress(),
      await positionFactory.getAddress(),
    );

    // jump start ecosystem
    await jusd.initialize(owner.address, "owner");
    await jusd.initialize(await mintingHub.getAddress(), "mintingHub");
    await jusd.initialize(await savings.getAddress(), "savings");

    await jusd.mint(owner.address, floatToDec18(2_000_000));
    await jusd.transfer(alice.address, floatToDec18(100_000));
    await jusd.transfer(bob.address, floatToDec18(100_000));

    // jump start fps
    await equity.invest(floatToDec18(1000), 0);
    await jusd.connect(alice).approve(await equity.getAddress(), floatToDec18(10_000));
    await equity.connect(alice).invest(floatToDec18(10_000), 0);
    await jusd.connect(bob).approve(await equity.getAddress(), floatToDec18(10_000));
    await equity.connect(bob).invest(floatToDec18(10_000), 0);
    await equity.invest(floatToDec18(1_000_000), 0);

    // test coin
    const coinFactory = await ethers.getContractFactory("TestToken");
    coin = await coinFactory.deploy("Supercoin", "XCOIN", 18);
  });

  const amount = floatToDec18(1000);

  describe("Save some jusd", () => {
    it("no approval needed, minters power", async () => {
      const amount = floatToDec18(1000);
      await savings["save(uint192)"](amount);
    });

    it("simple save", async () => {
      await jusd.approve(savings.getAddress(), amount); // not needed if registered as minter
      await savings["save(uint192)"](amount);
      const r = await savings.savings(owner.address);
      expect(r.saved).to.be.approximately(amount, 10**12);
    });

    it("multi save", async () => {
      await savings["save(uint192)"](amount);
      await savings["save(uint192)"](amount); // @dev: will collect interest
      await savings["save(uint192)"](amount); // @dev: will collect interest
      const r = await savings.savings(owner.address);
      expect(r.saved).to.be.greaterThanOrEqual(amount * 3n);
      expect(r.saved * 10n).to.be.lessThan(amount * 31n);
    });

    it("should allow to withdraw", async () => {
      await savings["save(uint192)"](amount);
      const w = await savings.withdraw(owner.address, 2n * amount);
      const r = await savings.savings(owner.address);
      expect(r.saved).to.be.eq(0n);
    });

    it("should not pay any interest, if nothing is saved", async () => {
      const b0 = await jusd.balanceOf(owner.address);
      const w = await savings.withdraw(owner.address, 2n * amount);
      const r = await savings.savings(owner.address);
      const b1 = await jusd.balanceOf(owner.address);
      expect(b1).to.be.eq(b0);
    });

    it("any interests after 365days", async () => {
      const i0 = await jusd.balanceOf(owner.address);
      const amount = floatToDec18(10_000);
      await savings["save(uint192)"](amount);
      await evm_increaseTime(365 * 86_400);
      await savings.withdraw(owner.address, 2n * amount); // as much as possible, 2x amount is enough
      /* \__ Will cause an Error, if not registered as minter. __/
        savings addr: 0xc351628EB244ec633d5f21fBD6621e1a683B1181
        equity addr: 0x1301d297043f564235EA41560f61681253BbD48B

        Error: VM Exception while processing transaction: reverted with custom error 'ERC20InsufficientAllowance("0x1301d297043f564235EA41560f61681253BbD48B", 0, 192328779807204464738)'
        at JuiceDollar.permit (contracts/utils/ERC20PermitLight.sol:21)
        at JuiceDollar.transferFrom (contracts/utils/ERC20.sol:123)
        at Savings.refresh (contracts/Savings.sol:68)
        at Savings.withdraw (contracts/Savings.sol:109)

        The SC "Savings" is not a "minter" aka "no minter superpower". So it CAN NOT withdraw any jusd without approval, 
        this will cause an error while trying to "transferFrom" the equity some interests.
      */
      const i1 = await jusd.balanceOf(owner.address);
      expect(i1).to.be.greaterThan(i0);
    });

    it("correct interest after 365days", async () => {
      const i0 = await jusd.balanceOf(owner.address);
      const amount = floatToDec18(10_000);
      await savings["save(uint192)"](amount);
      const t0 = await getTimeStamp();

      await evm_increaseTime(365 * 86_400);

      await savings.withdraw(owner.address, 2n * amount);
      const t1 = await getTimeStamp();
      const i1 = await jusd.balanceOf(owner.address);
      const iDiff = i1 - i0;
      const tDiff = t1! - t0!;
      const toCheck =
        (floatToDec18(10_000) * 20000n * BigInt(tDiff)) /
        (365n * 86_400n * 1_000_000n);
      expect(iDiff).to.be.equal(toCheck);
    });

    it("correct interest after 1000days", async () => {
      const b0 = await jusd.balanceOf(owner.address);
      const amount = floatToDec18(10_000);
      await jusd.approve(savings.getAddress(), amount);
      await savings["save(uint192)"](amount);
      const t0 = await getTimeStamp();

      await evm_increaseTime(1000 * 86_400);

      await savings.withdraw(owner.address, 2n * amount);
      const t1 = await getTimeStamp();
      const b1 = await jusd.balanceOf(owner.address);
      const bDiff = b1 - b0;
      const tDiff = t1! - t0!;
      const toCheck =
        (floatToDec18(10_000) * 20000n * BigInt(tDiff)) /
        (365n * 86_400n * 1_000_000n);
      expect(bDiff).to.be.equal(toCheck);
    });

    it("approx. interest after 2x saves", async () => {
      const b0 = await jusd.balanceOf(owner.address);
      const amount = floatToDec18(10_000);
      await jusd.approve(savings.getAddress(), 2n * amount);

      await savings["save(uint192)"](amount);
      const t0 = await getTimeStamp();
      await evm_increaseTime(200 * 86_400);

      await savings["save(uint192)"](amount);
      const t1 = await getTimeStamp();
      await evm_increaseTime(200 * 86_400);

      await savings.withdraw(owner.address, 10n * amount);
      const t2 = await getTimeStamp();
      const b1 = await jusd.balanceOf(owner.address);
      const bDiff = b1 - b0;
      const tDiff0 = t1! - t0!;
      const tDiff1 = t2! - t1!;
      const toCheck0 =
        (floatToDec18(10_000) * 20000n * BigInt(tDiff0)) /
        (365n * 86_400n * 1_000_000n);
      const toCheck1 =
        ((floatToDec18(10_000) + toCheck0) *
          20000n *
          (BigInt(tDiff1) - 0n * 86_400n)) /
        (365n * 86_400n * 1_000_000n);
      const toCheck2 =
        (floatToDec18(10_000) * 20000n * BigInt(tDiff1)) /
        (365n * 86_400n * 1_000_000n);
      expect(bDiff).to.be.approximately(
        toCheck0 + toCheck1 + toCheck2,
        1_000_000_000n,
      );
    });

    it("refresh my balance", async () => {
      const amount = floatToDec18(10_000);
      await jusd.approve(savings.getAddress(), amount);
      await savings["save(uint192)"](amount);
      const t0 = await getTimeStamp();

      await evm_increaseTime(365 * 86_400);

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
      await jusd.approve(savings.getAddress(), amount);
      await savings["save(uint192)"](amount);
      const t0 = await getTimeStamp();

      await evm_increaseTime(365 * 86_400);

      await savings.refreshBalance(owner.address);
      const t1 = await getTimeStamp();
      const tDiff = t1! - t0!;
      const toCheck =
        (floatToDec18(10_000) * 20000n * BigInt(tDiff)) /
        (365n * 86_400n * 1_000_000n);

      const r = await savings.savings(owner.address);
      expect(r.saved).to.be.equal(amount + toCheck);
    });

    it("adjust savings upwards", async () => {
      await savings["save(uint192)"](amount);
      const r = await savings.savings(owner.address);
      expect(r.saved).to.be.approximately(amount, 10 ** 12);
      await savings.adjust(2n * amount);
      const r2 = await savings.savings(owner.address);
      expect(r2.saved).to.be.approximately(2n * amount, 10 ** 12);
    });

    it("adjust savings downwards", async () => {
      await savings["save(uint192)"](amount);
      const r = await savings.savings(owner.address);
      expect(r.saved).to.be.approximately(amount, 10 ** 12);
      await savings.adjust(amount / 2n);
      const r2 = await savings.savings(owner.address);
      expect(r2.saved).to.be.approximately(amount / 2n, 10 ** 12);
    });

    it("withdraw partial", async () => {
      const amount = floatToDec18(10_000);
      await jusd.approve(savings.getAddress(), amount);
      await savings["save(uint192)"](amount);
      const t0 = await getTimeStamp();

      await evm_increaseTime(365 * 86_400);

      await savings.withdraw(owner.address, amount / 10n);
      const t1 = await getTimeStamp();
      const tDiff = t1! - t0!;
      const toCheck =
        (floatToDec18(10_000) * 20000n * BigInt(tDiff)) /
        (365n * 86_400n * 1_000_000n);

      const r = await savings.savings(owner.address);
      expect(r.saved).to.be.equal((amount * 9n) / 10n + toCheck);
    });

    it("withdraw savings", async () => {
      await savings["save(uint192)"](4n * amount);
      const account = await savings.savings(owner.address);
      expect(account.saved).to.be.eq(4n * amount);
      await evm_increaseTime(100_000n); // when executing the next transaction, timer will be increased by 1 seconds
      const account2 = await savings.savings(owner.address);
      expect(account2.saved).to.be.eq(4n * amount);
      await savings.withdraw(owner.address, amount);
      await savings.refreshBalance(owner.address);
      await evm_increaseTime(1234);
      const oldBalance = (await savings.savings(owner.address)).saved;
      const oldReserve = await jusd.balanceOf(await jusd.reserve());
      const oldUserTicks = (await savings.savings(owner.address)).ticks;
      const oldSystemTicks = await savings.currentTicks();
      await savings.refreshBalance(owner.address);
      const newBalance = (await savings.savings(owner.address)).saved;
      const newReserve = await jusd.balanceOf(await jusd.reserve());
      const newUserTicks = (await savings.savings(owner.address)).ticks;
      const newSystemTicks = await savings.currentTicks();
      expect(newUserTicks).to.be.eq(newSystemTicks);
      expect(newBalance - oldBalance).to.be.eq(oldReserve - newReserve);
      expect(newBalance - oldBalance).to.be.eq(
        ((newUserTicks - oldUserTicks) * oldBalance) /
          1000000n /
          365n /
          24n /
          3600n,
      );
      await savings.withdraw(owner.address, 10n * amount);
      expect((await savings.savings(owner.address)).saved).to.be.eq(0n);
    });
  });
  describe("Accrued interest and calculate interest", () => {
    const getTimeStamp = async () => {
      const blockNumBefore = await ethers.provider.getBlockNumber();
      const blockBefore = await ethers.provider.getBlock(blockNumBefore);
      return blockBefore?.timestamp ?? null;
    };

    describe("accrued interest", () => {
      it("should return 0 if nothing is saved", async () => {
        const interest = await savings["accruedInterest(address)"](owner.address);
        expect(interest).to.eq(0n);
      });

      it("should return some interest after time passes (without collecting)", async () => {
        const amount = floatToDec18(10_000);
        await jusd.approve(await savings.getAddress(), amount);
        await savings["save(uint192)"](amount);
        await evm_increaseTime(90 * 86400);

        const interest = await savings["accruedInterest(address)"](owner.address);
        expect(interest).to.be.gt(0n);

        const savedStruct = await savings.savings(owner.address);
        expect(savedStruct.saved).to.eq(amount); // no interest added yet
      });

      it("should reset to zero after interest is collected", async () => {
        const amount = floatToDec18(10_000);
        await jusd.approve(await savings.getAddress(), amount);
        await savings["save(uint192)"](amount);
        await evm_increaseTime(100 * 86400);

        const accruedBefore = await savings["accruedInterest(address)"](owner.address);
        expect(accruedBefore).to.be.gt(0n);

        await savings.refreshMyBalance(); // collect interest
        const accruedAfter = await savings["accruedInterest(address)"](owner.address);
        expect(accruedAfter).to.eq(0n); 
      });
    });

    describe("calculate interest", () => {
      it("should calculate 0 interest if no ticks passed", async () => {
        const amount = floatToDec18(5_000);
        await savings["save(uint192)"](amount);
        const savedStruct = await savings.savings(owner.address);
        const systemTicks = await savings.currentTicks();
        const interest = await savings.calculateInterest(
          { saved: savedStruct.saved, ticks: savedStruct.ticks },
          systemTicks,
        );

        expect(interest).to.eq(0n);
      });

      it("should cap at system's equity if interest exceeds it", async () => {
        let balanceEquity = await jusd.balanceOf(await jusd.reserve());           // 500_000_000000000000000000
        await jusd.burnFrom(await jusd.reserve(), (balanceEquity * 99n) / 100n);  // reduce equity by 99%
        balanceEquity = await jusd.balanceOf(await jusd.reserve());               // 5_000_000000000000000000

        const amount = floatToDec18(500_000);
        await jusd.mint(owner.address, amount);
        await jusd.approve(await savings.getAddress(), amount);
        await savings["save(uint192)"](amount);
        await evm_increaseTime(3 * 365 * 86400); // 3 years accrual time

        const savedStruct = await savings.savings(owner.address);
        const timestamp = await getTimeStamp();
        const futureTicks = await savings.ticks((timestamp ?? 0) + 1);
        const interestWithoutCap = ((futureTicks - savedStruct.ticks) * savedStruct.saved) / 1000000n / (365n * 86400n);
        const interest = await savings.calculateInterest(
          { saved: savedStruct.saved, ticks: savedStruct.ticks },
          futureTicks,
        );

        expect(interest).to.be.lt(interestWithoutCap);
        expect(interest).to.be.equal(balanceEquity);
      });
    });
  });
});
