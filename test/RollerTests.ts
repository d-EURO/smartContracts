import { expect } from "chai";
import { DECIMALS, floatToDec18 } from "../scripts/math";
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
import { ContractTransactionReceipt, EventLog } from "ethers";

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
    await deuro.connect(alice).approve(equity.getAddress(), floatToDec18(10_000));
    await equity.connect(alice).invest(floatToDec18(10_000), 0);
    await deuro.connect(bob).approve(equity.getAddress(), floatToDec18(10_000));
    await equity.connect(bob).invest(floatToDec18(10_000), 0);
    await equity.invest(floatToDec18(1_000_000), 0);

    await coin.mint(alice.address, floatToDec18(1_000));
    await coin.mint(bob.address, floatToDec18(1_000));

    // // ---------------------------------------------------------------------------
    // // give OWNER a position
    // await coin.approve(mintingHub.getAddress(), floatToDec18(10));
    // const txPos1 = await (
    //   await mintingHub.openPosition(
    //     await coin.getAddress(),
    //     floatToDec18(1), // min size
    //     floatToDec18(10), // size
    //     floatToDec18(100_000), // mint limit
    //     3 * 86_400,
    //     100 * 86_400,
    //     86_400,
    //     10000,
    //     floatToDec18(6000),
    //     100000
    //   )
    // ).wait();
    // const pos1Addr = await getPositionAddress(txPos1!);
    // pos1 = await ethers.getContractAt("Position", pos1Addr, owner);

    // // ---------------------------------------------------------------------------
    // // give ALICE a position
    // await coin
    //   .connect(alice)
    //   .approve(mintingHub.getAddress(), floatToDec18(10));
    // const txPos2 = await (
    //   await mintingHub.connect(alice).openPosition(
    //     await coin.getAddress(),
    //     floatToDec18(1), // min size
    //     floatToDec18(10), // size
    //     floatToDec18(100_000), // mint limit
    //     3 * 86_400,
    //     100 * 86_400,
    //     86_400,
    //     10000,
    //     floatToDec18(6000),
    //     100000
    //   )
    // ).wait();
    // const pos2Addr = await getPositionAddress(txPos2!);
    // pos2 = await ethers.getContractAt("Position", pos2Addr, alice);

    // // ---------------------------------------------------------------------------
    // // give BOB a clone of alice
    // await coin.connect(bob).approve(mintingHub.getAddress(), floatToDec18(10));
    // const txPos3 = await (
    //   await mintingHub.connect(bob)["clone(address,uint256,uint256,uint40)"](
    //     pos2Addr,
    //     floatToDec18(10), // size
    //     floatToDec18(10_000), // mint limit
    //     30 * 86_400
    //   )
    // ).wait();
    // const pos3Addr = await getPositionAddress(txPos3!);
    // clone1 = await ethers.getContractAt("Position", pos3Addr, bob);
  });

  describe("roll tests for owner", () => {
    beforeEach("give owner 1st and 2nd position", async () => {
      // ---------------------------------------------------------------------------
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

      // ---------------------------------------------------------------------------
      // give OWNER a 2nd position
      await coin.approve(await mintingHub.getAddress(), floatToDec18(10));
      const txPos2 = await (
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
        floatToDec18(1_000), //
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
        floatToDec18(1_000), //
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
      const bdeuro1 = await deuro.balanceOf(owner.address);
      await pos1.mint(owner.address, floatToDec18(10_000));
      const bdeuro2 = await deuro.balanceOf(owner.address);
      expect(bdeuro2).to.be.greaterThan(bdeuro1);
      expect(await pos1.getDebt()).to.be.greaterThan(0n);
      expect(await pos2.getDebt()).to.be.equal(0n);
      await coin.approve(await roller.getAddress(), floatToDec18(1));
      const tx = await roller.roll(
        await pos1.getAddress(),
        floatToDec18(1_000), //
        floatToDec18(1),
        await pos2.getAddress(),
        floatToDec18(10_000),
        floatToDec18(1),
        await pos2.expiration(),
      );

      expect(await pos1.getDebt()).to.be.lessThan(
        floatToDec18(10_000),
        "pos1 mint should decrease",
      );
      expect(await pos2.getDebt()).to.be.greaterThanOrEqual(
        floatToDec18(1_000),
        "pos2 mint should increase",
      );
      expect(await coin.balanceOf(await pos1.getAddress())).to.be.equal(
        floatToDec18(9),
        "1 coin should be transfered, dec.",
      );
      expect(await coin.balanceOf(await pos2.getAddress())).to.be.equal(
        floatToDec18(11),
        "1 coin should be transfered, inc.",
      );
    });

    it("merge full into existing position", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));
      const colBalance1 = await coin.balanceOf(await pos1.getAddress());

      await coin.approve(await roller.getAddress(), floatToDec18(10));
      await roller.roll(
        await pos1.getAddress(),
        (await pos1.getDebt()) + floatToDec18(1), // add 1 to cover interest between call and tx execution
        floatToDec18(10), // full collateral balance
        await pos2.getAddress(),
        floatToDec18(10_000), // to borrow
        floatToDec18(10),
        await pos2.expiration(),
      );

      expect(await pos1.getDebt()).to.be.equal(
        floatToDec18(0),
        "pos1 minted should be 0, rolled",
      );
      expect(await pos2.getDebt()).to.be.equal(
        floatToDec18(10_000),
        "pos2 minted should be 10_000 ether",
      );
      expect(await coin.balanceOf(await pos1.getAddress())).to.be.equal(
        floatToDec18(0),
        "coin size of pos1 should be 0, rolled",
      );
      expect(await coin.balanceOf(await pos2.getAddress())).to.be.equal(
        floatToDec18(20),
        "coin size of pos2 should be 20, merged both",
      );
    });

    it("merge full into existing position, consider pos1 closed", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));

      await coin.approve(await roller.getAddress(), floatToDec18(10));
      await roller.roll(
        await pos1.getAddress(),
        (await pos1.getDebt()) + floatToDec18(1), // add 1 to cover interest between call and tx execution
        floatToDec18(10),
        await pos2.getAddress(),
        floatToDec18(10_000), // to borrow
        floatToDec18(10),
        await pos2.expiration(),
      );

      expect(await pos1.isClosed()).to.be.equal(
        true,
        "pos1 should be considered closed after full roll",
      );
    });

    it("merge full, expiration below, create clone, check ownership", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));

      await coin.approve(await roller.getAddress(), floatToDec18(10));
      const tx = await roller.roll(
        await pos1.getAddress(),
        (await pos1.getDebt()) + floatToDec18(1), // add 1 to cover interest between call and tx execution
        floatToDec18(10),
        await pos2.getAddress(),
        floatToDec18(10_000), // to borrow
        floatToDec18(10),
        (await pos2.expiration()) - 86_400n, // reach SC branch below exp. -> clone
      );

      const cloneAddr = await getPositionAddress((await tx.wait())!);
      clone1 = await ethers.getContractAt("Position", cloneAddr, owner);

      expect((await clone1.original()).toLowerCase()).to.be.equal(
        (await pos2.getAddress()).toLowerCase(),
        "new rolled position should be a clone",
      );
      expect(await clone1.owner()).to.be.equal(
        owner.address,
        "cloned rolled position should be owned by correct owner",
      );
    });
  });

  describe("roll tests for owner and alice", () => {
    beforeEach("give owner 1st and alice 2nd position", async () => {
      // ---------------------------------------------------------------------------
      // give OWNER 1st position
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
          20000,
          floatToDec18(6000),
          100000,
        )
      ).wait();
      const pos1Addr = await getPositionAddress(txPos1!);
      pos1 = await ethers.getContractAt("Position", pos1Addr, owner);

      // ---------------------------------------------------------------------------
      // give ALICE 2nd position
      await coin
        .connect(alice)
        .approve(await mintingHub.getAddress(), floatToDec18(10));
      const txPos2 = await (
        await mintingHub.connect(alice).openPosition(
          await coin.getAddress(),
          floatToDec18(1), // min size
          floatToDec18(10), // size
          floatToDec18(100_000), // mint limit
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

      const m1 = await pos1.getDebt();
      await coin.approve(
        await roller.getAddress(),
        await coin.balanceOf(await pos1.getAddress()),
      );
      await roller.rollFully(await pos1.getAddress(), await pos2.getAddress());
      const m2 = await pos1.getDebt();
      const b2 = await deuro.balanceOf(owner.address);

      expect(m1).to.be.greaterThan(
        0,
        "mint pos1 should be greater then 0 before rolling",
      );
      expect(m2).to.be.equal(0, "mint pos1 should be 0 after rolling");
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
        "total amount of collateral should be the same",
      );
    });

    it("should fail to rollFully if balance insufficient to cover interest", async () => {
      await evm_increaseTime(3 * 86400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));

      await evm_increaseTime(5 * 86_400); // 5 days to accrue some interest

      const ownerInitBal = await deuro.balanceOf(owner.address);
      await deuro.transfer(bob.address, ownerInitBal); // remove all deuro
      const b1 = await deuro.balanceOf(owner.address);

      const debt = await pos1.getDebt();
      const collBal = await coin.balanceOf(await pos1.getAddress());
      await coin.approve(await roller.getAddress(), collBal);
      await deuro.approve(await roller.getAddress(), debt + floatToDec18(1)); // add 1 to cover timestamp difference
      const tx = roller.rollFully(
        await pos1.getAddress(),
        await pos2.getAddress(),
      );
      expect(tx).to.be.revertedWithoutReason;

      await deuro.connect(bob).transfer(owner.address, ownerInitBal); // refund deuro for testing
    });

    it("rollFully check interests and rolled amount", async () => {
      await evm_increaseTime(3 * 86400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));

      await evm_increaseTime(5 * 86_400); // 5 days to accrue some interest

      const p1 = await pos1.principal();
      const i1 = await pos1.getDebt() - p1;
      const ownerInitBal = await deuro.balanceOf(owner.address);
      await deuro.transfer(bob.address, ownerInitBal - (i1 + floatToDec18(1))); // remove all deuro for testing, except to cover interest
      const b1 = await deuro.balanceOf(owner.address);

      const collBal = await coin.balanceOf(await pos1.getAddress());
      await coin.approve(await roller.getAddress(), collBal);
      await deuro.approve(await roller.getAddress(), p1 + (i1 + floatToDec18(1))); // add 1 to cover timestamp difference
      const tx = await roller.rollFully(
        await pos1.getAddress(),
        await pos2.getAddress(),
      );
      const receipt = await tx.wait();

      // roll event
      const rollEvent = receipt?.logs
        .map((log) => roller.interface.parseLog(log))
        .find((parsedLog) => parsedLog?.name === 'Roll');
      const [eSource, eCollWithdraw, eRepay, eInterest, eTarget, eCollDeposit, eMint] = rollEvent?.args ?? [];

      // new position
      const cloneAddr = await getPositionAddress(receipt!);
      clone1 = await ethers.getContractAt("Position", cloneAddr, owner);

      const p2 = await clone1.principal();
      const b2 = await deuro.balanceOf(owner.address);
      const targetPrice = await pos2.price();
      let usableAmount = await pos1.getUsableMint(p1);
      let mintAmount = await pos2.getMintAmount(usableAmount); // divide by reserve ratio
      let depositAmount = (mintAmount * 10n ** 18n + targetPrice - 1n) / targetPrice;
      depositAmount = depositAmount > collBal ? collBal : depositAmount;
      mintAmount = depositAmount * targetPrice / 10n ** 18n;  
      expect(eSource).to.be.equal(ethers.getAddress(await pos1.getAddress()));
      expect(eTarget).to.be.equal(ethers.getAddress(cloneAddr));
      expect(eCollWithdraw).to.be.equal(collBal);
      expect(eCollDeposit).to.be.equal(depositAmount);
      expect(eRepay).to.be.equal(p1);
      expect(eMint).to.be.approximately(mintAmount, 1e4);
      expect(eInterest).to.be.approximately(i1, floatToDec18(0.001));
      expect(b1 - BigInt(eInterest)).to.equal(b2);
      expect(p2).to.be.equal(p1); // The rolled principal should be the same
      expect(p2).to.be.approximately(mintAmount, 1e4);

      await deuro.connect(bob).transfer(owner.address, ownerInitBal); // refund deuro for testing
    });

    it("rollFully with lower target collateral price", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));
      const ownerInitBal = await deuro.balanceOf(owner.address);
      await deuro.transfer(bob.address, ownerInitBal - floatToDec18(1_001)); // remove some deuro for testing, add 1 to cover interest
      const b1 = await deuro.balanceOf(owner.address);
      expect(b1).to.be.equal(floatToDec18(1001));

      // decrease collateral price
      await pos2.adjustPrice(1000n * 10n ** 18n); 
      const sourcePrice = await pos1.price();                                         // 6_000 dEURO/coin (price P1)
      const targetPrice = await pos2.price();                                         // 1_000 dEURO/coin (price P2)
      expect(targetPrice).to.be.lessThan(sourcePrice);

      const p1 = await pos1.principal();                                              // 10_000 dEURO (principal P1)
      const i1 = await pos1.getDebt() - p1;
      const collBal = await coin.balanceOf(await pos1.getAddress());                  // 10 coin (collateral P1)
      let usableAmount = await pos1.getUsableMint(p1);                                // 9_000 dEURO (usable mint P1)
      let mintAmount = await pos2.getMintAmount(usableAmount);                        // 10_000 dEURO (principal P2)
      let depositAmount = (mintAmount * 10n ** 18n + targetPrice - 1n) / targetPrice; // 10 coin (collateral P2)
      depositAmount = depositAmount > collBal ? collBal : depositAmount;              // 10 coin (collateral P2)
      mintAmount = depositAmount * targetPrice / 10n ** 18n;                          // 10_000 dEURO (principal P2)

      // The principal of P1 is 10_000 dEURO (principal P1). The collateral value of P1 is 60_000 dEURO (collateral value P1).
      // This means the position is heavily overcollateralized. The usable mint of P1 is 9_000 dEURO (usable mint P1).
      // To obtain the same usable mint in P2, we need to mint 10_000 dEURO (principal P2) (in this example both P1 and P2
      // have the same reserve ratio of 10%). Now at a lowered price of 1_000 dEURO/coin (price P2), we need to deposit
      // 10 coin (collateral P2) to mint 10_000 dEURO (principal P2). This is the exact amount of collateral P1 has.
      // This means the principal and collateral value of P2 will have the same dEURO value (not overcollateralized anymore).

      await coin.approve(await roller.getAddress(), p1);
      await deuro.approve(await roller.getAddress(), p1 + (i1 + floatToDec18(1))); // add 1 to cover timestamp difference
      const tx = await roller.rollFully(
        await pos1.getAddress(),
        await pos2.getAddress(),
      );
      const receipt = await tx.wait();

      // roll event
      const rollEvent = receipt?.logs
      .map((log) => roller.interface.parseLog(log))
      .find((parsedLog) => parsedLog?.name === 'Roll');
      const [eSource, eCollWithdraw, eRepay, eInterest, eTarget, eCollDeposit, eMint] = rollEvent?.args ?? [];

      const cloneAddr = await getPositionAddress((await tx.wait())!);
      clone1 = await ethers.getContractAt("Position", cloneAddr, owner);
      const p2 = await clone1.getDebt();
      const b2 = await deuro.balanceOf(owner.address);
      
      expect(eSource).to.be.equal(ethers.getAddress(await pos1.getAddress()));
      expect(eTarget).to.be.equal(ethers.getAddress(cloneAddr));
      expect(eCollWithdraw).to.be.equal(collBal);
      expect(eCollDeposit).to.be.equal(depositAmount);
      expect(eRepay).to.be.equal(p1);
      expect(eMint).to.be.approximately(mintAmount, 1e4);
      expect(eInterest).to.be.approximately(i1, floatToDec18(0.001));
      expect(b1 - BigInt(eInterest)).to.equal(b2);
      expect(p2).to.be.equal(p1); // The rolled principal should be the same
      expect(p2).to.be.approximately(mintAmount, 1e4);

      await deuro.connect(bob).transfer(owner.address, ownerInitBal); // refund deuro for testing
    });

    it("rollFully with higher target collateral price", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));
      const ownerInitBal = await deuro.balanceOf(owner.address);
      await deuro.transfer(bob.address, ownerInitBal - floatToDec18(1_001)); // remove some deuro for testing, add 1 to cover interest
      const b1 = await deuro.balanceOf(owner.address);
      expect(b1).to.be.equal(floatToDec18(1001));

      // increase collateral price (requires 3 day cooldown to allow cloning)
      await pos2.adjustPrice(9_000n * 10n ** 18n);
      await evm_increaseTime(3 * 86_400 + 300);
      const sourcePrice = await pos1.price();                                         // 6_000 dEURO/coin (price P1)
      const targetPrice = await pos2.price();                                         // 9_000 dEURO/coin (price P2)
      expect(targetPrice).to.be.greaterThan(sourcePrice);

      const p1 = await pos1.principal();                                              // 10_000 dEURO (principal P1)
      const i1 = await pos1.getDebt() - p1;                                           // (interest P1)
      const collBal = await coin.balanceOf(await pos1.getAddress());                  // 10 coin (collateral P1)
      let usableAmount = await pos1.getUsableMint(p1);                                // 9_000 dEURO (usable mint P1)
      let mintAmount = await pos2.getMintAmount(usableAmount);                        // 10_000 dEURO (principal P2)
      let depositAmount = (mintAmount * 10n ** 18n + targetPrice - 1n) / targetPrice; // 1.111... coin (collateral P2)
      depositAmount = depositAmount > collBal ? collBal : depositAmount;              // 1.111... coin (collateral P2)
      mintAmount = depositAmount * targetPrice / 10n ** 18n;                          // 10_000 dEURO (principal P2)

      await coin.approve(await roller.getAddress(), p1);
      await deuro.approve(await roller.getAddress(), p1 + (i1 + floatToDec18(1))); // add 1 to cover timestamp difference
      const tx = await roller.rollFully(
        await pos1.getAddress(),
        await pos2.getAddress(),
      );
      const receipt = await tx.wait();

      // roll event
      const rollEvent = receipt?.logs
      .map((log) => roller.interface.parseLog(log))
      .find((parsedLog) => parsedLog?.name === 'Roll');
      const [eSource, eCollWithdraw, eRepay, eInterest, eTarget, eCollDeposit, eMint] = rollEvent?.args ?? [];

      const cloneAddr = await getPositionAddress((await tx.wait())!);
      clone1 = await ethers.getContractAt("Position", cloneAddr, owner);
      const p2 = await clone1.getDebt();
      const b2 = await deuro.balanceOf(owner.address);
      
      expect(eSource).to.be.equal(ethers.getAddress(await pos1.getAddress()));
      expect(eTarget).to.be.equal(ethers.getAddress(cloneAddr));
      expect(eCollWithdraw).to.be.equal(collBal);
      expect(eCollDeposit).to.be.equal(depositAmount);
      expect(eRepay).to.be.equal(p1);
      expect(eMint).to.be.approximately(mintAmount, 1e4);
      expect(eInterest).to.be.approximately(i1, floatToDec18(0.001));
      expect(b1 - BigInt(eInterest)).to.equal(b2);
      expect(p2).to.be.equal(p1); // The rolled principal should be the same
      expect(p2).to.be.approximately(mintAmount, 1e4);

      await deuro.connect(bob).transfer(owner.address, ownerInitBal); // refund deuro for testing
    });
  });
});
