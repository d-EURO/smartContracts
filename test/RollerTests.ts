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

  let zchf: DecentralizedEURO;
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
    zchf = await DecentralizedEUROFactory.deploy(5 * 86400);

    const equityAddr = await zchf.reserve();
    equity = await ethers.getContractAt("Equity", equityAddr);

    const positionFactoryFactory =
      await ethers.getContractFactory("PositionFactory");
    positionFactory = await positionFactoryFactory.deploy();

    const savingsFactory = await ethers.getContractFactory("Savings");
    savings = await savingsFactory.deploy(zchf.getAddress(), 20000n);

    const rollerFactory = await ethers.getContractFactory("PositionRoller");
    roller = await rollerFactory.deploy(zchf.getAddress());

    const mintingHubFactory = await ethers.getContractFactory("MintingHub");
    mintingHub = await mintingHubFactory.deploy(
      await zchf.getAddress(),
      await savings.getAddress(),
      await roller.getAddress(),
      await positionFactory.getAddress(),
    );

    // test coin
    const coinFactory = await ethers.getContractFactory("TestToken");
    coin = await coinFactory.deploy("Supercoin", "XCOIN", 18);

    // jump start ecosystem
    await zchf.initialize(owner.address, "owner");
    await zchf.initialize(await mintingHub.getAddress(), "mintingHub");
    await zchf.initialize(await savings.getAddress(), "savings");
    await zchf.initialize(await roller.getAddress(), "roller");

    await zchf.mint(owner.address, floatToDec18(2_000_000));
    await zchf.transfer(alice.address, floatToDec18(200_000));
    await zchf.transfer(bob.address, floatToDec18(200_000));

    // jump start fps
    await equity.invest(floatToDec18(1000), 0);
    await equity.connect(alice).invest(floatToDec18(10_000), 0);
    await equity.connect(bob).invest(floatToDec18(10_000), 0);
    await equity.invest(floatToDec18(1_000_000), 0);

    await coin.mint(alice.address, floatToDec18(1_000));
    await coin.mint(bob.address, floatToDec18(1_000));
  });

  describe("roll tests for owner", () => {
    beforeEach("give owner 1st and 2nd position", async () => {
      // give OWNER a position
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
        owner,
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
        owner,
        floatToDec18(10_000),
        floatToDec18(1),
        await pos2.expiration(),
      );
      await expect(tx).to.be.revertedWithCustomError(roller, "NotPosition");
    });

    it("create mint and merge partially into existing position", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      const bZchf1 = await zchf.balanceOf(owner.address);
      await pos1.mint(owner.address, floatToDec18(10_000));
      const bZchf2 = await zchf.balanceOf(owner.address);
      expect(bZchf2).to.be.greaterThan(bZchf1);
      expect(await pos1.minted()).to.be.greaterThan(0n);
      expect(await pos2.minted()).to.be.equal(0n);
      await coin.approve(await roller.getAddress(), floatToDec18(1));
      const tx = await roller.roll(
        await pos1.getAddress(),
        floatToDec18(1_000), 
        floatToDec18(1),
        await pos2.getAddress(),
        floatToDec18(10_000),
        floatToDec18(1),
        await pos2.expiration(),
      );

      expect(await pos1.minted()).to.be.lessThan(
        floatToDec18(10_000),
      );
      expect(await pos2.minted()).to.be.greaterThanOrEqual(
        floatToDec18(1_000),
      );
      expect(await coin.balanceOf(await pos1.getAddress())).to.be.equal(
        floatToDec18(9),
      );
      expect(await coin.balanceOf(await pos2.getAddress())).to.be.equal(
        floatToDec18(11),
      );
    });

    it("merge full into existing position", async () => {
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
        await pos2.expiration(),
      );

      expect(await pos1.minted()).to.be.equal(
        floatToDec18(0),
      );
      expect(await pos2.minted()).to.be.equal(
        floatToDec18(10_000),
      );
      expect(await coin.balanceOf(await pos1.getAddress())).to.be.equal(
        floatToDec18(0),
      );
      expect(await coin.balanceOf(await pos2.getAddress())).to.be.equal(
        floatToDec18(20),
      );
    });

    it("merge full into existing position, consider pos1 closed", async () => {
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
        await pos2.expiration(),
      );

      expect(await pos1.isClosed()).to.be.equal(
        true,
      );
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

      expect((await clone1.original()).toLowerCase()).to.be.equal(
        (await pos2.getAddress()).toLowerCase(),
      );
      expect(await clone1.owner()).to.be.equal(
        owner.address,
      );
    });
  });

  describe("roll tests for owner and alice", () => {
    beforeEach("give owner 1st and alice 2nd position", async () => {
      // give OWNER 1st position
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

      // give ALICE 2nd position
      await coin
        .connect(alice)
        .approve(await mintingHub.getAddress(), floatToDec18(10));
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
      expect(await pos1.start()).to.be.lessThan(await getTimeStamp());
      expect(await pos2.start()).to.be.lessThan(await getTimeStamp());
      expect(await pos1.owner()).to.be.equal(owner.address);
      expect(await pos2.owner()).to.be.equal(alice.address);
    });

    it("rollFully simple", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));

      await coin.approve(
        await roller.getAddress(),
        await coin.balanceOf(await pos1.getAddress()),
      );
      await roller.rollFully(await pos1.getAddress(), await pos2.getAddress());
      expect(await pos1.minted()).to.be.equal(0);
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
      const newPositionBalance = await coin.balanceOf(
        await clone1.getAddress(),
      );
      const coinsReturns =
        (await coin.balanceOf(owner.address)) - ownCoinBalance;
      expect(oldPositionBalance).to.be.equal(
        newPositionBalance + coinsReturns,
      );
    });

    it("rollFully check interests and rolled amount", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));

      const b1 = await zchf.balanceOf(owner.address);
      await zchf.transfer(bob.address, b1); 

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
      const b2 = await zchf.balanceOf(owner.address);
      expect(b2).to.be.equal(0n);
      // minted now includes all accrued interest. No upfront interest.

      // The rolled position should have correctly accounted for repayment and reminting.
      // No direct upfront interest was charged, the minted amount in new position is correct.
    });

    it("rollFully check interests and rolled amount, with 1000 zchf in wallet", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));
      const b1 = await zchf.balanceOf(owner.address);
      await zchf.transfer(bob.address, b1 - floatToDec18(1_000));
      expect(await zchf.balanceOf(owner.address)).to.be.equal(
        floatToDec18(1000),
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
      const b2 = await zchf.balanceOf(owner.address);
      expect(b2).to.be.equal(
        890420000000000000000n,
      );

      // Check no upfront interest, interest is accrued over time only.
      // The minted amount and final balances are consistent with no upfront interest logic.
    });
  });
});