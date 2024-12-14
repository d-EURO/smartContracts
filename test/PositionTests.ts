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
    const DecentralizedEUROFactory =
      await ethers.getContractFactory("DecentralizedEURO");
    dEURO = await DecentralizedEUROFactory.deploy(10 * 86400);
    equity = await ethers.getContractAt("Equity", await dEURO.reserve());

    const positionFactoryFactory =
      await ethers.getContractFactory("PositionFactory");
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
    await mockXEUR
      .connect(owner)
      .approve(await bridge.getAddress(), limit / 3n);
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

  describe("Use Minting Hub", () => {
    let collateral: string;
    let fliqPrice = floatToDec18(5000);
    let minCollateral = floatToDec18(1);
    let fInitialCollateral = floatToDec18(initialCollateral);
    let duration = 60n * 86_400n;
    let fFees = BigInt(fee * 1_000_000);
    let fReserve = BigInt(reserve * 1_000_000);
    let challengePeriod = BigInt(3 * 86400);

    before(async () => {
      collateral = await mockVOL.getAddress();
    });

    it("should revert position opening when initial period is less than 3 days", async () => {
      await mockVOL
        .connect(owner)
        .approve(await mintingHub.getAddress(), fInitialCollateral);
      await expect(
        mintingHub.openPosition(
          collateral,
          minCollateral,
          fInitialCollateral,
          initialLimit,
          86400 * 2,
          duration,
          challengePeriod,
          fFees,
          fliqPrice,
          fReserve,
        ),
      ).to.be.revertedWithoutReason();
    });
    it("should revert creating position when annual interest is less than 1M PPM", async () => {
      await expect(
        mintingHub.openPosition(
          collateral,
          minCollateral,
          fInitialCollateral,
          initialLimit,
          86400 * 2,
          duration,
          challengePeriod,
          2 * 1_000_000,
          fliqPrice,
          fReserve,
        ),
      ).to.be.revertedWithoutReason();
    });
    it("should revert creating position when reserve fee is less than 1M PPM", async () => {
      await expect(
        mintingHub.openPosition(
          collateral,
          minCollateral,
          fInitialCollateral,
          initialLimit,
          86400 * 2,
          duration,
          challengePeriod,
          fFees,
          fliqPrice,
          2 * 1_000_000,
        ),
      ).to.be.revertedWithoutReason();
    });
    it("should revert creating position when initial collateral is less than minimal", async () => {
      await expect(
        mintingHub.openPosition(
          collateral,
          minCollateral,
          minCollateral / 2n,
          initialLimit,
          86400 * 2,
          duration,
          challengePeriod,
          fFees,
          fliqPrice,
          fReserve,
        ),
      ).to.be.revertedWithCustomError(mintingHub, "InsufficientCollateral");
    });
    it("should revert creating position when minimal collateral is not worth of at least 5k dEURO", async () => {
      await expect(
        mintingHub.openPosition(
          collateral,
          minCollateral,
          fInitialCollateral,
          initialLimit,
          86400 * 2,
          duration,
          challengePeriod,
          fFees,
          floatToDec18(4000),
          fReserve,
        ),
      ).to.be.revertedWithCustomError(mintingHub, "InsufficientCollateral");
    });
    it("should revert creating position when collateral token has more than 24 decimals", async () => {
      const testTokenFactory = await ethers.getContractFactory("TestToken");
      const testToken = await testTokenFactory.deploy("Test", "Test", 25);
      await expect(
        mintingHub.openPosition(
          await testToken.getAddress(),
          minCollateral,
          fInitialCollateral,
          initialLimit,
          86400 * 2,
          duration,
          challengePeriod,
          fFees,
          floatToDec18(4000),
          fReserve,
        ),
      ).to.be.revertedWithoutReason();
    });
    it("should revert creating position when collateral token does not revert on error", async () => {
      const testTokenFactory = await ethers.getContractFactory("FreakToken");
      const testToken = await testTokenFactory.deploy("Test", "Test", 17);
      await expect(
        mintingHub.openPosition(
          await testToken.getAddress(),
          minCollateral,
          fInitialCollateral,
          initialLimit,
          86400 * 2,
          duration,
          challengePeriod,
          fFees,
          floatToDec18(4000),
          fReserve
        )
      ).to.be.revertedWithCustomError(mintingHub, "IncompatibleCollateral");
    });
    it("create position", async () => {
      let openingFeedEURO = await mintingHub.OPENING_FEE();
      await mockVOL.approve(await mintingHub.getAddress(), fInitialCollateral);
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
      positionContract = await ethers.getContractAt("Position", positionAddr, owner);
      let balAfter = await dEURO.balanceOf(owner.address);
      let balAfterVOL = await mockVOL.balanceOf(owner.address);
      let ddEURO = dec18ToFloat(balAfter - balBefore);
      let dVOL = dec18ToFloat(balAfterVOL - balBeforeVOL);
      expect(dVOL).to.be.equal(-initialCollateral);
      // owner muss nur den openingFeedEURO zahlen, keine additional Fee vom Position Contract
      expect(ddEURO).to.be.equal(-dec18ToFloat(openingFeedEURO));
      let currentFees = await positionContract.calculateCurrentFee();
      // Jetzt 0, da keine Upfront Fees mehr
      expect(currentFees).to.be.eq(0);
    });
    it("require cooldown", async () => {
      let tx = positionContract
        .connect(owner)
        .mint(owner.address, floatToDec18(5));
      await expect(tx).to.be.revertedWithCustomError(positionContract, "Hot");
    });
    it("should revert minting from non owner", async () => {
      await expect(
        positionContract.connect(alice).mint(owner.address, 100),
      ).to.be.revertedWithCustomError(
        positionContract,
        "OwnableUnauthorizedAccount",
      );
    });
    it("should revert minting when there is a challange", async () => {
      await mockVOL.approve(await mintingHub.getAddress(), fInitialCollateral);
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
      const positionAddr = "0x" + log?.topics[2].substring(26);
      const positionContract = await ethers.getContractAt("Position", positionAddr, owner);
      challengeAmount = initialCollateralClone / 2;
      let fchallengeAmount = floatToDec18(challengeAmount);
      let price = await positionContract.price();
      await mockVOL.approve(await mintingHub.getAddress(), fchallengeAmount);
      await mintingHub.challenge(
        await positionContract.getAddress(),
        fchallengeAmount,
        price,
      );
      await expect(
        positionContract.mint(owner.address, floatToDec18(10)),
      ).to.be.revertedWithCustomError(positionContract, "Challenged");
    });
    it("try clone after 7 days but before collateral was withdrawn", async () => {
      await evm_increaseTime(7 * 86_400 + 60);

      let fInitialCollateralClone = floatToDec18(initialCollateralClone);
      let fdEUROAmount = floatToDec18(1000);
      await mockVOL.transfer(alice.address, fInitialCollateralClone);
      await dEURO.transfer(alice.address, fdEUROAmount);

      await mockVOL
        .connect(alice)
        .approve(await mintingHub.getAddress(), fInitialCollateralClone);
      fGlblZCHBalanceOfCloner = await dEURO.balanceOf(alice.address);

      let expiration = await positionContract.expiration();
      let availableLimit = await positionContract.availableForClones();
      expect(availableLimit).to.be.equal(0);
      let tx = mintingHub
        .connect(alice)
        .clone(positionAddr, fInitialCollateralClone, fMintAmount, expiration);
      await expect(tx).to.be.revertedWithCustomError(
        positionContract,
        "LimitExceeded",
      );

      let colbal1 = await mockVOL.balanceOf(positionAddr);
      await positionContract
        .connect(owner)
        .withdrawCollateral(owner.address, floatToDec18(100));
      let colbal2 = await mockVOL.balanceOf(positionAddr);
      expect(dec18ToFloat(colbal1)).to.be.equal(dec18ToFloat(colbal2) + 100n);
      let availableLimit2 = await positionContract.availableForMinting();
      expect(availableLimit2).to.be.greaterThan(availableLimit);
    });
    it("get loan", async () => {
      await evm_increaseTime(7 * 86_400);

      fLimit = await positionContract.limit();
      limit = dec18ToFloat(fLimit);
      let amount = BigInt(1e18) * 10_000n;
      expect(amount).to.be.lessThan(fLimit);
      let fdEUROBefore = await dEURO.balanceOf(owner.address);
      let targetAmount = BigInt(1e16) * 898548n;
      let totalMint = await positionContract.getMintAmount(targetAmount);
      let expectedAmount = await positionContract.getUsableMint(
        totalMint,
        true,
      );
      for (let testTarget = 0n; testTarget < 100n; testTarget++) {
        let testTotal = await positionContract.getMintAmount(
          targetAmount + testTarget,
        );
        let testExpected = await positionContract.getUsableMint(
          testTotal,
          true,
        );
        expect(testExpected).to.be.eq(targetAmount + testTarget);
      }

      expect(await positionContract.getUsableMint(amount, false)).to.be.equal(
        9000n * BigInt(1e18),
      );

      await positionContract.connect(owner).mint(owner.address, amount); 
      let currentFees = await positionContract.calculateCurrentFee();
      // Nun kein Fees mehr -> 0
      expect(currentFees).to.be.eq(0);

      let fdEUROAfter = await dEURO.balanceOf(owner.address);
      let dEUROMinted = fdEUROAfter - fdEUROBefore;
      expect(expectedAmount).to.be.equal(dEUROMinted);
    });
    it("should revert cloning for invalid position", async () => {
      let fInitialCollateralClone = floatToDec18(initialCollateralClone);
      fGlblZCHBalanceOfCloner = await dEURO.balanceOf(alice.address);

      let start = await positionContract.start();
      let expiration = await positionContract.expiration();
      let duration = (expiration - start) / 2n;
      let newExpiration = expiration - duration;
      await expect(
        mintingHub
          .connect(alice)
          .clone(
            owner.address,
            fInitialCollateralClone,
            fMintAmount,
            newExpiration,
          ),
      ).to.be.revertedWithCustomError(mintingHub, "InvalidPos");
    });
    it("should revert cloning when new expiration is greater than original one", async () => {
      let fInitialCollateralClone = floatToDec18(initialCollateralClone);
      fGlblZCHBalanceOfCloner = await dEURO.balanceOf(alice.address);

      let expiration = await positionContract.expiration();
      await expect(
        mintingHub
          .connect(alice)
          .clone(
            positionAddr,
            fInitialCollateralClone,
            fMintAmount,
            expiration + 100n,
          ),
      ).to.be.revertedWithCustomError(positionContract, "InvalidExpiration");
    });
    it("should revert initializing again", async () => {
      await expect(
        positionContract.initialize(positionAddr, 0),
      ).to.be.revertedWithCustomError(positionContract, "NotHub");
    });
    it("should revert cloning position with insufficient initial collateral", async () => {
      let expiration = await positionContract.expiration();
      await expect(
        mintingHub.connect(alice).clone(positionAddr, 0, 0, expiration),
      ).to.be.revertedWithCustomError(mintingHub, "InsufficientCollateral");
    });
    it("clone position", async () => {
      let fInitialCollateralClone = floatToDec18(initialCollateralClone);
      fGlblZCHBalanceOfCloner = await dEURO.balanceOf(alice.address);

      let fees = await positionContract.calculateCurrentFee();
      expect(fees).to.be.eq(0); 
      const timestamp1 = BigInt(await time.latest());
      let start = await positionContract.start();
      let expiration = await positionContract.expiration();
      let duration = (expiration - start) / 2n;
      let newExpiration = expiration - duration;
      let tx = await mintingHub
        .connect(alice)
        .clone(
          positionAddr,
          fInitialCollateralClone,
          fMintAmount,
          newExpiration,
        );
      let rc = await tx.wait();
      const topic =
        "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175";
      const log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      clonePositionAddr = "0x" + log?.topics[2].substring(26);
      clonePositionContract = await ethers.getContractAt(
        "Position",
        clonePositionAddr,
        alice,
      );
      let newExpirationActual = await clonePositionContract.expiration();
      expect(newExpirationActual).to.be.eq(newExpiration);
      let newFees = await clonePositionContract.calculateCurrentFee();
      expect(newFees).to.be.eq(0); 
    });
    it("correct collateral", async () => {
      let col = await mockVOL.balanceOf(clonePositionAddr);
      expect(col).to.be.equal(floatToDec18(initialCollateralClone));
    });
    it("global mint limit V2024", async () => {
      const pgl = await positionContract.limit();
      const cgl = await clonePositionContract.limit();
      expect(pgl).to.be.equal(cgl);
    });

    it("global mint limit retained", async () => {
      let fLimit0 = await clonePositionContract.availableForMinting();
      let fLimit1 = await positionContract.availableForClones();
      expect(fLimit0).to.be.equal(fLimit1);

      await expect(
        clonePositionContract.mint(owner.address, fLimit0 + 100n),
      ).to.be.revertedWithCustomError(clonePositionContract, "LimitExceeded");
    });
    it("correct fees charged", async () => {
      // Keine upfront Fees mehr -> kein Problem
      let fBalanceAfter = await dEURO.balanceOf(alice.address);
      let mintAfterFees =
        (BigInt(mintAmount) *
          (1000_000n - (28n * (await clonePositionContract.annualInterestPPM())) / 365n - (await clonePositionContract.reserveContribution()))) /
        1000_000n;
      // Hier keine Upfront Fees, also sollte cloneFeeCharged ~0 sein
      let cloneFeeCharged =
        fBalanceAfter - fGlblZCHBalanceOfCloner - mintAfterFees * BigInt(1e18);
      expect(cloneFeeCharged).to.be.approximately(0, BigInt(1e18));
    });
    it("clone position with too much mint", async () => {
      let fInitialCollateralClone = floatToDec18(initialCollateralClone);
      let fdEUROAmount = floatToDec18(1000);
      await mockVOL.mint(alice.address, fInitialCollateralClone * 1000n);
      await dEURO.transfer(alice.address, fdEUROAmount);

      const expiration = await positionContract.expiration();
      await mockVOL
        .connect(alice)
        .approve(
          await mintingHub.getAddress(),
          fInitialCollateralClone * 1000n,
        );
      fGlblZCHBalanceOfCloner = await dEURO.balanceOf(alice.address);
      let available = await positionContract.availableForClones();
      let tx = mintingHub
        .connect(alice)
        .clone(positionAddr, fInitialCollateralClone, available, expiration);
      await expect(tx).to.be.revertedWithCustomError(
        positionContract,
        "InsufficientCollateral",
      );

      let pendingTx = mintingHub
        .connect(alice)
        .clone(
          positionAddr,
          fInitialCollateralClone * 1000n,
          initialLimit,
          expiration,
        );
      await expect(pendingTx).to.be.revertedWithCustomError(
        positionContract,
        "LimitExceeded",
      );
    });
    it("repay position", async () => {
      let cloneOwner = await clonePositionContract.connect(alice).owner();
      expect(cloneOwner).to.be.eq(alice.address);
      let fInitialCollateralClone = floatToDec18(initialCollateralClone);
      let withdrawTx = clonePositionContract.withdrawCollateral(
        cloneOwner,
        fInitialCollateralClone,
      );
      await expect(withdrawTx).to.be.revertedWithCustomError(
        clonePositionContract,
        "InsufficientCollateral",
      );

      let minted = await clonePositionContract.minted();
      let reservePPM = await clonePositionContract.reserveContribution();
      let repayAmount = minted - (minted * reservePPM) / 1000000n;
      let reserve = await dEURO.calculateAssignedReserve(minted, reservePPM);
      expect(reserve + repayAmount).to.be.eq(minted);

      await clonePositionContract.repay(repayAmount - reserve);
      let minted1 = await clonePositionContract.minted();
      let reserve1 = await dEURO.calculateAssignedReserve(minted1, reservePPM);
      let repayAmount1 = minted1 - reserve1;
      await clonePositionContract.repay(repayAmount1);
      await clonePositionContract.withdrawCollateral(
        cloneOwner,
        fInitialCollateralClone,
      );
      let result = await clonePositionContract.isClosed();
      expect(result).to.be.true;
    });
    it("should revert minting when the position is expired", async () => {
      await evm_increaseTime(86400 * 61);
      await expect(
        positionContract.mint(owner.address, floatToDec18(10)),
      ).to.be.revertedWithCustomError(positionContract, "Expired");
    });
    it("should revert on price adjustments when expired", async () => {
      let currentPrice = await positionContract.price();
      await expect(
        positionContract.adjustPrice(currentPrice / 2n),
      ).to.be.revertedWithCustomError(positionContract, "Expired");
    });
    it("should revert on price adjustments when expired", async () => {
      let currentPrice = await positionContract.price();
      let minted = await positionContract.minted();
      let collateralBalance = await mockVOL.balanceOf(positionAddr);
      await positionContract.adjust(minted, collateralBalance, currentPrice); 
      await expect(
        positionContract.adjust(minted, collateralBalance, currentPrice / 2n),
      ).to.be.revertedWithCustomError(positionContract, "Expired");
    });
    it("should revert reducing limit from non hub", async () => {
      await mockVOL.approve(await mintingHub.getAddress(), fInitialCollateral);
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
      positionContract = await ethers.getContractAt("Position", positionAddr, owner);
      await expect(
        positionContract.assertCloneable(),
      ).to.be.revertedWithCustomError(positionContract, "Hot");
      await evm_increaseTime(86400 * 7);
      await positionContract.assertCloneable();
      await expect(
        positionContract.notifyMint(0),
      ).to.be.revertedWithCustomError(positionContract, "NotHub");
      await expect(
        positionContract.notifyRepaid(0),
      ).to.be.revertedWithCustomError(positionContract, "NotHub");
    });
    it("should revert cloning when it is expired", async () => {
      await evm_increaseTime(86400 * 61);
      let fInitialCollateralClone = floatToDec18(initialCollateralClone);
      fGlblZCHBalanceOfCloner = await dEURO.balanceOf(alice.address);
      let expiration = await positionContract.expiration();

      await expect(
        mintingHub
          .connect(alice)
          .clone(
            positionAddr,
            fInitialCollateralClone,
            fMintAmount,
            expiration,
          ),
      ).to.be.revertedWithCustomError(positionContract, "Expired");
    });
    it("should revert reducing limit when there is a challenge", async () => {
      challengeAmount = initialCollateralClone / 2;
      let fchallengeAmount = floatToDec18(challengeAmount);
      let price = await positionContract.price();
      await mockVOL.approve(await mintingHub.getAddress(), fchallengeAmount);
      await mintingHub.challenge(positionAddr, fchallengeAmount, price);
      challengeNumber++;
      await expect(
        positionContract.assertCloneable(),
      ).to.be.revertedWithCustomError(positionContract, "Challenged");
    });
  });
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
      await mockVOL
        .connect(owner)
        .approve(await mintingHub.getAddress(), fInitialCollateral);
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

  // Restliche Tests bleiben unverändert, jedoch wo fees getestet werden, auf 0 angepasst.
  // "owner can mint new dEURO" -> statt 89.8384 nun 90 erwarten.

  describe("adjusting position", async () => {
    beforeEach(async () => {
      let collateral = await mockVOL.getAddress();
      let fliqPrice = floatToDec18(5000);
      let minCollateral = floatToDec18(1);
      let fInitialCollateral = floatToDec18(initialCollateral);
      let duration = BigInt(60 * 86_400);
      let fFees = BigInt(fee * 1_000_000);
      let fReserve = BigInt(reserve * 1_000_000);
      let challengePeriod = BigInt(3 * 86400);
      await mockVOL
        .connect(owner)
        .approve(await mintingHub.getAddress(), fInitialCollateral);
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
      positionContract = await ethers.getContractAt("Position", positionAddr, owner);
      expect(await positionContract.isClosed()).to.be.false;
    });
    it("owner can mint new dEURO", async () => {
      await evm_increaseTime(86400 * 8);
      const price = floatToDec18(1000);
      const colBalance = await mockVOL.balanceOf(positionAddr);
      const minted = await positionContract.minted();
      const amount = floatToDec18(100);

      const beforedEUROBal = await dEURO.balanceOf(owner.address);
      await positionContract.adjust(minted + amount, colBalance, price);
      const afterdEUROBal = await dEURO.balanceOf(owner.address);
      // Nur Reserve wird abgezogen (10%), also von 100 bleiben 90 übrig.
      expect(afterdEUROBal - beforedEUROBal).to.be.equal(
        ethers.parseEther("90"),
      );
    });
  });

  describe("withdrawing any tokens", () => {
    it("should revert withdrawing tokens from non position owner", async () => {
      const amount = floatToDec18(1);
      await expect(
        positionContract
          .connect(alice)
          .withdraw(await dEURO.getAddress(), owner.address, amount),
      ).to.be.revertedWithCustomError(
        positionContract,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("challenge clone", () => {
    it("bid on not existing challenge", async () => {
      let tx = mintingHub.connect(bob).bid(42, floatToDec18(42), false);
      await expect(tx).to.be.reverted;
    });
  });
});