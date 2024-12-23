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
      "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175"; // PositionOpened event signature
    const log = tx?.logs.find((x) => x.topics.includes(topic));
    return "0x" + log?.topics[2].substring(26);
  };

  before(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    const DecentralizedEUROFactory = await ethers.getContractFactory("DecentralizedEURO");
    deuro = await DecentralizedEUROFactory.deploy(5 * 86400);

    const equityAddr = await deuro.reserve();
    equity = await ethers.getContractAt("Equity", equityAddr);

    const positionFactoryFactory = await ethers.getContractFactory("PositionFactory");
    positionFactory = await positionFactoryFactory.deploy();

    const savingsFactory = await ethers.getContractFactory("Savings");
    savings = await savingsFactory.deploy(await deuro.getAddress(), 20000n);

    const rollerFactory = await ethers.getContractFactory("PositionRoller");
    roller = await rollerFactory.deploy(await deuro.getAddress());

    const mintingHubFactory = await ethers.getContractFactory("MintingHub");
    mintingHub = await mintingHubFactory.deploy(
      await deuro.getAddress(),
      await savings.getAddress(),
      await roller.getAddress(),
      await positionFactory.getAddress()
    );

    // test coin
    const coinFactory = await ethers.getContractFactory("TestToken");
    coin = await coinFactory.deploy("Supercoin", "XCOIN", 18);

    // jump start
    await deuro.initialize(owner.address, "owner");
    await deuro.initialize(await mintingHub.getAddress(), "mintingHub");
    await deuro.initialize(await savings.getAddress(), "savings");
    await deuro.initialize(await roller.getAddress(), "roller");

    // give some dEURO
    await deuro.mint(owner.address, floatToDec18(2_000_000));
    await deuro.transfer(alice.address, floatToDec18(200_000));
    await deuro.transfer(bob.address, floatToDec18(200_000));

    // boost equity
    await equity.invest(floatToDec18(1000), 0);
    await equity.connect(alice).invest(floatToDec18(10_000), 0);
    await equity.connect(bob).invest(floatToDec18(10_000), 0);
    await equity.invest(floatToDec18(1_000_000), 0);

    // give some collateral
    await coin.mint(alice.address, floatToDec18(1_000));
    await coin.mint(bob.address, floatToDec18(1_000));
  });

  describe("roll tests for owner", () => {
    beforeEach("give owner pos1 and pos2", async () => {
      // create pos1
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
          10_000,
          floatToDec18(6000),
          100000
        )
      ).wait();
      const pos1Addr = await getPositionAddress(txPos1!);
      pos1 = await ethers.getContractAt("Position", pos1Addr, owner);

      // create pos2
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
          10_000,
          floatToDec18(6000),
          100000
        )
      ).wait();
      const pos2Addr = await getPositionAddress(txPos2!);
      pos2 = await ethers.getContractAt("Position", pos2Addr, owner);
    });

    it("fully open after initPeriod", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      expect(await pos1.start()).to.be.lessThan(await getTimeStamp());
      expect(await pos2.start()).to.be.lessThan(await getTimeStamp());
    });

    it("roll partially", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));

      const mintedBefore = await pos1.minted();
      // in the new logic: minted = principal + accruedInterest
      // for test we can do:
      //    const principalBefore = await pos1.principal();
      //    const interestBefore = await pos1.accruedInterest();
      // or just keep mintedBefore

      // Approve so roller can move your collateral
      await coin.approve(await roller.getAddress(), floatToDec18(1));

      await roller.roll(
        await pos1.getAddress(),
        floatToDec18(1_000), // repay portion
        floatToDec18(1),    // move 1 coin from pos1
        await pos2.getAddress(),
        floatToDec18(1_000),
        floatToDec18(1),
        await pos2.expiration()
      );

      // Check minted pos1 is now smaller
      const mintedAfter = await pos1.minted();
      expect(mintedAfter).to.be.lessThan(mintedBefore);

      // Check minted pos2 is bigger than 0
      const mintedPos2 = await pos2.minted();
      expect(mintedPos2).to.be.gt(0);

      // Similarly you can compare pos1.principal + pos1.accruedInterest
      // or pos2.principal + pos2.accruedInterest
    });
  });

  // more tests...
});