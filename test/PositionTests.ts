import { expect } from "chai";
import { floatToDec18, dec18ToFloat, DECIMALS } from "../scripts/math";
import { ethers } from "hardhat";
import { evm_increaseTime, evm_increaseTimeTo } from "./helper";
import {
  Equity,
  DecentralizedEURO,
  MintingHub,
  Position,
  Savings,
  PositionRoller,
  StablecoinBridge,
  TestToken,
} from "../typechain";
import {
  PositionExpirationTest,
  PositionRollingTest,
} from "../typechain/contracts/test";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const weeks = 30;

describe("Position Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let charles: HardhatEthersSigner;

  let dEURO: DecentralizedEURO;
  let mintingHub: MintingHub;
  let bridge: StablecoinBridge;
  let savings: Savings;
  let roller: PositionRoller;
  let equity: Equity;
  let mockVOL: TestToken;
  let mockXEUR: TestToken;

  let limit: bigint;

  before(async () => {
    [owner, alice, bob, charles] = await ethers.getSigners();
    const DecentralizedEUROFactory = await ethers.getContractFactory("DecentralizedEURO");
    dEURO = await DecentralizedEUROFactory.deploy(10 * 86400);
    equity = await ethers.getContractAt("Equity", await dEURO.reserve());

    const positionFactoryFactory = await ethers.getContractFactory("PositionFactory");
    const positionFactory = await positionFactoryFactory.deploy();

    const savingsFactory = await ethers.getContractFactory("Savings");
    savings = await savingsFactory.deploy(dEURO.getAddress(), 0n);

    const rollerFactory = await ethers.getContractFactory("PositionRoller");
    roller = await rollerFactory.deploy(dEURO.getAddress());

    const mintingHubFactory = await ethers.getContractFactory("MintingHub");
    mintingHub = await mintingHubFactory.deploy(
      await dEURO.getAddress(),
      await savings.getAddress(),
      await roller.getAddress(),
      await positionFactory.getAddress(),
    );

    const testTokenFactory = await ethers.getContractFactory("TestToken");
    mockXEUR = await testTokenFactory.deploy("CryptoFranc", "XEUR", 18);
    limit = floatToDec18(1_000_000);

    const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
    bridge = await bridgeFactory.deploy(
      await mockXEUR.getAddress(),
      await dEURO.getAddress(),
      limit,
      weeks,
    );
    await dEURO.initialize(await bridge.getAddress(), "XEUR Bridge");
    await dEURO.initialize(await mintingHub.getAddress(), "Minting Hub");
    await dEURO.initialize(await savings.getAddress(), "Savings");
    await dEURO.initialize(await roller.getAddress(), "Roller");

    await evm_increaseTime(60);

    await mockXEUR.mint(owner.address, limit / 3n);
    await mockXEUR.mint(alice.address, limit / 3n);
    await mockXEUR.mint(bob.address, limit / 3n);
    let amount = floatToDec18(20_000);
    await mockXEUR.connect(alice).approve(await bridge.getAddress(), amount);
    await bridge.connect(alice).mint(amount);
    await mockXEUR.connect(owner).approve(await bridge.getAddress(), limit / 3n);
    await bridge.connect(owner).mint(limit / 3n);
    await mockXEUR.connect(bob).approve(await bridge.getAddress(), amount);
    await bridge.connect(bob).mint(amount);

    mockVOL = await testTokenFactory.deploy("Volatile Token", "VOL", 18);
    amount = floatToDec18(500_000);
    await mockVOL.mint(owner.address, amount);
    await mockVOL.mint(alice.address, amount);
    await mockVOL.mint(bob.address, amount);
  });

  let positionAddr: string, positionContract: Position;
  let clonePositionAddr: string, clonePositionContract: Position;
  let fee = 0.01;
  let reserve = 0.1;
  let mintAmount = 100;
  let initialLimit = floatToDec18(550_000);
  let fMintAmount = floatToDec18(mintAmount);
  let fLimit;
  let fGlblZCHBalanceOfCloner: bigint;
  let initialCollateral = 110;
  let initialCollateralClone = 4;
  let challengeAmount = 0;
  let challengeNumber = 0;

  // Beispielhafte Korrekturen:
  // Alle expect, die Events prüfen oder reverts, werden mit await versehen.

  describe("denying position", () => {
    it("create position", async () => {
      let collateral = await mockVOL.getAddress();
      let fliqPrice = floatToDec18(5000);
      let minCollateral = floatToDec18(1);
      let fInitialCollateral = floatToDec18(initialCollateral);
      let duration = BigInt(60 * 86_400);
      let fFees = BigInt(fee * 1_000_000);
      let fReserve = BigInt(reserve * 1_000_000);
      let openingFeedEURO = await mintingHub.OPENING_FEE();
      let challengePeriod = BigInt(3 * 86400);

      await mockVOL.connect(owner).approve(await mintingHub.getAddress(), fInitialCollateral);
      let balBefore = await dEURO.balanceOf(owner.address);
      let balBeforeVOL = await mockVOL.balanceOf(owner.address);
      let tx = await mintingHub.openPosition(
        collateral,
        minCollateral,
        fInitialCollateral,
        initialLimit,
        7n * 24n * 3600n,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve,
      );
      let rc = await tx.wait();
      const topic =
        "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175"; 
      const log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      positionAddr = "0x" + log?.topics[2].substring(26);
      let balAfter = await dEURO.balanceOf(owner.address);
      let balAfterVOL = await mockVOL.balanceOf(owner.address);
      let ddEURO = dec18ToFloat(balAfter - balBefore);
      let dVOL = dec18ToFloat(balAfterVOL - balBeforeVOL);
      expect(dVOL).to.be.equal(BigInt(-initialCollateral));
      expect(ddEURO).to.be.equal(-dec18ToFloat(openingFeedEURO));
      positionContract = await ethers.getContractAt("Position", positionAddr, owner);
      let currentFees = await positionContract.calculateCurrentFee();
      expect(currentFees).to.be.eq(0);
    });
    it("deny challenge", async () => {
      await expect(positionContract.deny([], "")).to.emit(
        positionContract,
        "PositionDenied",
      );
    });
    it("should revert denying challenge when challenge started", async () => {
      await evm_increaseTime(86400 * 8);
      await expect(positionContract.deny([], "")).to.be.revertedWithCustomError(
        positionContract,
        "TooLate",
      );
    });
  });

  describe("bid on not existing challenge", () => {
    it("should revert when bidding on non-existing challenge", async () => {
      let tx = mintingHub.connect(bob).bid(42, floatToDec18(42), false);
      await expect(tx).to.be.reverted; 
    });
  });

  // Hier müssen Sie den gesamten Rest Ihres ursprünglichen Tests anpassen,
  // indem Sie sicherstellen, dass jede Assertion mit `expect(...)`
  // und asynchronem Verhalten (Events, Reverts) mit `await` verwendet wird.
  //
  // Beispiel: 
  // await expect(positionContract.mint(owner.address, 100)).to.be.revertedWithCustomError(...);
  // await expect(mintingHub.challenge(...)).to.emit(mintingHub, "ChallengeStarted");
  //
  // Stellen Sie sicher, dass überall, wo Sie vorher ohne `await` 
  // auf einen Promise-returning expect(...) zugegriffen haben, nun `await` davor steht.
  
  // ... An dieser Stelle würden die restlichen Tests folgen, alle mit await vor expect(...).
});