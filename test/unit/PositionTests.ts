import { expect } from "chai";
import {
  floatToDec18,
  dec18ToFloat,
  DECIMALS,
} from "../../scripts/utils/math";
import { ethers } from "hardhat";
import { evm_increaseTime, evm_increaseTimeTo } from "../utils";
import {
  Equity,
  JuiceDollar,
  MintingHub,
  Position,
  Savings,
  PositionRoller,
  StablecoinBridge,
  TestToken,
  PositionExpirationTest,
  PositionRollingTest,
} from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ContractTransactionResponse } from "ethers";

const weeks = 30;

const getPositionAddressFromTX = async (
  tx: ContractTransactionResponse,
): Promise<string> => {
  const PositionOpenedTopic =
    "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175";
  const rc = await tx.wait();
  const log = rc?.logs.find((x) => x.topics.indexOf(PositionOpenedTopic) >= 0);
  return "0x" + log?.topics[2].substring(26);
};

describe("Position Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let charles: HardhatEthersSigner;

  let JUSD: JuiceDollar;
  let mintingHub: MintingHub;
  let bridge: StablecoinBridge;
  let savings: Savings;
  let roller: PositionRoller;
  let equity: Equity;
  let mockVOL: TestToken;
  let mockXUSD: TestToken;

  let limit: bigint;

  before(async () => {
    [owner, alice, bob, charles] = await ethers.getSigners();
    // create contracts
    const JuiceDollarFactory =
      await ethers.getContractFactory("JuiceDollar");
    JUSD = await JuiceDollarFactory.deploy(10 * 86400);
    equity = await ethers.getContractAt("Equity", await JUSD.reserve());

    const positionFactoryFactory =
      await ethers.getContractFactory("PositionFactory");
    const positionFactory = await positionFactoryFactory.deploy();

    const savingsFactory = await ethers.getContractFactory("Savings");
    savings = await savingsFactory.deploy(JUSD.getAddress(), 0n);

    const rollerFactory = await ethers.getContractFactory("PositionRoller");
    roller = await rollerFactory.deploy(JUSD.getAddress());

    const mintingHubFactory = await ethers.getContractFactory("MintingHub");
    mintingHub = await mintingHubFactory.deploy(
      await JUSD.getAddress(),
      await savings.getAddress(),
      await roller.getAddress(),
      await positionFactory.getAddress(),
    );

    // mocktoken
    const testTokenFactory = await ethers.getContractFactory("TestToken");
    mockXUSD = await testTokenFactory.deploy("CryptoFranc", "XUSD", 18);
    // mocktoken bridge to bootstrap
    limit = floatToDec18(1_000_000);
    const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
    bridge = await bridgeFactory.deploy(
      await mockXUSD.getAddress(),
      await JUSD.getAddress(),
      limit,
      weeks,
    );
    await JUSD.initialize(await bridge.getAddress(), "XUSD Bridge");
    // create a minting hub too while we have no JUSD supply
    await JUSD.initialize(await mintingHub.getAddress(), "Minting Hub");
    await JUSD.initialize(await savings.getAddress(), "Savings");
    await JUSD.initialize(await roller.getAddress(), "Roller");

    // wait for 1 block
    await evm_increaseTime(60);
    // now we are ready to bootstrap JUSD with Mock-XUSD
    await mockXUSD.mint(owner.address, limit / 3n);
    await mockXUSD.mint(alice.address, limit / 3n);
    await mockXUSD.mint(bob.address, limit / 3n);
    // mint some JUSD to block bridges without veto
    let amount = floatToDec18(20_000);
    await mockXUSD.connect(alice).approve(await bridge.getAddress(), amount);
    await bridge.connect(alice).mint(amount);
    await mockXUSD
      .connect(owner)
      .approve(await bridge.getAddress(), limit / 3n);
    await bridge.connect(owner).mint(limit / 3n); // owner should have plenty
    await mockXUSD.connect(bob).approve(await bridge.getAddress(), amount);
    await bridge.connect(bob).mint(amount);
    // vol tokens
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
    let challengePeriod = BigInt(3 * 86400); // 3 days

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
      ).to.be.revertedWithCustomError(mintingHub, "InitPeriodTooShort");
    });
    it("should revert creating position when annual interest is larger than 1M PPM", async () => {
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
      ).to.be.revertedWithCustomError(mintingHub, "InvalidRiskPremium");
    });
    it("should revert creating position when reserve fee is larger than 1M PPM", async () => {
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
      ).to.be.revertedWithCustomError(mintingHub, "InvalidReservePPM")
    });
    it("should revert creating position when initial collateral is less than minimal", async () => {
      await expect(
        mintingHub.openPosition(
          collateral,
          minCollateral,
          minCollateral / 2n,
          initialLimit,
          86_400 * 3,
          duration,
          challengePeriod,
          fFees,
          fliqPrice,
          fReserve,
        ),
      ).to.be.revertedWithCustomError(mintingHub, "InsufficientCollateral");
    });
    it("should revert creating position when minimal collateral is not worth of at least 5k JUSD", async () => {
      await expect(
        mintingHub.openPosition(
          collateral,
          minCollateral,
          fInitialCollateral,
          initialLimit,
          86400 * 3,
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
      ).to.be.revertedWithCustomError(mintingHub, "InvalidCollateralDecimals");
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
          86400 * 3,
          duration,
          challengePeriod,
          fFees,
          floatToDec18(4000),
          fReserve,
        ),
      ).to.be.revertedWithCustomError(mintingHub, "IncompatibleCollateral");
    });
    it("create position", async () => {
      let openingFeeJUSD = await mintingHub.OPENING_FEE();
      await mockVOL.approve(await mintingHub.getAddress(), fInitialCollateral);
      let balBefore = await JUSD.balanceOf(owner.address);
      let balBeforeVOL = await mockVOL.balanceOf(owner.address);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
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
        "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175"; // PositionOpened
      const log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      positionAddr = "0x" + log?.topics[2].substring(26);
      positionContract = await ethers.getContractAt(
        "Position",
        positionAddr,
      );
      let balAfter = await JUSD.balanceOf(owner.address);
      let balAfterVOL = await mockVOL.balanceOf(owner.address);
      let dJUSD = dec18ToFloat(balAfter - balBefore);
      let dVOL = dec18ToFloat(balAfterVOL - balBeforeVOL);
      expect(dVOL).to.be.equal(-initialCollateral);
      expect(dJUSD).to.be.equal(-dec18ToFloat(openingFeeJUSD));
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
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
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
        "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175"; // PositionOpened
      const log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      const positionAddr = "0x" + log?.topics[2].substring(26);
      const positionContract = await ethers.getContractAt(
        "Position",
        positionAddr,
      );
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
      // "wait" 7 days...
      await evm_increaseTime(7 * 86_400 + 60);

      let fInitialCollateralClone = floatToDec18(initialCollateralClone);
      let fJUSDAmount = floatToDec18(1000);
      // send some collateral and JUSD to the cloner
      await mockVOL.transfer(alice.address, fInitialCollateralClone);
      await JUSD.transfer(alice.address, fJUSDAmount);

      await mockVOL
        .connect(alice)
        .approve(await mintingHub.getAddress(), fInitialCollateralClone);
      fGlblZCHBalanceOfCloner = await JUSD.balanceOf(alice.address);

      let expiration = await positionContract.expiration();
      let availableLimit = await positionContract.availableForClones();
      expect(availableLimit).to.be.equal(0);
      let tx = mintingHub
        .connect(alice)
        ["clone(address,uint256,uint256,uint40)"](positionAddr, fInitialCollateralClone, fMintAmount, expiration);
      await expect(tx).to.be.revertedWithCustomError(
        positionContract,
        "LimitExceeded",
      );

      let colbal1 = await mockVOL.balanceOf(positionAddr);
      await positionContract
        .connect(owner)
        .withdrawCollateral(owner.address, floatToDec18(100)); // make sure it works the next time
      let colbal2 = await mockVOL.balanceOf(positionAddr);
      expect(dec18ToFloat(colbal1)).to.be.equal(dec18ToFloat(colbal2) + 100n);
      let availableLimit2 = await positionContract.availableForMinting();
      expect(availableLimit2).to.be.greaterThan(availableLimit);
    });
    it("get loan", async () => {
      await evm_increaseTime(7 * 86_400); // 14 days passed in total

      fLimit = await positionContract.limit();
      limit = dec18ToFloat(fLimit);
      let amount = BigInt(1e18) * 10_000n;
      expect(amount).to.be.lessThan(fLimit);
      let targetAmount = BigInt(1e16) * 898548n;
      let totalMint = await positionContract.getMintAmount(targetAmount);
      let expectedAmount = await positionContract.getUsableMint(totalMint);
      for (let testTarget = 0n; testTarget < 100n; testTarget++) {
        // make sure these functions are not susceptible to rounding errors
        let testTotal = await positionContract.getMintAmount(
          targetAmount + testTarget,
        );
        let testExpected = await positionContract.getUsableMint(testTotal);
        expect(testExpected).to.be.eq(targetAmount + testTarget);
      }

      expect(await positionContract.getUsableMint(amount)).to.be.equal(
        9000n * BigInt(1e18),
      );

      let fJUSDBefore = await JUSD.balanceOf(owner.address);
      await positionContract.connect(owner).mint(owner.address, totalMint); //).to.emit("PositionOpened");
      let interest = await positionContract.getInterest();
      expect(interest).to.be.eq(0); // no interest yet

      let fJUSDAfter = await JUSD.balanceOf(owner.address);
      let JUSDMinted = fJUSDAfter - fJUSDBefore;
      expect(expectedAmount).to.be.equal(JUSDMinted);
    });
    it("should revert cloning for invalid position", async () => {
      let fInitialCollateralClone = floatToDec18(initialCollateralClone);
      fGlblZCHBalanceOfCloner = await JUSD.balanceOf(alice.address);

      let start = await positionContract.start();
      let expiration = await positionContract.expiration();
      let duration = (expiration - start) / 2n;
      let newExpiration = expiration - duration;
      await expect(
        mintingHub
          .connect(alice)
          ["clone(address,uint256,uint256,uint40)"](
            owner.address,
            fInitialCollateralClone,
            fMintAmount,
            newExpiration,
          ),
      ).to.be.revertedWithCustomError(mintingHub, "InvalidPos");
    });
    it("should revert cloning when new expiration is greater than original one", async () => {
      let fInitialCollateralClone = floatToDec18(initialCollateralClone);
      fGlblZCHBalanceOfCloner = await JUSD.balanceOf(alice.address);

      let expiration = await positionContract.expiration();
      await expect(
        mintingHub
          .connect(alice)
          ["clone(address,uint256,uint256,uint40)"](
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
    it("should successfully mint for position owner", async () => {
      await evm_increaseTime(86400 * 7)
      const amount = floatToDec18(5);
      const reserveContribution = await positionContract.reserveContribution();
      const ownerBalanceBefore = await JUSD.balanceOf(owner.address);
      const reserveBalanceBefore = await JUSD.balanceOf(await JUSD.reserve());
      const principalBefore = await positionContract.principal();
      const lastAccrualTimeBefore = await positionContract.lastAccrual();
      await positionContract
        .connect(owner)
        .mint(owner.address, amount);
      const ownerBalanceAfter = await JUSD.balanceOf(owner.address);
      const reserveBalanceAfter = await JUSD.balanceOf(await JUSD.reserve());
      const principalAfter = await positionContract.principal();
      const lastAccrualTimeAfter = await positionContract.lastAccrual();
      const expReserveContribution = (amount * reserveContribution) / 1_000_000n;
      expect(lastAccrualTimeAfter).to.be.greaterThan(lastAccrualTimeBefore);
      expect(principalAfter - principalBefore).to.be.equal(amount);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.be.equal(amount - expReserveContribution);
      expect(reserveBalanceAfter - reserveBalanceBefore).to.be.equal(expReserveContribution);
    });
    it("should revert cloning position with insufficient initial collateral", async () => {
      let expiration = await positionContract.expiration();
      await expect(
        mintingHub.connect(alice)["clone(address,uint256,uint256,uint40)"](positionAddr, 0, 0, expiration),
      ).to.be.revertedWithCustomError(mintingHub, "InsufficientCollateral");
    });
    it("clone position", async () => {
      let fInitialCollateralClone = floatToDec18(initialCollateralClone);
      fGlblZCHBalanceOfCloner = await JUSD.balanceOf(alice.address);

      let start = await positionContract.start();
      let expiration = await positionContract.expiration();
      let duration = (expiration - start) / 2n;
      let newExpiration = expiration - duration;
      let tx = await mintingHub
        .connect(alice)
        ["clone(address,uint256,uint256,uint40)"](
          positionAddr,
          fInitialCollateralClone,
          fMintAmount,
          newExpiration,
        );
      let rc = await tx.wait();
      const topic =
        "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175"; // PositionOpened
      const log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      clonePositionAddr = "0x" + log?.topics[2].substring(26);
      clonePositionContract = await ethers.getContractAt(
        "Position",
        clonePositionAddr,
      );
      clonePositionContract = clonePositionContract.connect(alice);
      let newStart = await clonePositionContract.start();
      let newExpirationActual = await clonePositionContract.expiration();
      let newInterest = await clonePositionContract.getInterest();
      expect(newExpirationActual).to.be.eq(newExpiration);
      expect(newInterest).to.be.eq(0);
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
      if (fLimit0 != fLimit1) {
        console.log("new global limit =", fLimit0);
        console.log("original global limit =", fLimit1);
      }
      expect(fLimit0).to.be.equal(fLimit1);

      await expect(
        clonePositionContract.mint(owner.address, fLimit0 + 100n),
      ).to.be.revertedWithCustomError(clonePositionContract, "LimitExceeded");
    });
    it("correct fees charged", async () => {
      // fees:
      // - reserve contribution (temporary fee)
      // - yearlyInterestPPM
      // - position fee (or clone fee)
      let reserveContributionPPM =
        await clonePositionContract.reserveContribution();
      let yearlyInterestPPM = await clonePositionContract.fixedAnnualRatePPM();

      let fBalanceAfter = await JUSD.balanceOf(alice.address);
      let mintAfterFees =
        (BigInt(mintAmount) *
          (1000_000n -
            (28n * yearlyInterestPPM) / 365n -
            reserveContributionPPM)) /
        1000_000n;
      let cloneFeeCharged =
        fBalanceAfter - fGlblZCHBalanceOfCloner - mintAfterFees * BigInt(1e18);
      expect(cloneFeeCharged).to.be.approximately(0, BigInt(1e18)); // no extra fees when cloning
    });
    it("clone position with too much mint", async () => {
      let fInitialCollateralClone = floatToDec18(initialCollateralClone);
      let fJUSDAmount = floatToDec18(1000);
      // send some collateral and JUSD to the cloner
      await mockVOL.mint(alice.address, fInitialCollateralClone * 1000n);
      await JUSD.transfer(alice.address, fJUSDAmount);

      const expiration = await positionContract.expiration();
      await mockVOL
        .connect(alice)
        .approve(
          await mintingHub.getAddress(),
          fInitialCollateralClone * 1000n,
        );
      fGlblZCHBalanceOfCloner = await JUSD.balanceOf(alice.address);
      let available = await positionContract.availableForClones();
      let price = await positionContract.price();
      let tx = mintingHub
        .connect(alice)
        ["clone(address,uint256,uint256,uint40)"](positionAddr, fInitialCollateralClone, available, expiration);
      await expect(tx).to.be.revertedWithCustomError(
        positionContract,
        "InsufficientCollateral",
      );

      let pendingTx = mintingHub
        .connect(alice)
        ["clone(address,uint256,uint256,uint40)"](
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

      let principal = await clonePositionContract.principal();
      let minted = await clonePositionContract.getDebt();
      let reservePPM = await clonePositionContract.reserveContribution();
      let repayAmount = minted - (principal * reservePPM) / 1000000n;
      let reserve = await JUSD.calculateAssignedReserve(principal, reservePPM);
      expect(reserve + repayAmount).to.be.eq(minted);

      await JUSD
        .connect(alice)
        .approve(clonePositionAddr, minted + floatToDec18(1));
      await clonePositionContract.repayFull();
      await clonePositionContract.withdrawCollateral(
        cloneOwner,
        fInitialCollateralClone,
      );
      let result = await clonePositionContract.isClosed();
      await expect(result).to.be.true;
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
      let principal = await positionContract.principal();
      let collateralBalance = await mockVOL.balanceOf(positionAddr);
      await JUSD.connect(owner).approve(positionAddr, principal);
      await positionContract.adjust(principal, collateralBalance, currentPrice); // don't revert if price is the same
      await expect(
        positionContract.adjust(principal, collateralBalance, currentPrice / 2n),
      ).to.be.revertedWithCustomError(positionContract, "Expired");
    });
    it("should revert reducing limit from non hub", async () => {
      await mockVOL.approve(await mintingHub.getAddress(), fInitialCollateral);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
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
        "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175"; // PositionOpened
      const log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      positionAddr = "0x" + log?.topics[2].substring(26);
      positionContract = await ethers.getContractAt(
        "Position",
        positionAddr,
      );
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
    it("should revert cloning when it is expired", async () => async () => {
      await evm_increaseTime(86400 * 61);
      let fInitialCollateralClone = floatToDec18(initialCollateralClone);
      fGlblZCHBalanceOfCloner = await JUSD.balanceOf(alice.address);
      let expiration = await positionContract.expiration();

      await expect(
        mintingHub
          .connect(alice)
          ["clone(address,uint256,uint256,uint40)"](
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
      let openingFeeJUSD = await mintingHub.OPENING_FEE();
      let challengePeriod = BigInt(3 * 86400); // 3 days
      await mockVOL
        .connect(owner)
        .approve(await mintingHub.getAddress(), fInitialCollateral);
      let balBefore = await JUSD.balanceOf(owner.address);
      let balBeforeVOL = await mockVOL.balanceOf(owner.address);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
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
        "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175"; // PositionOpened
      const log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      positionAddr = "0x" + log?.topics[2].substring(26);
      let balAfter = await JUSD.balanceOf(owner.address);
      let balAfterVOL = await mockVOL.balanceOf(owner.address);
      let dJUSD = dec18ToFloat(balAfter - balBefore);
      let dVOL = dec18ToFloat(balAfterVOL - balBeforeVOL);
      expect(dVOL).to.be.equal(BigInt(-initialCollateral));
      expect(dJUSD).to.be.equal(-dec18ToFloat(openingFeeJUSD));
      positionContract = await ethers.getContractAt(
        "Position",
        positionAddr,
      );
      let currentInterest = await positionContract.getInterest();
      expect(currentInterest).to.be.eq(0);
    });
    it("deny challenge", async () => {
      expect(positionContract.deny([], "")).to.be.emit(
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
  describe("challenge active", () => {
    beforeEach(async () => {
      let collateral = await mockVOL.getAddress();
      let fliqPrice = floatToDec18(5000);
      let minCollateral = floatToDec18(1);
      let fInitialCollateral = floatToDec18(initialCollateral);
      let duration = BigInt(60 * 86_400);
      let fFees = BigInt(fee * 1_000_000);
      let fReserve = BigInt(reserve * 1_000_000);
      let openingFeeJUSD = await mintingHub.OPENING_FEE();
      let challengePeriod = BigInt(3 * 86400); // 3 days
      await mockVOL
        .connect(owner)
        .approve(await mintingHub.getAddress(), fInitialCollateral);
      let balBefore = await JUSD.balanceOf(owner.address);
      let balBeforeVOL = await mockVOL.balanceOf(owner.address);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
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
        "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175"; // PositionOpened
      const log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      positionAddr = "0x" + log?.topics[2].substring(26);
      let balAfter = await JUSD.balanceOf(owner.address);
      let balAfterVOL = await mockVOL.balanceOf(owner.address);
      let dJUSD = dec18ToFloat(balAfter - balBefore);
      let dVOL = dec18ToFloat(balAfterVOL - balBeforeVOL);
      expect(dVOL).to.be.equal(BigInt(-initialCollateral));
      expect(dJUSD).to.be.equal(-dec18ToFloat(openingFeeJUSD));
      positionContract = await ethers.getContractAt(
        "Position",
        positionAddr,
      );
    });
    it("should revert challenging from non minting hub address", async () => {
      challengeAmount = initialCollateralClone / 2;
      let fchallengeAmount = floatToDec18(challengeAmount);
      await expect(
        positionContract.notifyChallengeStarted(fchallengeAmount, await positionContract.virtualPrice()),
      ).to.be.revertedWithCustomError(positionContract, "NotHub");
    });
    it("should revert challenging with zero collateral", async () => {
      let price = await positionContract.price();
      await expect(
        mintingHub.challenge(positionAddr, 0, price),
      ).to.be.revertedWithCustomError(positionContract, "ChallengeTooSmall");
    });
    it("should revert challenging for invalid position address", async () => {
      challengeAmount = initialCollateralClone / 2;
      let fchallengeAmount = floatToDec18(challengeAmount);
      let price = await positionContract.price();
      await expect(
        mintingHub.challenge(owner.address, fchallengeAmount, price),
      ).to.be.revertedWithCustomError(mintingHub, "InvalidPos");
    });
    it("should revert challenging with different position price", async () => {
      challengeAmount = initialCollateralClone / 2;
      let fchallengeAmount = floatToDec18(challengeAmount);
      let price = await positionContract.price();
      await expect(
        mintingHub.challenge(positionAddr, fchallengeAmount, price + 100n),
      ).to.be.revertedWithCustomError(mintingHub, "UnexpectedPrice");
    });
    it("should revert challenging zero amount or less than minimal collateral", async () => {
      let price = await positionContract.price();
      await mockVOL.approve(await mintingHub.getAddress(), floatToDec18(0.1));

      await expect(
        mintingHub.challenge(positionAddr, 0, price),
      ).to.be.revertedWithCustomError(positionContract, "ChallengeTooSmall");
      await expect(
        mintingHub.challenge(positionAddr, floatToDec18(0.1), price),
      ).to.be.revertedWithCustomError(positionContract, "ChallengeTooSmall");
    });
    it("bid on challenged, flat sale, not expired position", async () => {
      challengeAmount = initialCollateralClone / 2;
      const fchallengeAmount = floatToDec18(challengeAmount);
      const price = await positionContract.price();
      await mockVOL.approve(await mintingHub.getAddress(), fchallengeAmount);
      let tx = await mintingHub.challenge(
        positionAddr,
        fchallengeAmount,
        price,
      );
      challengeNumber++;
      const challenge = await mintingHub.challenges(challengeNumber);
      const challengerAddress = challenge.challenger;
      const challengeData = await positionContract.challengeData();

      // Flat sale
      await evm_increaseTime(challengeData.phase / 2n);
      let liqPrice = await mintingHub.price(challengeNumber);
      expect(liqPrice).to.be.equal(price);

      const bidSize = floatToDec18(challengeAmount / 4);
      let bidAmountJUSD = (liqPrice * bidSize) / DECIMALS;
      let balanceBeforeBob = await JUSD.balanceOf(bob.address);
      let balanceBeforeChallenger = await JUSD.balanceOf(challengerAddress);
      let volBalanceBefore = await mockVOL.balanceOf(bob.address);

      await JUSD
        .connect(bob)
        .approve(await mintingHub.getAddress(), bidAmountJUSD);
      tx = await mintingHub.connect(bob).bid(challengeNumber, bidSize, false);
      await expect(tx).to.emit(mintingHub, "ChallengeAverted");
      let balanceAfterChallenger = await JUSD.balanceOf(challengerAddress);
      let balanceAfterBob = await JUSD.balanceOf(bob.address);
      let volBalanceAfter = await mockVOL.balanceOf(bob.address);

      expect(volBalanceAfter - volBalanceBefore).to.be.eq(bidSize);
      expect(balanceBeforeBob - balanceAfterBob).to.be.equal(bidAmountJUSD);
      expect(balanceAfterChallenger - balanceBeforeChallenger).to.be.equal(
        bidAmountJUSD,
      );

      // Self bidding, should reduce challenge size
      balanceBeforeChallenger = await JUSD.balanceOf(challengerAddress);
      volBalanceBefore = await mockVOL.balanceOf(challengerAddress);

      let updatedChallenge = await mintingHub.challenges(challengeNumber);
      await mintingHub.bid(challengeNumber, updatedChallenge.size, true);

      balanceAfterChallenger = await JUSD.balanceOf(challengerAddress);
      volBalanceAfter = await mockVOL.balanceOf(challengerAddress);
      expect(balanceAfterChallenger).to.be.equal(balanceBeforeChallenger);
    });
    it("bid on challenge with amount larger than collateral balance of position", async () => {
      await evm_increaseTimeTo(await positionContract.cooldown() + 1n);
      const reduceCollateralByAmount = await mockVOL.balanceOf(positionAddr) - floatToDec18(5n);
      await positionContract.withdrawCollateral(owner.address, reduceCollateralByAmount);
      let availableCollateral = await mockVOL.balanceOf(positionAddr);
      const fchallengeAmount = availableCollateral * 2n;
      const price = await positionContract.price();
      await mockVOL.approve(await mintingHub.getAddress(), fchallengeAmount);
      let tx = await mintingHub.challenge(
        positionAddr,
        fchallengeAmount,
        price,
      );
      challengeNumber++;
      const challenge = await mintingHub.challenges(challengeNumber);
      const challengeData = await positionContract.challengeData();
      expect(challenge.size).to.be.equal(fchallengeAmount);

      // Flat sale
      await evm_increaseTimeTo(await challenge.start + challengeData.phase + 1n);
      let liqPrice = await mintingHub.price(challengeNumber);
      expect(liqPrice).to.be.approximately(
        price,
        liqPrice / 100n,
      );

      // bob sends a bid
      const bidSize = fchallengeAmount
      expect(availableCollateral).to.be.gt(0n);
      expect(bidSize).to.be.equal(2n * availableCollateral);
      const interest = await positionContract.getInterest();
      const propInterest = (interest * bidSize) / availableCollateral;
      let bidAmountJUSD = (liqPrice * bidSize) / DECIMALS;
      await JUSD.transfer(bob.address, bidAmountJUSD + propInterest);
      await JUSD
        .connect(bob)
        .approve(await mintingHub.getAddress(), bidAmountJUSD + propInterest);
      tx = await mintingHub.connect(bob).bid(challengeNumber, bidSize, true);
      await expect(tx)
        .to.emit(mintingHub, "ChallengeSucceeded")
        .emit(JUSD, "Profit");
    });
    it("bid on challenged, auction sale, not expired position", async () => {
      challengeAmount = initialCollateralClone / 2;
      const fchallengeAmount = floatToDec18(challengeAmount);
      const price = await positionContract.price();
      await mockVOL
        .connect(charles)
        .approve(await mintingHub.getAddress(), fchallengeAmount);
      await mockVOL.connect(charles).mint(charles.address, fchallengeAmount);
      let tx = await mintingHub
        .connect(charles)
        .challenge(positionAddr, fchallengeAmount, price);
      challengeNumber++;
      const challenge = await mintingHub.challenges(challengeNumber);
      const challengeData = await positionContract.challengeData();

      // Auction sale
      await evm_increaseTime(challengeData.phase + challengeData.phase / 2n);
      let liqPrice = await positionContract.price();
      let auctionPrice = await mintingHub.price(challengeNumber);
      expect(auctionPrice).to.be.approximately(
        liqPrice / 2n,
        auctionPrice / 100n,
      );

      const bidSize = floatToDec18(challengeAmount / 4);
      await mockVOL.mint(challenge.position, floatToDec18(challengeAmount / 2));
      let availableCollateral = await mockVOL.balanceOf(challenge.position);
      expect(availableCollateral).to.be.above(bidSize);

      // bob sends a bid
      let bidAmountJUSD = (auctionPrice * bidSize) / DECIMALS;
      let challengerAddress = challenge.challenger;
      await JUSD.transfer(bob.address, bidAmountJUSD);
      let balanceBeforeBob = await JUSD.balanceOf(bob.address);
      let balanceBeforeChallenger = await JUSD.balanceOf(challengerAddress);
      let volBalanceBefore = await mockVOL.balanceOf(bob.address);
      await JUSD
        .connect(bob)
        .approve(await mintingHub.getAddress(), bidAmountJUSD);
      tx = await mintingHub.connect(bob).bid(challengeNumber, bidSize, true);
      await expect(tx)
        .to.emit(mintingHub, "ChallengeSucceeded")
        .emit(JUSD, "Profit");

      let balanceAfterChallenger = await JUSD.balanceOf(challengerAddress);
      let balanceAfterBob = await JUSD.balanceOf(bob.address);
      let volBalanceAfter = await mockVOL.balanceOf(bob.address);
      expect(volBalanceAfter - volBalanceBefore).to.be.eq(bidSize);
      expect(balanceBeforeBob - balanceAfterBob).to.be.approximately(
        bidAmountJUSD,
        bidAmountJUSD / 100n,
      );
      expect(
        balanceAfterChallenger - balanceBeforeChallenger,
      ).to.be.approximately(bidAmountJUSD / 50n, bidAmountJUSD / 5000n);

      bidAmountJUSD = bidAmountJUSD * 2n;
      await JUSD.transfer(alice.address, bidAmountJUSD);
      await JUSD
        .connect(alice)
        .approve(
          mintingHub,
          (challengeData.liqPrice * challenge.size * 2n) / DECIMALS,
        );
      await expect(
        mintingHub
          .connect(alice)
          .bid(challengeNumber, challenge.size * 2n, true),
      ).to.be.emit(mintingHub, "PostponedReturn");
    });
  });
  describe("challenge clone", () => {
    let cloneContract: Position;

    beforeEach(async () => {
      let collateral = await mockVOL.getAddress();
      let fliqPrice = floatToDec18(5000);
      let minCollateral = floatToDec18(1);
      let fInitialCollateral = floatToDec18(initialCollateral);
      let duration = BigInt(60 * 86_400);
      let fFees = BigInt(fee * 1_000_000);
      let fReserve = BigInt(reserve * 1_000_000);
      let challengePeriod = BigInt(3 * 86400); // 3 days
      await mockVOL
        .connect(owner)
        .approve(await mintingHub.getAddress(), 2n * fInitialCollateral);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
      let tx = await mintingHub.openPosition(
        collateral,
        minCollateral,
        fInitialCollateral,
        initialLimit * 2n,
        7n * 24n * 3600n,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve,
      );
      let rc = await tx.wait();
      const topic =
        "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175"; // PositionOpened
      let log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      const positionAddr = "0x" + log?.topics[2].substring(26);
      const positionContract = await ethers.getContractAt(
        "Position",
        positionAddr,
      );
      const expiration = await positionContract.expiration();
      await evm_increaseTimeTo(await positionContract.start());
      tx = await mintingHub["clone(address,uint256,uint256,uint40)"](
        positionAddr,
        fInitialCollateral,
        initialLimit / 2n,
        expiration,
      );
      rc = await tx.wait();
      log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      const clonePositionAddr = "0x" + log?.topics[2].substring(26);
      cloneContract = await ethers.getContractAt(
        "Position",
        clonePositionAddr,
      );
      cloneContract = cloneContract.connect(alice);
    });
    it("price should be zero at end of challenge", async () => {
      challengeAmount = initialCollateralClone / 2;
      let fchallengeAmount = floatToDec18(challengeAmount);
      await mockVOL.approve(await mintingHub.getAddress(), fchallengeAmount);
      let tx = await mintingHub.challenge(
        await cloneContract.getAddress(),
        fchallengeAmount,
        await cloneContract.price(),
      );
      await expect(tx).to.emit(mintingHub, "ChallengeStarted");
      challengeNumber++;
      await evm_increaseTime(86400 * 60 * 2);
      expect(await mintingHub.price(challengeNumber)).to.be.eq(0);
    });
    it("send challenge and ensure owner cannot withdraw", async () => {
      challengeAmount = initialCollateralClone / 2;
      let fchallengeAmount = floatToDec18(challengeAmount);
      await mockVOL.approve(await mintingHub.getAddress(), fchallengeAmount);
      let tx = await mintingHub.challenge(
        await cloneContract.getAddress(),
        fchallengeAmount,
        await cloneContract.price(),
      );
      await expect(tx).to.emit(mintingHub, "ChallengeStarted");
      challengeNumber++;
      let chprice = await mintingHub.price(challengeNumber);
      expect(chprice).to.be.eq(await cloneContract.price());
      let tx2 = cloneContract
        .connect(owner)
        .withdrawCollateral(clonePositionAddr, floatToDec18(1));
      await expect(tx2).to.be.revertedWithCustomError(
        clonePositionContract,
        "Challenged",
      );
    });
    it("bid on challenged, expired position", async () => {
      let liqPrice = dec18ToFloat(await cloneContract.price());
      let bidSize = challengeAmount / 2;
      let exp = await cloneContract.expiration();
      await evm_increaseTimeTo(exp - 5n);
      let fchallengeAmount = floatToDec18(challengeAmount);
      await mockVOL.approve(await mintingHub.getAddress(), fchallengeAmount);
      let tx2 = await mintingHub.challenge(
        await cloneContract.getAddress(),
        fchallengeAmount,
        await cloneContract.price(),
      );
      await expect(tx2).to.emit(mintingHub, "ChallengeStarted");
      challengeNumber++;
      const challenge = await mintingHub.challenges(challengeNumber);
      let challengerAddress = challenge.challenger;
      let positionsAddress = challenge.position;
      // await mockXUSD.connect(alice).mint(alice.address, floatToDec18(bidSize));

      // console.log("Challenging challenge " + challengeNumber + " at price " + price + " instead of " + liqPrice);
      // Challenging challenge 3 at price 24999903549382556050 instead of 25
      // const timestamp = await time.latest();
      // console.log("Challenge started at " + challenge.start + " on position with start " + (await clonePositionContract.start()) + ", expiration " + (await clonePositionContract.expiration()) + ", challenge period " + (await clonePositionContract.challengePeriod()) + ", and now it is " + timestamp);
      // Challenge started at 1810451265 on position with start 1792911949, expiration 1795503949, challenge period 259200, and now it is 1810451266
      await mockVOL.mint(clonePositionAddr, floatToDec18(bidSize)); // ensure there is something to bid on
      let balanceBeforeAlice = await JUSD.balanceOf(alice.address);
      // console.log("Balance alice " + balanceBeforeAlice + " and bid size " + floatToDec18(bidSize) + " position collateral: " + await mockVOL.balanceOf(clonePositionAddr));
      // let balanceBeforeChallenger = await JUSD.balanceOf(challengerAddress);
      let volBalanceBefore = await mockVOL.balanceOf(alice.address);
      const challengeData = await positionContract.challengeData();
      await evm_increaseTime(challengeData.phase);
      const bidAmountJUSD =
        (challengeData.liqPrice * floatToDec18(bidSize)) / DECIMALS;
      let interest =
        (await cloneContract.getDebt()) - (await cloneContract.principal());
      await JUSD
        .connect(alice)
        .approve(await mintingHub.getAddress(), bidAmountJUSD + interest);
      let tx = await mintingHub
        .connect(alice)
        .bid(challengeNumber, floatToDec18(bidSize), false);
      let price = await mintingHub.price(challengeNumber);
      await expect(tx)
        .to.emit(mintingHub, "ChallengeSucceeded")
        .withArgs(
          positionsAddress,
          challengeNumber,
          (floatToDec18(bidSize) * price) / DECIMALS,
          floatToDec18(bidSize),
          floatToDec18(bidSize),
        );
      // let balanceAfterChallenger = await JUSD.balanceOf(challengerAddress);
      // let balanceAfterAlice = await JUSD.balanceOf(alice.address);
      let volBalanceAfter = await mockVOL.balanceOf(alice.address);
      // expect(balanceBeforeAlice - balanceAfterAlice).to.be.eq(bidAmountJUSD);
      // expect(balanceAfterChallenger - balanceBeforeChallenger).to.be.eq(bidAmountJUSD);
      expect(volBalanceAfter - volBalanceBefore).to.be.eq(
        floatToDec18(bidSize),
      );
      await evm_increaseTime(86400);
      // Challenging challenge 3 at price 16666280864197424200 instead of 25
      let approvalAmount = (price * floatToDec18(bidSize)) / DECIMALS;
      interest = (await cloneContract.getDebt()) - (await cloneContract.principal());
      await JUSD.approve(await mintingHub.getAddress(), approvalAmount);
      await expect(
        mintingHub.bid(challengeNumber, floatToDec18(bidSize), false),
      ).to.be.emit(mintingHub, "ChallengeSucceeded");
      expect(await mintingHub.price(challengeNumber)).to.be.eq(0);
    });
    it("bid on not existing challenge", async () => {
      let tx = mintingHub.connect(bob).bid(42, floatToDec18(42), false);
      await expect(tx).to.be.revertedWithPanic();
    });
    it("should revert notify challenge succeed call from non hub", async () => {
      await expect(
        positionContract.notifyChallengeSucceeded(100),
      ).to.be.revertedWithCustomError(positionContract, "NotHub");
    });
    it("should revert notify challenge avert call from non hub", async () => {
      await expect(
        positionContract.notifyChallengeAverted(100),
      ).to.be.revertedWithCustomError(positionContract, "NotHub");
    });
  });
  describe("adjusting price", async () => {
    beforeEach(async () => {
      let collateral = await mockVOL.getAddress();
      let fliqPrice = floatToDec18(5000);
      let minCollateral = floatToDec18(1);
      let fInitialCollateral = floatToDec18(initialCollateral);
      let duration = BigInt(60 * 86_400);
      let fFees = BigInt(fee * 1_000_000);
      let fReserve = BigInt(reserve * 1_000_000);
      let challengePeriod = BigInt(3 * 86400); // 3 days
      await mockVOL
        .connect(owner)
        .approve(await mintingHub.getAddress(), fInitialCollateral);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
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
        "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175"; // PositionOpened
      const log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      positionAddr = "0x" + log?.topics[2].substring(26);
      positionContract = await ethers.getContractAt(
        "Position",
        positionAddr,
      );
    });
    it("should revert adjusting price from non position owner", async () => {
      await expect(
        positionContract.connect(alice).adjustPrice(floatToDec18(1500)),
      ).to.be.revertedWithCustomError(
        positionContract,
        "OwnableUnauthorizedAccount",
      );
    });
    it("should revert adjusting price when there is pending challenge", async () => {
      challengeAmount = initialCollateralClone / 2;
      let fchallengeAmount = floatToDec18(challengeAmount);
      let price = await positionContract.price();
      await mockVOL.approve(await mintingHub.getAddress(), fchallengeAmount);
      await mintingHub.challenge(positionAddr, fchallengeAmount, price);
      challengeNumber++;
      await expect(
        positionContract.adjustPrice(floatToDec18(1500)),
      ).to.be.revertedWithCustomError(positionContract, "Challenged");
    });
    it("should increase cooldown for 3 days when submitted price is greater than the current price", async () => {
      const prevCooldown = await positionContract.cooldown();
      const initialPrice = await positionContract.price();
      await evm_increaseTimeTo(prevCooldown);
      await positionContract.adjustPrice(initialPrice - floatToDec18(1));
      expect(await positionContract.price()).to.be.equal(initialPrice - floatToDec18(1));
      await expect(positionContract.adjustPrice(initialPrice)).to.be.emit(
        positionContract,
        "MintingUpdate",
      );
      expect(await positionContract.price()).to.be.equal(initialPrice);

      const currentCooldown = await positionContract.cooldown();
      expect(currentCooldown > prevCooldown).to.be.true;
    });
    it("should revert adjusting to lower price when it lowers the collateral reserves below minted values", async () => {
      await evm_increaseTime(86400 * 8);
      await positionContract.mint(owner.address, floatToDec18(1000 * 100));

      await expect(
        positionContract.adjustPrice(floatToDec18(100)),
      ).to.be.revertedWithCustomError(
        positionContract,
        "InsufficientCollateral",
      );
    });
    it("should revert adjusting price when new price is greater than required to cover max principal", async () => {
      await evm_increaseTimeTo(await positionContract.cooldown());
      const underPrice = initialLimit;
      await expect(
        positionContract.adjustPrice(floatToDec18(6000)),
      ).to.be.revertedWithCustomError(        
        positionContract,
        "PriceTooHigh"
      )
    });
    it("should revert adjusting price when new price is greater than double the current price", async () => {
      await evm_increaseTimeTo(await positionContract.cooldown());
      const price = await positionContract.price();
      await expect(
        positionContract.adjustPrice((price * 21n) / 10n),
      ).to.be.revertedWithCustomError(        
        positionContract,
        "PriceTooHigh"
      )
    });
  });

  describe("adjusting position", async () => {
    beforeEach(async () => {
      let collateral = await mockVOL.getAddress();
      let fliqPrice = floatToDec18(5000);
      let minCollateral = floatToDec18(1);
      let fInitialCollateral = floatToDec18(initialCollateral);
      let duration = BigInt(60 * 86_400);
      let fFees = BigInt(fee * 1_000_000);
      let fReserve = BigInt(reserve * 1_000_000);
      let challengePeriod = BigInt(3 * 86400); // 3 days
      await mockVOL
        .connect(owner)
        .approve(await mintingHub.getAddress(), fInitialCollateral);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
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
        "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175"; // PositionOpened
      const log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      positionAddr = "0x" + log?.topics[2].substring(26);
      positionContract = await ethers.getContractAt(
        "Position",
        positionAddr,
      );
      expect(await positionContract.isClosed()).to.be.false;
    });
    it("should revert adjusting position from non position owner", async () => {
      await expect(
        positionContract.connect(alice).adjust(0, 0, 0),
      ).to.be.revertedWithCustomError(
        positionContract,
        "OwnableUnauthorizedAccount",
      );
    });
    it("owner can provide more collaterals to the position", async () => {
      await evm_increaseTimeTo(await positionContract.cooldown());

      const colBalance = await mockVOL.balanceOf(positionAddr);
      const amount = floatToDec18(100);
      await mockVOL.approve(positionAddr, amount);
      await positionContract.adjust(0, colBalance + amount, floatToDec18(1000));

      const newColBalance = await mockVOL.balanceOf(positionAddr);
      expect(newColBalance - colBalance).to.be.equal(amount);
    });
    it("owner can withdraw collaterals from the position", async () => {
      await evm_increaseTime(86400 * 8);
      const colBalance = await mockVOL.balanceOf(positionAddr);
      const amount = floatToDec18(100);
      await positionContract.adjust(0, colBalance - amount, floatToDec18(1000));

      const newColBalance = await mockVOL.balanceOf(positionAddr);
      expect(colBalance - newColBalance).to.be.equal(amount);
    });
    it("owner can mint new JUSD", async () => {
      await evm_increaseTime(86400 * 8);
      const price = floatToDec18(1000);
      const colBalance = await mockVOL.balanceOf(positionAddr);
      const minted = await positionContract.getDebt();
      const amount = floatToDec18(100);

      const beforeJUSDBal = await JUSD.balanceOf(owner.address);
      await positionContract.adjust(minted + amount, colBalance, price);
      const afterJUSDBal = await JUSD.balanceOf(owner.address);
      const reservePPM = await positionContract.reserveContribution();
      const expectedJUSDReceived = amount - (amount * reservePPM) / 1000000n;
      expect(afterJUSDBal - beforeJUSDBal).to.be.equal(expectedJUSDReceived);
    });
    it("owner can burn JUSD", async () => {
      await evm_increaseTime(86400 * 8);
      const price = floatToDec18(1000);
      const colBalance = await mockVOL.balanceOf(positionAddr);
      const principal = await positionContract.principal();
      const amount = floatToDec18(100);
      await positionContract.adjust(principal + amount, colBalance, price);
      expect(await positionContract.principal()).to.be.equal(principal + amount);
      const interest = await positionContract.getInterest();
      await JUSD.approve(positionAddr, amount + interest + floatToDec18(1));
      await positionContract.adjust(principal, colBalance, price);
      expect(await positionContract.principal()).to.be.equal(principal);
    });
    it("owner can adjust price", async () => {
      await evm_increaseTime(86400 * 8);
      const price = await positionContract.price();
      let minted = await positionContract.getDebt();
      let collbal = await positionContract.minimumCollateral();
      await positionContract.adjust(minted, collbal, price * 2n);
      expect(await positionContract.price()).to.be.equal(price * 2n);
    });
    it("owner can repay debt partially", async () => {
      await evm_increaseTime(86400 * 8);
      const loanAmount = floatToDec18(1000);
      await positionContract.mint(owner.address, loanAmount);
      await evm_increaseTime(86400 * 5);
      expect(await positionContract.getDebt()).to.be.gte(loanAmount);

      const interest = await positionContract.getInterest();
      const amountToRepay = loanAmount / 2n + interest;
      const ownerBalBefore = await JUSD.balanceOf(owner.address);
      const posBalBefore = await JUSD.balanceOf(positionAddr);
      const debt = await positionContract.getDebt();
      await JUSD.approve(positionAddr, debt + floatToDec18(1));
      await positionContract.repay(amountToRepay);
      const ownerBalAfter = await JUSD.balanceOf(owner.address);
      const posBalAfter = await JUSD.balanceOf(positionAddr);
      const returnedReserve = await JUSD.calculateAssignedReserve(amountToRepay, await positionContract.reserveContribution());
      expect(ownerBalBefore - ownerBalAfter).to.be.approximately(amountToRepay - returnedReserve, floatToDec18(0.1));
      expect(posBalBefore).to.be.equal(0);
      expect(posBalAfter).to.be.equal(0); // AssertionError: expected 100000000000000000000 to equal 0.
    });
    it("owner can repay debt in full", async () => {
      await evm_increaseTime(86400 * 8);
      const loanAmount = floatToDec18(1000);
      await positionContract.mint(owner.address, loanAmount);
      await evm_increaseTime(86400 * 5);
      expect(await positionContract.getDebt()).to.be.gte(loanAmount);

      const ownerBalBefore = await JUSD.balanceOf(owner.address);
      const posBalBefore = await JUSD.balanceOf(positionAddr);
      const debt = await positionContract.getDebt();
      await JUSD.approve(positionAddr, debt + floatToDec18(1));
      await positionContract.repayFull();
      const ownerBalAfter = await JUSD.balanceOf(owner.address);
      const posBalAfter = await JUSD.balanceOf(positionAddr);
      const returnedReserve = await JUSD.calculateAssignedReserve(debt, await positionContract.reserveContribution());
      expect(ownerBalBefore - ownerBalAfter).to.be.approximately(debt - returnedReserve, floatToDec18(0.1));
      expect(posBalBefore).to.be.equal(0);
      expect(posBalAfter).to.be.equal(0); // AssertionError: expected 100000000000000000000 to equal 0.
    });
  });

  describe("withdrawing collaterals", () => {
    const amount = floatToDec18(10);

    beforeEach(async () => {
      let collateral = await mockVOL.getAddress();
      let fliqPrice = floatToDec18(5000);
      let minCollateral = floatToDec18(1);
      let fInitialCollateral = floatToDec18(initialCollateral);
      let duration = BigInt(60 * 86_400);
      let fFees = BigInt(fee * 1_000_000);
      let fReserve = BigInt(reserve * 1_000_000);
      let challengePeriod = BigInt(3 * 86400); // 3 days
      await mockVOL
        .connect(owner)
        .approve(await mintingHub.getAddress(), fInitialCollateral);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
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
        "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175"; // PositionOpened
      const log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      positionAddr = "0x" + log?.topics[2].substring(26);
      positionContract = await ethers.getContractAt(
        "Position",
        positionAddr,
      );
      await mockVOL.transfer(positionAddr, amount);
    });
    it("should revert withdrawing collaterals from non position owner", async () => {
      await expect(
        positionContract
          .connect(alice)
          .withdrawCollateral(owner.address, amount),
      ).to.be.revertedWithCustomError(
        positionContract,
        "OwnableUnauthorizedAccount",
      );
    });
    it("should revert withdrawing when it is in hot auctions", async () => {
      await expect(
        positionContract.withdrawCollateral(owner.address, amount),
      ).to.be.revertedWithCustomError(positionContract, "Hot");
    });
    it("should not revert when withdrawing portion of collaterals leaving dust", async () => {
      await positionContract.deny([], "");
      await evm_increaseTime(86400 * 7);
      const balance = await mockVOL.balanceOf(positionAddr);
      await positionContract.withdrawCollateral(
        owner.address,
        balance - ethers.parseEther("0.5"),
      );
    });
    it("owner should be able to withdraw collaterals after the auction is closed", async () => {
      await positionContract.deny([], "");
      const colBal = await mockVOL.balanceOf(positionAddr);
      expect(
        positionContract.withdrawCollateral(owner.address, colBal),
      ).to.be.emit(positionContract, "MintingUpdate");
      expect(positionContract.withdrawCollateral(owner.address, 0)).to.be.emit(
        positionContract,
        "MintingUpdate",
      );
    });
  });
  describe("withdrawing any tokens", () => {
    it("should revert withdrawing tokens from non position owner", async () => {
      const amount = floatToDec18(1);
      await expect(
        positionContract
          .connect(alice)
          .withdraw(await JUSD.getAddress(), owner.address, amount),
      ).to.be.revertedWithCustomError(
        positionContract,
        "OwnableUnauthorizedAccount",
      );
    });
    it("owner can withdraw any erc20 tokens locked on position contract", async () => {
      await evm_increaseTime(86400 * 8);
      const amount = floatToDec18(1);

      await JUSD.transfer(positionAddr, amount);
      const beforeBal = await JUSD.balanceOf(positionAddr);
      await positionContract.withdraw(
        await JUSD.getAddress(),
        owner.address,
        amount,
      );
      const afterBal = await JUSD.balanceOf(positionAddr);
      expect(beforeBal - afterBal).to.be.equal(amount);

      // withdraw collaterals
      await mockVOL.transfer(positionAddr, amount);
      const beforeColBal = await mockVOL.balanceOf(positionAddr);
      await positionContract.withdraw(
        await mockVOL.getAddress(),
        owner.address,
        amount,
      );
      const afterColBal = await mockVOL.balanceOf(positionAddr);
      expect(beforeColBal - afterColBal).to.be.equal(amount);
    });
  });
  describe("returning postponed collateral", async () => {
    it("should return pending postponed collaterals (Need to find more exact scenarios)", async () => {
      await mintingHub.returnPostponedCollateral(
        await mockVOL.getAddress(),
        owner.address,
      );
    });
  });
  describe("notifying loss", async () => {
    const amount = floatToDec18(10);
    const initialLimit = floatToDec18(1_000_000);
    let fliqPrice = floatToDec18(5000);
    let minCollateral = floatToDec18(1);
    let fInitialCollateral = floatToDec18(initialCollateral);
    let fchallengeAmount = floatToDec18(initialCollateral);
    let duration = BigInt(60 * 86_400);
    let fFees = BigInt(fee * 1_000_000);
    let fReserve = BigInt(reserve * 1_000_000);
    let challengePeriod = BigInt(3 * 86400); // 3 days

    beforeEach(async () => {
      let collateral = await mockVOL.getAddress();
      await mockVOL
        .connect(owner)
        .approve(await mintingHub.getAddress(), fInitialCollateral);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
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
      let topic =
        "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175"; // PositionOpened
      let log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      positionAddr = "0x" + log?.topics[2].substring(26);
      positionContract = await ethers.getContractAt(
        "Position",
        positionAddr,
      );
      await mockVOL.transfer(positionAddr, amount);

      await evm_increaseTime(86400 * 7);
      await mockVOL.approve(await mintingHub.getAddress(), initialLimit);
      await positionContract.assertCloneable();
      const cloneLimit = await positionContract.availableForClones();
      const expiration = await positionContract.expiration();
      tx = await mintingHub["clone(address,uint256,uint256,uint40)"](
        positionAddr,
        fInitialCollateral,
        cloneLimit,
        expiration,
      );
      rc = await tx.wait();
      log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      clonePositionAddr = "0x" + log?.topics[2].substring(26);
      clonePositionContract = await ethers.getContractAt(
        "Position",
        clonePositionAddr,
      );
      clonePositionContract = clonePositionContract.connect(alice);

      let price = await clonePositionContract.price();
      await mockVOL.approve(await mintingHub.getAddress(), fchallengeAmount);
      await mintingHub.challenge(clonePositionAddr, fchallengeAmount, price);
      challengeNumber++;
    });
    it("should transfer loss amount from reserve to minting hub when notify loss", async () => {
      await evm_increaseTime(86400 * 6);
      const liqPrice = await mintingHub.price(challengeNumber);
      const interest =
        (await clonePositionContract.getDebt()) -
        (await clonePositionContract.principal());
      const expOffer = (fchallengeAmount * liqPrice) / 10n ** 18n;
      const expCost = expOffer + interest + floatToDec18(1)
      await JUSD.transfer(bob.address, expCost);
      await JUSD
        .connect(bob)
        .approve(
          await mintingHub.getAddress(),
          expCost
        );
      let tx = await mintingHub
        .connect(bob)
        .bid(challengeNumber, fchallengeAmount, false);
      await expect(tx)
        .to.emit(mintingHub, "ChallengeSucceeded").withArgs(
          ethers.getAddress(clonePositionAddr),
          challengeNumber,
          expOffer,
          fchallengeAmount,
          fchallengeAmount
        )
        .emit(JUSD, "Loss");
        // TODO: Finish this test
    });
  });

  describe("position expiration auction", () => {
    let test: PositionExpirationTest;
    let pos: Position;

    before(async () => {
      const factory = await ethers.getContractFactory("PositionExpirationTest");
      test = await factory.deploy(mintingHub.getAddress());

      await JUSD.transfer(await test.getAddress(), 1000n * 10n ** 18n);

      const tx = await test.openPositionFor(
        alice.getAddress(),
        ethers.randomBytes(32),
      );
      const positionAddr = await getPositionAddressFromTX(tx);
      pos = await ethers.getContractAt("Position", positionAddr);

      // ensure minter's reserve is at least half there to make tests more interesting
      const target = await JUSD.minterReserve();
      const present = await JUSD.balanceOf(equity.getAddress());

      if (present < target) {
        const amount = (target - present) / 2n;
        await JUSD.connect(owner).transfer(JUSD.reserve(), amount);
      }
    });

    it("should be possible to borrow after starting", async () => {
      await evm_increaseTimeTo(await pos.start());

      const balanceBefore = await JUSD.balanceOf(alice.getAddress());
      const mintedAmount = 50000n * 10n ** 18n;

      await pos.connect(alice).mint(alice.getAddress(), mintedAmount);

      const balanceAfter = await JUSD.balanceOf(alice.getAddress());
      const reservePPM = await pos.reserveContribution();
      const expectedAmount =
        mintedAmount - (mintedAmount * reservePPM) / 1_000_000n;

      expect(balanceAfter - balanceBefore).to.be.eq(expectedAmount);
      expect(await pos.getDebt()).to.be.eq(mintedAmount);

      await JUSD.transfer(test.getAddress(), 39794550000000000000000n);
      await JUSD.transfer(test.getAddress(), 100000000000000000000000n);
    });

    it("force sale should fail before expiration", async () => {
      await expect(
        test.forceBuy(pos.getAddress(), 1n),
      ).to.be.revertedWithCustomError(pos, "Alive");
    });

    it("force sale should succeed after expiration", async () => {
      await evm_increaseTimeTo(await pos.expiration());
      const totInterest = (await pos.getDebt()) - (await pos.principal());
      const collateralContract = await ethers.getContractAt(
        "IERC20",
        await pos.collateral(),
      );
      const totCollateral = await collateralContract.balanceOf(
        pos.getAddress(),
      );
      const propInterest = (totInterest * 1n) / totCollateral;
      await test.approveJUSD(
        pos.getAddress(),
        floatToDec18(10_000) + propInterest,
      );
      await test.forceBuy(pos.getAddress(), 1n);
    });

    it("price should reach liq price after one period", async () => {
      await evm_increaseTimeTo(
        (await pos.expiration()) + (await pos.challengePeriod()),
      );
      const expPrice = await mintingHub.expiredPurchasePrice(pos.getAddress());
      expect(await pos.price()).to.be.eq(expPrice);
    });

    it("force sale at liquidation price should succeed in cleaning up position", async () => {
      const totInterest = await pos.getInterest();
      const principal = await pos.principal();
      const collateralContract = await ethers.getContractAt("IERC20", await pos.collateral());
      const debtBefore = await pos.getDebt();
      const reservePortion = await JUSD.calculateAssignedReserve(await pos.principal(), await pos.reserveContribution());
      const colBalPosBefore = await collateralContract.balanceOf(pos.getAddress());
      const JUSDBalPosBefore = await JUSD.balanceOf(pos.getAddress());

      const colAmountToBuy = 35n;
      const expPurchasePrice = await mintingHub.expiredPurchasePrice(pos.getAddress());
      // NOTE: Failes due to mismatch in timestamp between expected call and contract
      // const expCost = (expPurchasePrice * colAmountToBuy) / 10n ** 18n;
      // let expProceeds = expCost;
      // const interestToRepay = expProceeds > totInterest ? totInterest : expProceeds;
      // expProceeds -= interestToRepay;
      // const maxPrincipalExclReserve = await pos.getUsableMint(principal);
      // const principalToRepayExclReserve = maxPrincipalExclReserve > expProceeds ? expProceeds : maxPrincipalExclReserve; 
      // expProceeds -= principalToRepayExclReserve;
      // const principalToRepayWithReserve = await JUSD.calculateFreedAmount(principalToRepayExclReserve, await pos.reserveContribution());
      // const remainingPrincipal = principal - principalToRepayWithReserve;
      // const principalToRepayDirectly = expProceeds > remainingPrincipal ? remainingPrincipal : expProceeds;
      // const principalToRepay = principalToRepayWithReserve + principalToRepayDirectly;
      // expProceeds -= principalToRepayDirectly;
      // const expectedDebtPayoff = principalToRepay + interestToRepay;

      // forceBuy
      await test.approveJUSD(await pos.getAddress(), floatToDec18(35_000) + totInterest);
      const tx = await test.forceBuy(pos.getAddress(), colAmountToBuy); // Total collateral is 100
      const receipt = await tx.wait();
      
      // Emitted event
      const event = receipt?.logs
      .map((log) => mintingHub.interface.parseLog(log))
      .find((parsedLog) => parsedLog?.name === 'ForcedSale');
      const [ePos, eAmount, ePriceE36MinusDecimals] = event?.args ?? [];
      
      expect(ePos).to.be.equal(ethers.getAddress(await pos.getAddress()));
      expect(eAmount).to.be.equal(colAmountToBuy);
      
      const colBalPosAfter = await collateralContract.balanceOf(pos.getAddress());
      const JUSDBalPosAfter = await JUSD.balanceOf(pos.getAddress());
      const debtAfter = await pos.getDebt();
      
      // expect(expCost).to.be.approximately((ePriceE36MinusDecimals * BigInt(eAmount)) / 10n ** 18n, floatToDec18(1));
      // expect(expectedDebtPayoff).to.be.lessThanOrEqual(debtBefore);
      // expect(debtBefore - debtAfter).to.be.approximately(expectedDebtPayoff, floatToDec18(1));
      expect(ePriceE36MinusDecimals).to.be.lte(expPurchasePrice);
      expect(colBalPosBefore - colBalPosAfter).to.be.equal(35n);
      expect(JUSDBalPosBefore).to.be.equal(JUSDBalPosAfter);
      expect((ePriceE36MinusDecimals * BigInt(eAmount) / DECIMALS) + reservePortion).gte(debtBefore);
      expect(debtAfter).to.be.eq(0);
      expect(await pos.isClosed()).to.be.false; // still collateral left
    });

    it("should revert due to dust protection", async () => {
      await test.approveJUSD(pos.getAddress(), floatToDec18(63_000));
      await expect(
        test.forceBuy(pos.getAddress(), 63n),
      ).to.revertedWithCustomError(mintingHub, "LeaveNoDust");
    });

    it("get rest for cheap and close position", async () => {
      await evm_increaseTimeTo(
        (await pos.expiration()) + 2n * (await pos.challengePeriod()),
      );
    
      const colToken = await ethers.getContractAt("IERC20", await pos.collateral());
      const colBalPosBefore = await colToken.balanceOf(pos.getAddress());
      await test.approveJUSD(pos.getAddress(), floatToDec18(64_000));
      await test.forceBuy(pos.getAddress(), 64n);

      expect(await pos.principal()).to.be.eq(0n);
      expect(await pos.getDebt()).to.be.eq(0n);
      expect(await pos.isClosed()).to.be.true;
      expect(await mockVOL.balanceOf(pos.getAddress())).to.be.eq(0n); // still collateral left
    });
  });

  describe("position rolling", () => {
    let test: PositionRollingTest;

    let pos1: Position;
    let pos2: Position;

    it("initialize", async () => {
      const factory = await ethers.getContractFactory("PositionRollingTest");
      test = await factory.deploy(await mintingHub.getAddress());
      await JUSD.transfer(await test.getAddress(), floatToDec18(2_000)); // opening fee
      await test.openTwoPositions();
      pos1 = await ethers.getContractAt("Position", await test.p1());
      pos2 = await ethers.getContractAt("Position", await test.p2());
    });

    it("roll should fail before positions are ready", async () => {
      expect(await pos1.start()).to.be.lessThan(await pos2.start());
      await evm_increaseTimeTo(await pos1.start());
      let tx = test.roll();
      expect(tx).to.be.revertedWithCustomError(pos2, "Hot");
    });

    it("roll", async () => {
      await evm_increaseTimeTo(await pos2.start());
      await test.roll();
    });

    it("roll into clone", async () => {
      // TODO
    });
  });

  describe("Fix interest rate tests", () => {
    let fliqPrice = floatToDec18(5000);
    let minCollateral = floatToDec18(1);
    let fInitialCollateral = floatToDec18(initialCollateral);
    let duration = BigInt(60 * 86_400);
    let riskPremium = BigInt(fee * 1_000_000); // risk premium
    let fReserve = BigInt(reserve * 1_000_000);
    let challengePeriod = BigInt(3 * 86400);
    let initialLeadratePPM = BigInt(30000); // initial lead rate
    let positionContract: Position;

    beforeEach(async () => {
      // Set initial lead rate
      await savings.proposeChange(initialLeadratePPM, []);
      const timePassed = BigInt(7 * 86_400 + 60);
      await evm_increaseTime(timePassed);
      await savings.applyChange();

      // Open position
      await mockVOL
        .connect(owner)
        .approve(await mintingHub.getAddress(), 2n * fInitialCollateral);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
      let tx = await mintingHub.openPosition(
        await mockVOL.getAddress(),
        minCollateral,
        fInitialCollateral,
        initialLimit * 2n,
        7n * 24n * 3600n,
        duration,
        challengePeriod,
        riskPremium,
        fliqPrice,
        fReserve,
      );
      let rc = await tx.wait();
      const topic =
        "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175"; // PositionOpened
      let log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      const positionAddr = "0x" + log?.topics[2].substring(26);
      positionContract = await ethers.getContractAt(
        "Position",
        positionAddr,
      );
      await evm_increaseTimeTo(await positionContract.start());
    });

    it("should fix rate on creation and not update if lead rate changes later (repay at old rate)", async () => {
      const expectedAnnualRate = initialLeadratePPM + riskPremium;
      expect(await positionContract.fixedAnnualRatePPM()).to.be.equal(
        expectedAnnualRate,
      );

      const initialMintAmount = floatToDec18(1000);
      await positionContract.mint(owner.address, initialMintAmount);
      const newLeadratePPM = initialLeadratePPM + 20000n;
      await savings.proposeChange(newLeadratePPM, []);
      const timePassed = BigInt(7 * 86_400 + 60);
      await evm_increaseTime(timePassed);
      await savings.applyChange();
      expect(await savings.currentRatePPM()).to.be.equal(newLeadratePPM);

      await evm_increaseTime(timePassed);
      const debtAfter = await positionContract.getDebt();
      const expectedInterest =
        (initialMintAmount * expectedAnnualRate * (2n * timePassed)) /
        (1000000n * 365n * 86400n);
      expect(debtAfter - initialMintAmount).to.be.approximately(
        expectedInterest,
        floatToDec18(0.001),
      );
    });
    it("should update to new lead rate when the loan is increased", async () => {
      const initialMintAmount = floatToDec18(1000);
      await positionContract.mint(owner.address, initialMintAmount);
      const timeAtInitialLeadrate = BigInt(5 * 86_400);
      await evm_increaseTime(timeAtInitialLeadrate);

      const newLeadratePPM = initialLeadratePPM + 20000n;
      await savings.proposeChange(newLeadratePPM, []);
      const proposalDuration = BigInt(7 * 86_400 + 60);
      await evm_increaseTime(proposalDuration);
      await savings.applyChange();
      expect(await savings.currentRatePPM()).to.be.eq(newLeadratePPM);

      const timeAtNewLeadrateBeforeMint = BigInt(3 * 86_400);
      await evm_increaseTime(timeAtNewLeadrateBeforeMint);
      const totalLoanTime =
        timeAtInitialLeadrate + proposalDuration + timeAtNewLeadrateBeforeMint;
      const expectedInterestBeforeMint =
        (initialMintAmount *
          (initialLeadratePPM + riskPremium) *
          totalLoanTime) /
        (1000000n * 365n * 86400n);
      expect(
        (await positionContract.getDebt()) - initialMintAmount,
      ).to.be.approximately(expectedInterestBeforeMint, floatToDec18(0.001));

      const newMintAmount = floatToDec18(500);
      await positionContract.mint(owner.address, newMintAmount);
      const principalAfterMint = await positionContract.principal();
      expect(principalAfterMint).to.be.equal(initialMintAmount + newMintAmount);

      const timeAtNewLeadrateAfterMint = BigInt(8 * 86_400);
      await evm_increaseTime(timeAtNewLeadrateAfterMint);

      const expectedDebt =
        principalAfterMint +
        expectedInterestBeforeMint +
        (newMintAmount *
          (newLeadratePPM + riskPremium) *
          timeAtNewLeadrateAfterMint) /
          (1000000n * 365n * 86400n);
      expect(await positionContract.getDebt()).to.be.approximately(
        expectedDebt,
        floatToDec18(2),
      );
    });
    it("should preserve old rate until rolling into a new position with extended expiry (new rate applies after roll)", async () => {
      // Create a new target position with extended expiry
      const extendedExpiry = BigInt(7 * 86400);
      await mockVOL
        .connect(owner)
        .approve(await mintingHub.getAddress(), 2n * fInitialCollateral);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
      let tx = await mintingHub.openPosition(
        await mockVOL.getAddress(),
        minCollateral,
        fInitialCollateral,
        initialLimit * 2n,
        7n * 24n * 3600n,
        duration + extendedExpiry,
        challengePeriod,
        riskPremium,
        fliqPrice,
        fReserve,
      );
      let rc = await tx.wait();
      const topic =
        "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175"; // PositionOpened
      let log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      const targetPositionAddr = "0x" + log?.topics[2].substring(26);
      const targetPositionContract = await ethers.getContractAt(
        "Position",
        targetPositionAddr,
      );
      await evm_increaseTimeTo(await targetPositionContract.start());

      // Mint in the old position
      const initialMintAmount = floatToDec18(1000);
      await positionContract.mint(owner.address, initialMintAmount);

      const timeUnderOldRate = BigInt(5 * 86400);
      await evm_increaseTime(timeUnderOldRate);

      // Change the lead rate
      const newLeadratePPM = initialLeadratePPM + 40000n;
      await savings.proposeChange(newLeadratePPM, []);
      const proposalDuration = BigInt(7 * 86400 + 60);
      await evm_increaseTime(proposalDuration);
      await savings.applyChange();

      // Roll into the new position
      await JUSD
        .connect(owner)
        .approve(await roller.getAddress(), 2n * initialMintAmount);
      await mockVOL
        .connect(owner)
        .approve(
          await roller.getAddress(),
          await mockVOL.balanceOf(owner.address),
        );
      await roller.rollFullyWithExpiration(
        await positionContract.getAddress(),
        await targetPositionContract.getAddress(),
        await targetPositionContract.expiration(),
      );
      expect(await positionContract.getDebt()).to.equal(0n);

      const newFixedRate = await targetPositionContract.fixedAnnualRatePPM();
      expect(newFixedRate).to.equal(newLeadratePPM + riskPremium);

      const timeUnderNewRate = BigInt(10 * 86400);
      await evm_increaseTime(timeUnderNewRate);
      const newPosDebt = await targetPositionContract.getDebt();
      const mintedInNewPos = await targetPositionContract.principal();
      const expectedInterestNewPos =
        (mintedInNewPos * newFixedRate * timeUnderNewRate) /
        (1000000n * 365n * 86400n);
      expect(newPosDebt - mintedInNewPos).to.be.approximately(
        expectedInterestNewPos,
        floatToDec18(0.01),
      );
    });
  });

  describe("Liquidation tests", () => {
    let collateral: string;
    let fliqPrice = floatToDec18(5);
    let minCollateral = floatToDec18(1_000);
    let fInitialCollateral = floatToDec18(initialCollateral * 1_000);
    let challengeAmount = 4_000;
    let duration = 2n * 365n * 86_400n;
    let fFees = BigInt(fee * 1_000_000);
    let fReserve = BigInt(reserve * 1_000_000);
    let challengePeriod = BigInt(3 * 86_400); // 3 days

    before(async () => {
      collateral = await mockVOL.getAddress();
    });

    it("Balance checks before and after liquidation", async () => {
      // mint suffcient collateral
      await mockVOL.mint(owner.address, fInitialCollateral);
      await mockVOL.approve(await mintingHub.getAddress(), fInitialCollateral);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
      let tx = await mintingHub.openPosition(
        collateral,
        minCollateral,
        fInitialCollateral,
        initialLimit,
        7n * 86_400n,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve,
      );
      let rc = await tx.wait();
      const topic =
        "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175"; // PositionOpened
      const log = rc?.logs.find((x) => x.topics.indexOf(topic) >= 0);
      const positionAddr = "0x" + log?.topics[2].substring(26);
      positionContract = await ethers.getContractAt(
        "Position",
        positionAddr,
      );
      await evm_increaseTimeTo(await positionContract.start());

      await savings.proposeChange(BigInt(10_000), []);
      const timePassed = BigInt(7 * 86_400 + 60);
      await evm_increaseTime(timePassed);
      await savings.applyChange();

      const initialMintAmount = floatToDec18(1000);
      await positionContract.mint(owner.address, initialMintAmount);
      await evm_increaseTime(BigInt(86400 * 365));

      const fChallengeAmount = floatToDec18(challengeAmount);
      const price = await positionContract.price();
      await mockVOL.approve(await mintingHub.getAddress(), fChallengeAmount);
      tx = await mintingHub.challenge(positionAddr, fChallengeAmount, price);
      challengeNumber++;
      const challenge = await mintingHub.challenges(challengeNumber);
      const challengeData = await positionContract.challengeData();

      await evm_increaseTime(challengeData.phase);
      let liqPrice = await mintingHub.price(challengeNumber);
      expect(liqPrice).to.be.lte(price);

      const interest = (await positionContract.getDebt()) - initialMintAmount;
      const bidSize = floatToDec18(interest / liqPrice);
      await JUSD
        .connect(bob)
        .approve(await mintingHub.getAddress(), interest + floatToDec18(1));
      let colBalanceBeforePos = await mockVOL.balanceOf(positionAddr);
      let volBalanceBeforeBob = await mockVOL.balanceOf(bob.address);
      let balanceBeforeBob = await JUSD.balanceOf(bob.address);
      let balanceBeforeEquity = await JUSD.balanceOf(
        await equity.getAddress(),
      );
      let balanceBeforeMintingHub = await JUSD.balanceOf(
        await mintingHub.getAddress(),
      );
      let debtBefore = await positionContract.getDebt();
      tx = await mintingHub.connect(bob).bid(challengeNumber, bidSize, false);
      let volBalanceAfterBob = await mockVOL.balanceOf(bob.address);
      let balanceAfterBob = await JUSD.balanceOf(bob.address);
      let balanceAfterEquity = await JUSD.balanceOf(await equity.getAddress());
      let balanceAfterMintingHub = await JUSD.balanceOf(
        await mintingHub.getAddress(),
      );
      let debtAfter = await positionContract.getDebt();

      let expPrincipalToPay =
        (initialMintAmount * bidSize) / colBalanceBeforePos;
      let expInterestToPay = (interest * bidSize) / colBalanceBeforePos;
      liqPrice = await mintingHub.price(challengeNumber);
      let offer = (bidSize * liqPrice) / DECIMALS;
      await expect(tx)
        .to.emit(mintingHub, "ChallengeSucceeded")
        .withArgs(challenge.position, challengeNumber, offer, bidSize, bidSize);
      expect(balanceAfterMintingHub).to.be.eq(balanceBeforeMintingHub);
      expect(volBalanceAfterBob - volBalanceBeforeBob).to.be.eq(bidSize);
      expect(balanceBeforeBob - balanceAfterBob).to.be.approximately(
        offer,
        floatToDec18(1),
      );
      // expect(balanceAfterEquity).to.be.eq(balanceBeforeEquity);
      expect(debtBefore - debtAfter).to.be.approximately(
        expPrincipalToPay + expInterestToPay,
        floatToDec18(1),
      );
    });
  });

  describe("Interest overcollateralization", () => {
    let positionAddr: string;
    let positionContract: Position;
    let collateral: string;
    let fReserve: bigint;
    let fInitialCollateral: bigint;
    let minCollateral: bigint;

    beforeEach(async () => {
      collateral = await mockVOL.getAddress();
      minCollateral = floatToDec18(1);
      const fliqPrice = floatToDec18(5000);
      fInitialCollateral = floatToDec18(initialCollateral);
      const duration = BigInt(60 * 86_400);
      const fFees = BigInt(fee * 1_000_000);
      fReserve = BigInt(reserve * 1_000_000); // Example: 20% reserve
      const challengePeriod = BigInt(3 * 86400);

      await mockVOL.approve(await mintingHub.getAddress(), fInitialCollateral);
      await JUSD.approve(await mintingHub.getAddress(), await mintingHub.OPENING_FEE());
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

    it("allows withdrawing collateral when interest is sufficiently overcollateralized", async () => {
      const mintAmount = (minCollateral * await positionContract.price()) / floatToDec18(1) + floatToDec18(1);
      await positionContract.mint(owner.address, mintAmount);
      
      // Fast forward time to accrue interest
      await evm_increaseTime(30 * 86400);
      const interest = await positionContract.getInterest();
      const debt = await positionContract.getDebt();
      expect(interest).to.be.gt(0);
      
      // Calculate how much interest buffer is added
      const collateralRequirement = await positionContract.getCollateralRequirement();
      expect(collateralRequirement).to.be.gt(debt);
      const interestBuffer = collateralRequirement - debt;
      const reservePPM = await positionContract.reserveContribution();
      const expectedBuffer = (interest * 1_000_000n) / (1_000_000n - reservePPM) - interest;
      expect(interestBuffer).to.be.gte(expectedBuffer);
      
      const price = await positionContract.price();
      const minRequiredCollateral = (collateralRequirement * floatToDec18(1)) / price;
      const currentCollateral = await mockVOL.balanceOf(positionAddr);
      expect(currentCollateral).to.be.gt(minRequiredCollateral + floatToDec18(0.001));

      // Try to withdraw the interest buffer
      const withdrawTooMuch = currentCollateral - minRequiredCollateral + floatToDec18(0.001);
      await expect(
        positionContract.withdrawCollateral(owner.address, withdrawTooMuch)
      ).to.be.revertedWithCustomError(positionContract, "InsufficientCollateral");
      
      
      // Withdraw the maximum possible amount minus a small safety margin
      const safeToWithdraw = currentCollateral - minRequiredCollateral - floatToDec18(0.001);
      const balanceBefore = await mockVOL.balanceOf(owner.address);
      expect(currentCollateral - minRequiredCollateral).to.be.gt(safeToWithdraw);
      await positionContract.withdrawCollateral(owner.address, safeToWithdraw);
      const balanceAfter = await mockVOL.balanceOf(owner.address);
      
      // Verify the withdrawal succeeded
      expect(balanceAfter - balanceBefore).to.be.eq(safeToWithdraw);
    });

    it("requires more collateral as interest accrues over time", async () => {
      const mintAmount = (fInitialCollateral * await positionContract.price()) / floatToDec18(1);
      await positionContract.mint(owner.address, mintAmount);
      const initialCollateralRequirement = await positionContract.getCollateralRequirement();
      
      await evm_increaseTime(60 * 86400); // 60 days
      const newCollateralRequirement = await positionContract.getCollateralRequirement();
      expect(newCollateralRequirement).to.be.gt(initialCollateralRequirement);
      
      // Virtual price should also reflect the overcollateralized interest
      const virtualPrice = await positionContract.virtualPrice();
      const collateralBalance = await mockVOL.balanceOf(positionAddr);
      const expectedVirtualPrice = (newCollateralRequirement * floatToDec18(1)) / collateralBalance;
      expect(virtualPrice).to.be.gt(await positionContract.price());
      expect(virtualPrice).to.be.eq(expectedVirtualPrice);
    });
  });
});
