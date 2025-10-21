import { expect } from "chai";
import { floatToDec18 } from "../../scripts/utils/math";
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
} from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { evm_increaseTime, evm_increaseTimeTo } from "../utils";
import { ContractTransactionResponse, EventLog } from "ethers";

const getPositionAddressFromTX = async (
  tx: ContractTransactionResponse,
): Promise<string> => {
  const PositionOpenedTopic =
    "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175";
  const rc = await tx.wait();
  const log = rc?.logs.find((x) => x.topics.indexOf(PositionOpenedTopic) >= 0);
  return "0x" + log?.topics[2].substring(26);
};

describe("ForceSale Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let dEURO: DecentralizedEURO;
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

    const DecentralizedEUROFactory =
      await ethers.getContractFactory("DecentralizedEURO");
    dEURO = await DecentralizedEUROFactory.deploy(5 * 86400);

    const equityAddr = await dEURO.reserve();
    equity = await ethers.getContractAt("Equity", equityAddr);

    const positionFactoryFactory =
      await ethers.getContractFactory("PositionFactory");
    positionFactory = await positionFactoryFactory.deploy();

    const savingsFactory = await ethers.getContractFactory("Savings");
    savings = await savingsFactory.deploy(dEURO.getAddress(), 20000n);

    const rollerFactory = await ethers.getContractFactory("PositionRoller");
    roller = await rollerFactory.deploy(dEURO.getAddress());

    const mintingHubFactory = await ethers.getContractFactory("MintingHub");
    mintingHub = await mintingHubFactory.deploy(
      await dEURO.getAddress(),
      await savings.getAddress(),
      await roller.getAddress(),
      await positionFactory.getAddress(),
    );

    // test coin
    const coinFactory = await ethers.getContractFactory("TestToken");
    coin = await coinFactory.deploy("Supercoin", "XCOIN", 18);

    // jump start ecosystem
    await dEURO.initialize(owner.address, "owner");
    await dEURO.initialize(await mintingHub.getAddress(), "mintingHub");

    await dEURO.mint(owner.address, floatToDec18(2_000_000));
    await dEURO.transfer(alice.address, floatToDec18(100_000));
    await dEURO.transfer(bob.address, floatToDec18(100_000));

    // jump start fps
    await equity.invest(floatToDec18(1000), 0);
    await dEURO.connect(alice).approve(equity, floatToDec18(10_000));
    await equity.connect(alice).invest(floatToDec18(10_000), 0);
    await dEURO.connect(bob).approve(equity, floatToDec18(10_000));
    await equity.connect(bob).invest(floatToDec18(10_000), 0);
    await equity.invest(floatToDec18(1_000_000), 0);

    await coin.mint(alice.address, floatToDec18(1_000));
    await coin.mint(bob.address, floatToDec18(1_000));

    await coin.approve(mintingHub.getAddress(), floatToDec18(10));
    const tx = await mintingHub.openPosition(
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
      );

    // PositionOpened
    const positionAddr = await getPositionAddressFromTX(tx);
    position = await ethers.getContractAt("Position", positionAddr);
    getPositionAddressFromTX
  });

  describe("check position status", () => {
    it("fully open", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      expect(await position.start()).to.be.lessThan(await getTimeStamp());
      expect(await position.cooldown()).to.be.lessThan(await getTimeStamp());
    });

    it("expired", async () => {
      await evm_increaseTime(103 * 86_400 + 300);
      expect(await position.expiration()).to.be.lessThan(await getTimeStamp());
    });
  });

  describe("purchase price tests", () => {
    it("expect 10x liq. price", async () => {
      await evm_increaseTime(3 * 86_400 + 300); // consider open
      const p = await position.price();
      const expP = await mintingHub.expiredPurchasePrice(position);
      expect(expP).to.be.equal(10n * p);
    });

    it("expect 10x -> 1x ramp liq. price", async () => {
      await evm_increaseTime(103 * 86_400 + 100); // consider expired
      const p = await position.price();
      const eP1 = await mintingHub.expiredPurchasePrice(position);
      expect(eP1).to.be.lessThanOrEqual(10n * p);
      expect(eP1).to.be.greaterThan(9n * p);
      const period = await position.challengePeriod();
      await evm_increaseTime(period); // post period
      const eP2 = await mintingHub.expiredPurchasePrice(position);
      expect(eP2).to.be.lessThanOrEqual(p);
    });

    it("expect 0 price after 2nd period", async () => {
      const period = await position.challengePeriod();
      await evm_increaseTime(103n * 86_400n + 2n * period); // post 2nd period
      const eP3 = await mintingHub.expiredPurchasePrice(position);
      expect(eP3).to.be.equal(0n);
    });
  });

  describe("pre expiration tests", () => {
    it("restricted to onlyHub", async () => {
      const r = position.forceSale(
        owner.address,
        floatToDec18(1000),
        floatToDec18(1000),
      );
      await expect(r).to.be.revertedWithCustomError(position, "NotHub");
    });

    it("restricted to expired positions", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      const b = await coin.balanceOf(await position.getAddress());
      const r = mintingHub.buyExpiredCollateral(position, b);
      await expect(r).to.be.revertedWithCustomError(position, "Alive");
    });

    it("try to buy an Alive position and revert", async () => {
      await evm_increaseTime(3 * 86_400 + 300); // consider open
      const size = await coin.balanceOf(await position.getAddress());
      const tx = mintingHub.buyExpiredCollateral(position, size);
      await expect(tx).to.be.revertedWithCustomError(position, "Alive");
    });
  });

  describe("post expiration tests", () => {
    it("restricted to onlyHub", async () => {
      const r = position.forceSale(
        owner.address,
        floatToDec18(1000),
        floatToDec18(1000),
      );
      await expect(r).to.be.revertedWithCustomError(position, "NotHub");
    });

    it("simple buy of expired positions", async () => {
      await evm_increaseTime(103 * 86_400 + 300);
      const b = await coin.balanceOf(await position.getAddress());
      const r = await mintingHub.buyExpiredCollateral(position, b);
    });

    it("buy 10x liq. price", async () => {
      await evm_increaseTime(103 * 86_400 + 300); // consider expired
      const expP = await mintingHub
        .connect(alice)
        .expiredPurchasePrice(position);
      const bdEURO0 = await dEURO.balanceOf(alice.address);
      const bCoin0 = await coin.balanceOf(alice.address);
      // const size = await coin.balanceOf(await position.getAddress());
      const size = floatToDec18(1);
      const expectedCost = (size * expP) / 10n ** 18n;
      await dEURO.connect(alice).approve(position, expectedCost);
      const tx = await mintingHub
        .connect(alice)
        .buyExpiredCollateral(position, size);
      tx.wait();
      const events = await mintingHub.queryFilter(
        mintingHub.filters.ForcedSale,
        -1,
      );
      //console.log(events[0]);
      const bdEURO1 = await dEURO.balanceOf(alice.address);
      const bCoin1 = await coin.balanceOf(alice.address);
      expect(bCoin0 + size).to.be.equal(bCoin1);
      const actualCost = bdEURO0 - bdEURO1;
      expect(actualCost).to.be.approximately(expectedCost, 15n ** 18n); // slight deviation as one block passed
    });

    it("buy 1x liq. price", async () => {
      const period = await position.challengePeriod();
      await evm_increaseTime(103n * 86_400n + period + 300n); // consider expired
      const expP = await mintingHub
        .connect(alice)
        .expiredPurchasePrice(position);
      const bdEURO0 = await dEURO.balanceOf(alice.address);
      const bCoin0 = await coin.balanceOf(alice.address);
      const size = await coin.balanceOf(await position.getAddress());
      await dEURO.connect(alice).approve(position, (size * expP) / 10n ** 18n);
      const tx = await mintingHub
        .connect(alice)
        .buyExpiredCollateral(position, size);
      const bdEURO1 = await dEURO.balanceOf(alice.address);
      const bCoin1 = await coin.balanceOf(alice.address);
      expect(bCoin0 + size).to.be.equal(bCoin1);
      expect(bdEURO1 + (expP * size) / floatToDec18(1)).to.be.approximately(
        bdEURO0,
        15n ** 18n,
      );
    });

    it("Dispose bad debt on force sale", async () => {
      await evm_increaseTime(3 * 86_400 + 300);
      let col = await coin.balanceOf(await position.getAddress());
      let max = ((await position.price()) * col) / 10n ** 18n;
      await position.mint(owner, max);
      expect(await position.principal()).to.be.eq(max);

      const period = await position.challengePeriod();
      await evm_increaseTime(100n * 86_400n + (period * 3n) / 2n + 300n); // consider expired
      const expP = await mintingHub
        .connect(alice)
        .expiredPurchasePrice(position);
      const interest = await position.getInterest();
      
      const expCost = (col * expP) / 10n ** 18n;
      expect(expCost).to.be.lessThan(await position.getDebt());
      const deficit = await position.getDebt() - expCost;
      const reserveBalanceBefore = await dEURO.balanceOf(await dEURO.reserve());
      const ownerBalanceBefore = await dEURO.balanceOf(owner.address);
      let tx = await mintingHub.buyExpiredCollateral(position, col * 10n); // try buying way too much
      expect(tx).to.emit(position, "ForcedSale").withArgs(
        await position.getAddress(),
        col,
        expP,
        interest,
      );
      const reserveBalanceAfter = await dEURO.balanceOf(await dEURO.reserve());
      const ownerBalanceAfter = await dEURO.balanceOf(owner.address);
      expect(await position.getDebt()).to.be.eq(0);
      expect(reserveBalanceBefore + interest - deficit).to.be.approximately(reserveBalanceAfter, floatToDec18(1));
      expect(ownerBalanceBefore - ownerBalanceAfter).to.be.approximately(expCost, floatToDec18(1));
    });
  });

  describe("post expiration tests with interest", () => {
    it("buy some expired collateral with excess proceeds going to owner (after paying off debt)", async () => {
      await evm_increaseTimeTo(await position.cooldown() + 60n);
      const loan = floatToDec18(10_000);
      await position.mint(owner, loan);
      expect(await position.principal()).to.be.equal(loan);

      await evm_increaseTimeTo(await position.expiration() + 60n);
      const size = floatToDec18(1.1);
      const expP = await mintingHub.connect(alice).expiredPurchasePrice(position);
      const totCollateral = await coin.balanceOf(await position.getAddress());
      const expCost = (size * expP) / 10n ** 18n;
      const expTotInterest = await position.getInterest();
      const expPropInterest = (expTotInterest * size) / totCollateral;
      const expCostWithInterest = expCost + expPropInterest;

      const balanceBeforeAlice = await dEURO.balanceOf(alice.address);
      const colBalanceBeforeAlice = await coin.balanceOf(alice.address);
      const balanceBeforeEquity = await dEURO.equity();
      await dEURO.connect(alice).approve(position, expCostWithInterest);
      const tx = await mintingHub.connect(alice).buyExpiredCollateral(position, size);
      const receipt = await tx.wait();
      const balanceAfterAlice = await dEURO.balanceOf(alice.address);
      const colBalanceAfterAlice = await coin.balanceOf(alice.address);
      const balanceAfterEquity = await dEURO.equity();

      const forcedSaleEvent = receipt?.logs.find(
        (log: any) => log.fragment?.name === "ForcedSale"
      ) as EventLog;
      expect(forcedSaleEvent).to.not.be.undefined;
      const { pos, amount, priceE36MinusDecimals } = forcedSaleEvent?.args;
      expect(pos).to.be.equal(ethers.getAddress(await position.getAddress()));
      expect(amount).to.be.equal(size);
      expect(priceE36MinusDecimals).to.be.approximately(expP, floatToDec18(5));

      expect(await position.getDebt()).to.be.equal(0n); // as expCost is significantly higher than debt
      expect(colBalanceAfterAlice - colBalanceBeforeAlice).to.be.equal(size);
      expect(balanceBeforeAlice - balanceAfterAlice).to.be.equal(((priceE36MinusDecimals * size) / 10n ** 18n)); // slight deviation as one block passed
      expect(balanceAfterEquity - balanceBeforeEquity).to.be.approximately(expTotInterest, floatToDec18(0.0001));
    });
    // it("buy remaining expired collateral with excess proceeds going to owner (after paying off debt)", async () => {
    //   await evm_increaseTimeTo(await position.expiration() + 60n);
    //   const totCollateral = await coin.balanceOf(await position.getAddress());
    //   const expP = await mintingHub.connect(alice).expiredPurchasePrice(position);
    //   const expCost = (totCollateral * expP) / 10n ** 18n;
    //   const expTotInterest = await position.getInterest();
    //   const expPropInterest = expTotInterest;
    //   const expCostWithInterest = expCost + expPropInterest;

    //   await dEURO.mint(alice.address, expCostWithInterest);
    //   const balanceBeforeAlice = await dEURO.balanceOf(alice.address);
    //   const colBalanceBeforeAlice = await coin.balanceOf(alice.address);
    //   console.log("totCollateral", totCollateral);
    //   console.log("balanceBeforeAlice", balanceBeforeAlice);
    //   console.log("expertedCost", expCostWithInterest);

    //   await dEURO.connect(alice).approve(position, expCostWithInterest); 
    //   const tx = await mintingHub.connect(alice).buyExpiredCollateral(position, totCollateral);
    //   const receipt = await tx.wait();
    //   const balanceAfterAlice = await dEURO.balanceOf(alice.address);
    //   const colBalanceAfterAlice = await coin.balanceOf(alice.address);

    //   const forcedSaleEvent = receipt?.logs.find(
    //     (log: any) => log.fragment?.name === "ForcedSale"
    //   ) as EventLog;
    //   expect(forcedSaleEvent).to.not.be.undefined;
    //   const { pos, amount, priceE36MinusDecimals, interest } = forcedSaleEvent?.args;
    //   expect(pos).to.be.equal(ethers.getAddress(await position.getAddress()));
    //   expect(amount).to.be.equal(totCollateral);
    //   expect(priceE36MinusDecimals).to.be.approximately(expP, floatToDec18(5));
    //   expect(interest).to.be.approximately(expPropInterest, floatToDec18(0.0001));

    //   expect(await position.getDebt()).to.be.equal(0n); // as expCost is significantly higher than debt
    //   expect(colBalanceAfterAlice - colBalanceBeforeAlice).to.be.equal(totCollateral);
    //   expect(balanceBeforeAlice - balanceAfterAlice).to.be.equal(((priceE36MinusDecimals * totCollateral) / 10n ** 18n) + interest); // slight deviation as one block passed
    // });
  });

  describe("Correct minter reserve and reserve updates given bad debt", () => {
    // Simulate CS-dEUR-003
    let positionAddr: string;
    let positionContract: Position;
    let collateral: string;
    let fReserve: bigint;
    let fInitialCollateral: bigint;
    let minCollateral: bigint;
    let duration: bigint;
    let challengePeriod: bigint;
    let initialCollateral = 110;
    let fee = 0.01;
    let reserve = 0.2; // 20% reserve
    let initialLimit = floatToDec18(550_000);


    beforeEach(async () => {
      collateral = await coin.getAddress();
      minCollateral = floatToDec18(1);
      duration = BigInt(60 * 86_400);
      challengePeriod = BigInt(3 * 86400);
      const fliqPrice = floatToDec18(5000);
      fInitialCollateral = floatToDec18(initialCollateral);
      const fFees = BigInt(fee * 1_000_000);
      fReserve = BigInt(reserve * 1_000_000);

      await coin.approve(await mintingHub.getAddress(), fInitialCollateral);
      const tx = await mintingHub.openPosition(
        collateral,
        minCollateral,
        fInitialCollateral,
        initialLimit,
        7n * 24n * 3600n,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve
      );

      const positionAddress = await getPositionAddressFromTX(tx);
      positionAddr = positionAddress;
      positionContract = await ethers.getContractAt("Position", positionAddr);
      
      // Wait until the position is active
      await evm_increaseTimeTo(await positionContract.start());
    });

    it("buy expired collateral", async () => {
      const mintAmount = floatToDec18(1000);
      await positionContract.mint(owner.address, mintAmount);
      
      // Expire position
      await evm_increaseTime(duration + challengePeriod - 1000n); // End of phase 1
      expect(positionContract.mint(owner.address, 1n)).to.revertedWithCustomError(positionContract, "Expired");
      
      // Remove half of the reserve to simulate bad debt
      const reserveBalanceBefore = await dEURO.balanceOf(await dEURO.reserve());
      const targetReserve = floatToDec18(100); // 50% bad debt
      await dEURO.coverLoss(positionContract, reserveBalanceBefore - targetReserve);
      const reserveBalanceAfter = await dEURO.balanceOf(await dEURO.reserve());
      expect(reserveBalanceAfter).to.be.equal(targetReserve);

      await dEURO.approve(positionContract.getAddress(), floatToDec18(1_000_000));
      await mintingHub.buyExpiredCollateral(positionContract, fInitialCollateral);
      expect(await position.getDebt()).to.be.equal(0n);
    });
  });
});
