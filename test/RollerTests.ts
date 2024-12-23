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
import { ContractTransactionReceipt } from "ethers";

describe("Roller Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let deuro: DecentralizedEURO;
  let equity: Equity;
  let roller: PositionRoller;
  let savings: Savings;

  let positionFactory: PositionFactory;
  let mintingHub: MintingHub;

  let pos1: Position;
  let pos2: Position;
  let clone1: Position;
  let coin: TestToken;

  const getTimeStamp = async () => {
    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    return blockBefore?.timestamp ?? null;
  };

  const getPositionAddress = async (tx: ContractTransactionReceipt) => {
    const topic =
      "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175";
    const log = tx?.logs.find((x) => x.topics.indexOf(topic) >= 0);
    return "0x" + log?.topics[2].substring(26);
  };

  before(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    const DecentralizedEUROFactory =
      await ethers.getContractFactory("DecentralizedEURO");
    deuro = await DecentralizedEUROFactory.deploy(5 * 86400);

    const equityAddr = await deuro.reserve();
    equity = await ethers.getContractAt("Equity", equityAddr);

    const positionFactoryFactory =
      await ethers.getContractFactory("PositionFactory");
    positionFactory = await positionFactoryFactory.deploy();

    const savingsFactory = await ethers.getContractFactory("Savings");
    savings = await savingsFactory.deploy(deuro.getAddress(), 20000n);

    const rollerFactory = await ethers.getContractFactory("PositionRoller");
    roller = await rollerFactory.deploy(deuro.getAddress());

    const mintingHubFactory = await ethers.getContractFactory("MintingHub");
    mintingHub = await mintingHubFactory.deploy(
      await deuro.getAddress(),
      await savings.getAddress(),
      await roller.getAddress(),
      await positionFactory.getAddress(),
    );

    // test coin
    const coinFactory = await ethers.getContractFactory("TestToken");
    coin = await coinFactory.deploy("Supercoin", "XCOIN", 18);

    // jump start ecosystem
    await deuro.initialize(owner.address, "owner");
    await deuro.initialize(await mintingHub.getAddress(), "mintingHub");
    await deuro.initialize(await savings.getAddress(), "savings");
    await deuro.initialize(await roller.getAddress(), "roller");

    await deuro.mint(owner.address, floatToDec18(2_000_000));
    await deuro.transfer(alice.address, floatToDec18(200_000));
    await deuro.transfer(bob.address, floatToDec18(200_000));

    // jump start fps
    await equity.invest(floatToDec18(1000), 0);
    await equity.connect(alice).invest(floatToDec18(10_000), 0);
    await equity.connect(bob).invest(floatToDec18(10_000), 0);
    await equity.invest(floatToDec18(1_000_000), 0);

    await coin.mint(alice.address, floatToDec18(1_000));
    await coin.mint(bob.address, floatToDec18(1_000));

    // The block of code that was commented out in your original file is omitted here,
    // as we now handle position creation in the describe() blocks below.
  });

  describe("roll tests for owner", () => {
    beforeEach("give owner 1st and 2nd position", async () => {
      // give OWNER a position
      await coin.approve(await mintingHub.getAddress(), floatToDec18(10));
      const txPos1 = await (
        await mintingHub.openPosition(
          await coin.getAddress(),
          floatToDec18(1), // min size
          floatToDec18(10), // size
          floatToDec18(100_000), // mint limit
          3 * 86_400,
          100 * 86_400,
          86_400,
          10000,
          floatToDec18(6000),
          100000,
        )
      ).wait();
      const pos1Addr = await getPositionAddress(txPos1!);
      pos1 = await ethers.getContractAt("Position", pos1Addr, owner);

      // give OWNER a 2nd position
      await coin.approve(await mintingHub.getAddress(), floatToDec18(10));
      const txPos2 = await (
        await mintingHub.openPosition(
          await coin.getAddress(),
          floatToDec18(1),
          floatToDec18(10),
          floatToDec18(100_000),
          3 * 86_400,
          100 * 86_400,
          86_400,
          10000,
          floatToDec18(6000),
          100000,
        )
      ).wait();
      const pos2Addr = await getPositionAddress(txPos2!);
      pos2 = await ethers.getContractAt("Position", pos2Addr, owner);
    });

    it("fully open", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      expect(await pos1.start()).to.be.lessThan(await getTimeStamp());
      expect(await pos2.start()).to.be.lessThan(await getTimeStamp());
    });

    it("fail with invalid source", async () => {
      const tx = roller.roll(
        owner, // not a position
        floatToDec18(1_000),
        floatToDec18(1),
        await pos2.getAddress(),
        floatToDec18(10_000),
        floatToDec18(1),
        await pos2.expiration(),
      );
      await expect(tx).to.be.revertedWithCustomError(roller, "NotPosition");
    });

    it("fail with invalid target", async () => {
      const tx = roller.roll(
        await pos1.getAddress(),
        floatToDec18(1_000),
        floatToDec18(1),
        owner, // not a position
        floatToDec18(10_000),
        floatToDec18(1),
        await pos2.expiration(),
      );
      await expect(tx).to.be.revertedWithCustomError(roller, "NotPosition");
    });

    it("create mint and merge partially into existing position", async () => {
      await evm_increaseTime(3 * 86_400 + 300);

      const bdeuro1 = await deuro.balanceOf(owner.address);
      await pos1.mint(owner.address, floatToDec18(10_000));
      const bdeuro2 = await deuro.balanceOf(owner.address);

      expect(bdeuro2).to.be.gt(bdeuro1, "owner minted some dEURO");
      expect(await pos1.minted()).to.be.gt(0n);
      expect(await pos2.minted()).to.be.eq(0n);

      // roll partially
      await coin.approve(await roller.getAddress(), floatToDec18(1));
      await roller.roll(
        await pos1.getAddress(),
        floatToDec18(1_000),
        floatToDec18(1),
        await pos2.getAddress(),
        floatToDec18(10_000),
        floatToDec18(1),
        await pos2.expiration(),
      );

      expect(await pos1.minted()).to.be.lt(
        floatToDec18(10_000),
        "pos1 minted decreased",
      );
      expect(await pos2.minted()).to.be.gte(
        floatToDec18(1_000),
        "pos2 minted increased",
      );
      expect(await coin.balanceOf(await pos1.getAddress())).to.be.eq(
        floatToDec18(9),
        "pos1 coin bal decreased by 1",
      );
      expect(await coin.balanceOf(await pos2.getAddress())).to.be.eq(
        floatToDec18(11),
        "pos2 coin bal increased by 1",
      );
    });

    it("merge full into existing position", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));

      const toRepay = floatToDec18(10_000 * 0.9);
      await coin.approve(await roller.getAddress(), floatToDec18(10));
      await roller.roll(
        await pos1.getAddress(),
        toRepay,
        floatToDec18(10),
        await pos2.getAddress(),
        floatToDec18(10_000),
        floatToDec18(10),
        await pos2.expiration(),
      );

      expect(await pos1.minted()).to.be.eq(0n, "pos1 fully rolled out");
      expect(await pos2.minted()).to.be.eq(
        floatToDec18(10_000),
        "pos2 minted merges to 10k",
      );
      expect(await coin.balanceOf(await pos1.getAddress())).to.be.eq(
        0n,
        "pos1 coin=0",
      );
      expect(await coin.balanceOf(await pos2.getAddress())).to.be.eq(
        floatToDec18(20),
        "pos2 coin sum of both",
      );
    });

    it("merge full into existing position, consider pos1 closed", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));

      const toRepay = floatToDec18(10_000 * 0.9);
      await coin.approve(await roller.getAddress(), floatToDec18(10));
      await roller.roll(
        await pos1.getAddress(),
        toRepay,
        floatToDec18(10),
        await pos2.getAddress(),
        floatToDec18(10_000),
        floatToDec18(10),
        await pos2.expiration(),
      );

      expect(await pos1.isClosed()).to.be.true;
    });

    it("merge full, expiration below, create clone, check ownership", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));

      const toRepay = floatToDec18(10_000 * 0.9);
      await coin.approve(await roller.getAddress(), floatToDec18(10));
      const tx = await roller.roll(
        await pos1.getAddress(),
        toRepay,
        floatToDec18(10),
        await pos2.getAddress(),
        floatToDec18(10_000),
        floatToDec18(10),
        (await pos2.expiration()) - 86_400n,
      );

      const cloneAddr = await getPositionAddress((await tx.wait())!);
      clone1 = await ethers.getContractAt("Position", cloneAddr, owner);

      expect((await clone1.original()).toLowerCase()).to.be.eq(
        (await pos2.getAddress()).toLowerCase(),
        "new position is a clone",
      );
      expect(await clone1.owner()).to.be.eq(
        owner.address,
        "cloned position = correct owner",
      );
    });
  });

  describe("roll tests for owner and alice", () => {
    beforeEach("give owner 1st and alice 2nd position", async () => {
      // OWNER pos1
      await coin.approve(await mintingHub.getAddress(), floatToDec18(10));
      const txPos1 = await (
        await mintingHub.openPosition(
          await coin.getAddress(),
          floatToDec18(1),
          floatToDec18(10),
          floatToDec18(100_000),
          3 * 86_400,
          100 * 86_400,
          86_400,
          20000,
          floatToDec18(6000),
          100000,
        )
      ).wait();
      const pos1Addr = await getPositionAddress(txPos1!);
      pos1 = await ethers.getContractAt("Position", pos1Addr, owner);

      // ALICE pos2
      await coin.connect(alice).approve(await mintingHub.getAddress(), floatToDec18(10));
      const txPos2 = await (
        await mintingHub.connect(alice).openPosition(
          await coin.getAddress(),
          floatToDec18(1),
          floatToDec18(10),
          floatToDec18(100_000),
          3 * 86_400,
          100 * 86_400,
          86_400,
          20000,
          floatToDec18(6000),
          100000,
        )
      ).wait();
      const pos2Addr = await getPositionAddress(txPos2!);
      pos2 = await ethers.getContractAt("Position", pos2Addr, alice);
    });

    it("fully open, correct owner", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      expect(await pos1.start()).to.be.lt(await getTimeStamp());
      expect(await pos2.start()).to.be.lt(await getTimeStamp());
      expect(await pos1.owner()).to.be.eq(owner.address);
      expect(await pos2.owner()).to.be.eq(alice.address);
    });

    it("rollFully simple", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));

      const m1 = await pos1.minted();
      await coin.approve(
        await roller.getAddress(),
        await coin.balanceOf(await pos1.getAddress()),
      );
      await roller.rollFully(await pos1.getAddress(), await pos2.getAddress());
      const m2 = await pos1.minted();
      const b2 = await deuro.balanceOf(owner.address);

      expect(m1).to.be.gt(0n, "pos1 minted > 0 before rolling");
      expect(m2).to.be.eq(0n, "pos1 minted = 0 after rolling fully");
    });

    it("rollFully check collateral rolled amount", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));
      const ownCoinBalance = await coin.balanceOf(owner.address);
      const oldPositionBalance = await coin.balanceOf(await pos1.getAddress());

      await coin.approve(
        await roller.getAddress(),
        await coin.balanceOf(await pos1.getAddress()),
      );
      const tx = await roller.rollFully(
        await pos1.getAddress(),
        await pos2.getAddress(),
      );
      const cloneAddr = await getPositionAddress((await tx.wait())!);
      clone1 = await ethers.getContractAt("Position", cloneAddr, owner);

      const newPositionBalance = await coin.balanceOf(await clone1.getAddress());
      const coinsReturns =
        (await coin.balanceOf(owner.address)) - ownCoinBalance;

      expect(oldPositionBalance).to.be.eq(
        newPositionBalance + coinsReturns,
        "collateral is consistent across the roll",
      );
    });

    it("rollFully check interests and rolled amount", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));

      const b1 = await deuro.balanceOf(owner.address);
      // remove all from owner for the test
      await deuro.transfer(bob.address, b1);

      const m1 = await pos1.minted();
      await coin.approve(
        await roller.getAddress(),
        await coin.balanceOf(await pos1.getAddress()),
      );
      const tx = await roller.rollFully(
        await pos1.getAddress(),
        await pos2.getAddress(),
      );
      const t2 = await getTimeStamp();
      const cloneAddr = await getPositionAddress((await tx.wait())!);
      clone1 = await ethers.getContractAt("Position", cloneAddr, owner);
      const m2 = await clone1.minted();
      const b2 = await deuro.balanceOf(owner.address);

      expect(b2).to.be.eq(0n, "owner's deuro is 0 after rolling fully");

      // approximate any new interest portion using annualInterestPPM() instead of calculateCurrentFee():
      const toRepay = floatToDec18(9_000);
      const approximateFee = await clone1.annualInterestPPM();
      const denominator =
        1_000_000n - (BigInt(await clone1.reserveContribution()) + BigInt(approximateFee));
      let toMint = 0n;
      if (denominator > 0) {
        const numerator = toRepay * 1_000_000n;
        toMint = numerator / denominator + (numerator % denominator > 0n ? 1n : 0n);
      }

      expect(m2).to.be.eq(
        toMint,
        "rolled minted amount with approximate fee/interest assumption",
      );

      // return deuro
      await deuro.connect(bob).transfer(owner.address, b1);
    });

    it("rollFully check interests and rolled amount, with 1000 deuro in wallet", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));
      const b1 = await deuro.balanceOf(owner.address);

      // remove everything but 1000
      await deuro.transfer(bob.address, b1 - floatToDec18(1_000));
      expect(await deuro.balanceOf(owner.address)).to.be.eq(
        floatToDec18(1000),
        "kept 1000 dEUR in wallet",
      );

      await pos2.adjustPrice(1000n * 10n ** 18n);
      await coin.approve(
        await roller.getAddress(),
        await coin.balanceOf(await pos1.getAddress()),
      );
      const tx = await roller.rollFully(
        await pos1.getAddress(),
        await pos2.getAddress(),
      );

      const cloneAddr = await getPositionAddress((await tx.wait())!);
      clone1 = await ethers.getContractAt("Position", cloneAddr, owner);

      const m2 = await clone1.minted();
      const b2 = await deuro.balanceOf(owner.address);

      // some portion used
      expect(b2).to.be.eq(
        890420000000000000000n,
        "some of the leftover 1000 dEUR used for interest coverage",
      );
      expect(m2).to.be.eq(
        floatToDec18(10_000),
        "stays at 10k minted since interest got covered by wallet dEUR",
      );
    });
  });
});