import { expect } from 'chai';
import { dec18ToFloat, DECIMALS, floatToDec18 } from '../../scripts/utils/math';
import { ethers } from 'hardhat';
import { evm_increaseTime, evm_increaseTimeTo } from '../utils';
import {
  JuiceDollar,
  Equity,
  FrontendGateway,
  MintingHubGateway,
  Position,
  PositionExpirationTest,
  PositionRoller,
  Savings,
  StablecoinBridge,
  TestToken,
} from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ContractTransactionResponse } from "ethers";

const weeks = 30;

const getPositionAddressFromTX = async (tx: ContractTransactionResponse): Promise<string> => {
  const PositionOpenedTopic = '0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175';
  const rc = await tx.wait();
  const log = rc?.logs.find((x) => x.topics.indexOf(PositionOpenedTopic) >= 0);
  return '0x' + log?.topics[2].substring(26);
};

describe('Minting Tests', () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let charles: HardhatEthersSigner;

  let JUSD: JuiceDollar;
  let mintingHub: MintingHubGateway;
  let bridge: StablecoinBridge;
  let savings: Savings;
  let roller: PositionRoller;
  let equity: Equity;
  let gateway: FrontendGateway;
  let mockVOL: TestToken;
  let mockXUSD: TestToken;

  let limit: bigint;

  before(async () => {
    [owner, alice, bob, charles] = await ethers.getSigners();
    // create contracts
    const JuiceDollarFactory = await ethers.getContractFactory('JuiceDollar');
    JUSD = await JuiceDollarFactory.deploy(10 * 86400);
    equity = await ethers.getContractAt('Equity', await JUSD.reserve());

    const gatewayFactoryFactory = await ethers.getContractFactory('FrontendGateway');
    gateway = await gatewayFactoryFactory.deploy(JUSD.getAddress());

    const positionFactoryFactory = await ethers.getContractFactory('PositionFactory');
    const positionFactory = await positionFactoryFactory.deploy();

    const savingsFactory = await ethers.getContractFactory('Savings');
    savings = await savingsFactory.deploy(JUSD.getAddress(), 0n);

    const rollerFactory = await ethers.getContractFactory('PositionRoller');
    roller = await rollerFactory.deploy(JUSD.getAddress());

    const mintingHubFactory = await ethers.getContractFactory('MintingHubGateway');
    mintingHub = await mintingHubFactory.deploy(
      JUSD.getAddress(),
      savings.getAddress(),
      roller.getAddress(),
      positionFactory.getAddress(),
      gateway.getAddress(),
    );

    await gateway.init('0x0000000000000000000000000000000000000000', mintingHub.getAddress());

    // mocktoken
    const testTokenFactory = await ethers.getContractFactory('TestToken');
    mockXUSD = await testTokenFactory.deploy('CryptoFranc', 'XUSD', 18);
    // mocktoken bridge to bootstrap
    limit = floatToDec18(1_000_000);
    const bridgeFactory = await ethers.getContractFactory('StablecoinBridge');
    bridge = await bridgeFactory.deploy(mockXUSD.getAddress(), JUSD.getAddress(), limit, weeks);
    await JUSD.initialize(bridge.getAddress(), 'XUSD Bridge');
    // create a minting hub too while we have no JUSD supply
    await JUSD.initialize(mintingHub.getAddress(), 'Minting Hub');
    await JUSD.initialize(savings.getAddress(), 'Savings');
    await JUSD.initialize(roller.getAddress(), 'Roller');

    // wait for 1 block
    await evm_increaseTime(60);
    // now we are ready to bootstrap JUSD with Mock-XUSD
    await mockXUSD.mint(owner.address, limit / 3n);
    await mockXUSD.mint(alice.address, limit / 3n);
    await mockXUSD.mint(bob.address, limit / 3n);
    // mint some JUSD to block bridges without veto
    let amount = floatToDec18(20_000);
    await mockXUSD.connect(alice).approve(bridge.getAddress(), amount);
    await bridge.connect(alice).mint(amount);
    await mockXUSD.connect(owner).approve(bridge.getAddress(), limit / 3n);
    await bridge.connect(owner).mint(limit / 3n); // owner should have plenty
    await mockXUSD.connect(bob).approve(bridge.getAddress(), amount);
    await bridge.connect(bob).mint(amount);
    // vol tokens
    mockVOL = await testTokenFactory.deploy('Volatile Token', 'VOL', 18);
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

  describe('Use Minting Hub', () => {
    let collateral: string;
    let fliqPrice = floatToDec18(5000);
    let minCollateral = floatToDec18(1);
    let fInitialCollateral = floatToDec18(initialCollateral);
    let duration = 60n * 86_400n;
    let fFees = BigInt(fee * 1_000_000);
    let fReserve = BigInt(reserve * 1_000_000);
    let challengePeriod = BigInt(3 * 86400); // 3 days
    let frontendCode = ethers.randomBytes(32);

    before(async () => {
      collateral = await mockVOL.getAddress();
    });

    it('create position', async () => {
      const openingFeeJUSD = await mintingHub.OPENING_FEE();
      await mockVOL.approve(mintingHub.getAddress(), fInitialCollateral);
      const balBefore = await JUSD.balanceOf(owner.address);
      const balBeforeVOL = await mockVOL.balanceOf(owner.address);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
      const tx = await mintingHub[
        'openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24,bytes32)'
      ](
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
        frontendCode,
      );
      positionAddr = await getPositionAddressFromTX(tx);
      positionContract = await ethers.getContractAt('Position', positionAddr);
      const balAfter = await JUSD.balanceOf(owner.address);
      const balAfterVOL = await mockVOL.balanceOf(owner.address);
      const dJUSD = dec18ToFloat(balAfter - balBefore);
      const dVOL = dec18ToFloat(balAfterVOL - balBeforeVOL);
      expect(dVOL).to.be.equal(-initialCollateral);
      expect(dJUSD).to.be.equal(-dec18ToFloat(openingFeeJUSD));
    });
    it('should revert minting when there is a challange', async () => {
      await mockVOL.approve(mintingHub.getAddress(), fInitialCollateral);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
      const tx = await mintingHub[
        'openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24,bytes32)'
      ](
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
        frontendCode,
      );
      const positionAddr = await getPositionAddressFromTX(tx);
      const positionContract = await ethers.getContractAt('Position', positionAddr);
      challengeAmount = initialCollateralClone / 2;
      const fchallengeAmount = floatToDec18(challengeAmount);
      const price = await positionContract.price();
      await mockVOL.approve(mintingHub.getAddress(), fchallengeAmount);
      await mintingHub.challenge(positionContract.getAddress(), fchallengeAmount, price);
      await expect(positionContract.mint(owner.address, floatToDec18(10))).to.be.revertedWithCustomError(
        positionContract,
        'Challenged',
      );
    });
    it('try clone after 7 days but before collateral was withdrawn', async () => {
      // "wait" 7 days...
      await evm_increaseTime(7 * 86_400 + 60);

      const fInitialCollateralClone = floatToDec18(initialCollateralClone);
      const fJUSDAmount = floatToDec18(1000);
      // send some collateral and JUSD to the cloner
      await mockVOL.transfer(alice.address, fInitialCollateralClone);
      await JUSD.transfer(alice.address, fJUSDAmount);

      await mockVOL.connect(alice).approve(mintingHub.getAddress(), fInitialCollateralClone);
      fGlblZCHBalanceOfCloner = await JUSD.balanceOf(alice.address);

      const expiration = await positionContract.expiration();
      const availableLimit = await positionContract.availableForClones();
      expect(availableLimit).to.be.equal(0);
      const tx = mintingHub
        .connect(alice)
        [
          'clone(address,uint256,uint256,uint40,bytes32)'
        ](positionAddr, fInitialCollateralClone, fMintAmount, expiration, frontendCode);
      await expect(tx).to.be.revertedWithCustomError(positionContract, 'LimitExceeded');

      const colbal1 = await mockVOL.balanceOf(positionAddr);
      await positionContract.connect(owner).withdrawCollateral(owner.address, floatToDec18(100)); // make sure it works the next time
      const colbal2 = await mockVOL.balanceOf(positionAddr);
      expect(dec18ToFloat(colbal1)).to.be.equal(dec18ToFloat(colbal2) + 100n);
      const availableLimit2 = await positionContract.availableForMinting();
      expect(availableLimit2).to.be.greaterThan(availableLimit);
    });
    it('get loan', async () => {
      await evm_increaseTime(7 * 86_400); // 14 days passed in total

      fLimit = await positionContract.limit();
      limit = dec18ToFloat(fLimit);
      const amount = BigInt(1e18) * 10_000n;
      expect(amount).to.be.lessThan(fLimit);
      const targetAmount = BigInt(1e16) * 898548n;
      const totalMint = await positionContract.getMintAmount(targetAmount);
      const expectedAmount = await positionContract.getUsableMint(totalMint);
      for (let testTarget = 0n; testTarget < 100n; testTarget++) {
        // make sure these functions are not susceptible to rounding errors
        const testTotal = await positionContract.getMintAmount(targetAmount + testTarget);
        const testExpected = await positionContract.getUsableMint(testTotal);
        expect(testExpected).to.be.equal(targetAmount + testTarget);
      }

      expect(await positionContract.getUsableMint(amount)).to.be.equal(9000n * BigInt(1e18));

      const fJUSDBefore = await JUSD.balanceOf(owner.address);
      await positionContract.connect(owner).mint(owner.address, totalMint); //).to.emit("PositionOpened");
      const interest = await positionContract.getInterest();
      expect(interest).to.be.equal(0); // no interest yet

      const fJUSDAfter = await JUSD.balanceOf(owner.address);
      const JUSDMinted = fJUSDAfter - fJUSDBefore;
      expect(expectedAmount).to.be.equal(JUSDMinted);
    });
    it('clone position', async () => {
      const fInitialCollateralClone = floatToDec18(initialCollateralClone);
      fGlblZCHBalanceOfCloner = await JUSD.balanceOf(alice.address);

      const start = await positionContract.start();
      const expiration = await positionContract.expiration();
      const duration = (expiration - start) / 2n;
      const newExpiration = expiration - duration;
      const tx = await mintingHub
        .connect(alice)
        [
          'clone(address,uint256,uint256,uint40,bytes32)'
        ](positionAddr, fInitialCollateralClone, fMintAmount, newExpiration, frontendCode);
      clonePositionAddr = await getPositionAddressFromTX(tx);
      clonePositionContract = await ethers.getContractAt('Position', clonePositionAddr);
      clonePositionContract = clonePositionContract.connect(alice);
      await clonePositionContract.start();

      const newExpirationActual = await clonePositionContract.expiration();
      const newInterest = await clonePositionContract.getInterest();
      expect(newExpirationActual).to.be.equal(newExpiration);
      expect(newInterest).to.be.eq(0);
    });
    it('correct collateral', async () => {
      const col = await mockVOL.balanceOf(clonePositionAddr);
      expect(col).to.be.equal(floatToDec18(initialCollateralClone));
    });
    it('global mint limit V2024', async () => {
      const pgl = await positionContract.limit();
      const cgl = await clonePositionContract.limit();
      expect(pgl).to.be.equal(cgl);
    });

    it('global mint limit retained', async () => {
      const fLimit0 = await clonePositionContract.availableForMinting();
      const fLimit1 = await positionContract.availableForClones();
      if (fLimit0 != fLimit1) {
        console.log('new global limit =', fLimit0);
        console.log('original global limit =', fLimit1);
      }
      expect(fLimit0).to.be.equal(fLimit1);

      await expect(clonePositionContract.mint(owner.address, fLimit0 + 100n)).to.be.revertedWithCustomError(
        clonePositionContract,
        'LimitExceeded',
      );
    });
    it('correct fees charged', async () => {
      // fees:
      // - reserve contribution (temporary fee)
      // - yearlyInterestPPM
      // - position fee (or clone fee)
      const reserveContributionPPM =
        await clonePositionContract.reserveContribution();
      const yearlyInterestPPM = await clonePositionContract.fixedAnnualRatePPM();

      const fBalanceAfter = await JUSD.balanceOf(alice.address);
      const mintAfterFees =
        (BigInt(mintAmount) * (1000_000n - (28n * yearlyInterestPPM) / 365n - reserveContributionPPM)) / 1000_000n;
      const cloneFeeCharged = fBalanceAfter - fGlblZCHBalanceOfCloner - mintAfterFees * BigInt(1e18);
      expect(cloneFeeCharged).to.be.approximately(0, BigInt(1e18)); // no extra fees when cloning
    });
    it('clone position with too much mint', async () => {
      const fInitialCollateralClone = floatToDec18(initialCollateralClone);
      const fJUSDAmount = floatToDec18(1000);
      // send some collateral and JUSD to the cloner
      await mockVOL.mint(alice.address, fInitialCollateralClone * 1000n);
      await JUSD.transfer(alice.address, fJUSDAmount);

      const expiration = await positionContract.expiration();
      await mockVOL.connect(alice).approve(mintingHub.getAddress(), fInitialCollateralClone * 1000n);
      fGlblZCHBalanceOfCloner = await JUSD.balanceOf(alice.address);
      const available = await positionContract.availableForClones();

      const tx = mintingHub
        .connect(alice)
        [
          'clone(address,uint256,uint256,uint40,bytes32)'
        ](positionAddr, fInitialCollateralClone, available, expiration, frontendCode);
      await expect(tx).to.be.revertedWithCustomError(positionContract, 'InsufficientCollateral');

      const pendingTx = mintingHub
        .connect(alice)
        [
          'clone(address,uint256,uint256,uint40,bytes32)'
        ](positionAddr, fInitialCollateralClone * 1000n, initialLimit, expiration, frontendCode);
      await expect(pendingTx).to.be.revertedWithCustomError(positionContract, 'LimitExceeded');
    });
    it('repay position', async () => {
      const cloneOwner = await clonePositionContract.connect(alice).owner();
      expect(cloneOwner).to.be.equal(alice.address);
      const fInitialCollateralClone = floatToDec18(initialCollateralClone);
      const withdrawTx = clonePositionContract.withdrawCollateral(cloneOwner, fInitialCollateralClone);
      await expect(withdrawTx).to.be.revertedWithCustomError(clonePositionContract, 'InsufficientCollateral');

      expect(await gateway.referredPositions(clonePositionContract.getAddress())).to.be.equal(
        ethers.hexlify(frontendCode),
      );

      const principal = await clonePositionContract.principal();
      const minted = await clonePositionContract.getDebt();
      const reservePPM = await clonePositionContract.reserveContribution();
      const repayAmount = minted - (principal * reservePPM) / 1000000n;
      const reserve = await JUSD.calculateAssignedReserve(principal, reservePPM);
      expect(reserve + repayAmount).to.be.equal(minted);

      await JUSD.connect(alice).approve(clonePositionAddr, minted + floatToDec18(1));
      await clonePositionContract.repayFull();
      await clonePositionContract.withdrawCollateral(cloneOwner, fInitialCollateralClone);

      expect((await gateway.frontendCodes(frontendCode)).balance).to.be.greaterThan(0n);
      expect(await clonePositionContract.isClosed()).to.be.true;
    });
  });
  describe('denying position', () => {
    const frontendCode = ethers.randomBytes(32);

    it('create position', async () => {
      const fliqPrice = floatToDec18(5000);
      const minCollateral = floatToDec18(1);
      const fInitialCollateral = floatToDec18(initialCollateral);
      const duration = BigInt(60 * 86_400);
      const fFees = BigInt(fee * 1_000_000);
      const fReserve = BigInt(reserve * 1_000_000);
      const openingFeeJUSD = await mintingHub.OPENING_FEE();
      const challengePeriod = BigInt(3 * 86400); // 3 days
      await mockVOL.connect(owner).approve(mintingHub.getAddress(), fInitialCollateral);
      const balBefore = await JUSD.balanceOf(owner.address);
      const balBeforeVOL = await mockVOL.balanceOf(owner.address);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
      const tx = await mintingHub[
        'openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24,bytes32)'
      ](
        mockVOL.getAddress(),
        minCollateral,
        fInitialCollateral,
        initialLimit,
        7n * 24n * 3600n,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve,
        frontendCode,
      );
      positionAddr = await getPositionAddressFromTX(tx);
      const balAfter = await JUSD.balanceOf(owner.address);
      const balAfterVOL = await mockVOL.balanceOf(owner.address);
      const dJUSD = dec18ToFloat(balAfter - balBefore);
      const dVOL = dec18ToFloat(balAfterVOL - balBeforeVOL);
      expect(dVOL).to.be.equal(BigInt(-initialCollateral));
      expect(dJUSD).to.be.equal(-dec18ToFloat(openingFeeJUSD));
      positionContract = await ethers.getContractAt('Position', positionAddr);

      const interest = await positionContract.getInterest();
      expect(interest).to.be.equal(0);
    });
    it('deny challenge', async () => {
      expect(positionContract.deny([], '')).to.be.emit(positionContract, 'PositionDenied');
    });
    it('should revert denying challenge when challenge started', async () => {
      await evm_increaseTime(86400 * 8);
      await expect(positionContract.deny([], '')).to.be.revertedWithCustomError(positionContract, 'TooLate');
    });
  });
  describe('challenge active', () => {
    const frontendCode = ethers.randomBytes(32);

    it('create position', async () => {
      const fliqPrice = floatToDec18(5000);
      const minCollateral = floatToDec18(1);
      const fInitialCollateral = floatToDec18(initialCollateral);
      const duration = BigInt(60 * 86_400);
      const fFees = BigInt(fee * 1_000_000);
      const fReserve = BigInt(reserve * 1_000_000);
      const openingFeeJUSD = await mintingHub.OPENING_FEE();
      const challengePeriod = BigInt(3 * 86400); // 3 days
      await mockVOL.connect(owner).approve(mintingHub.getAddress(), fInitialCollateral);
      const balBefore = await JUSD.balanceOf(owner.address);
      const balBeforeVOL = await mockVOL.balanceOf(owner.address);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
      const tx = await mintingHub[
        'openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24,bytes32)'
      ](
        mockVOL.getAddress(),
        minCollateral,
        fInitialCollateral,
        initialLimit,
        7n * 24n * 3600n,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve,
        frontendCode,
      );
      positionAddr = await getPositionAddressFromTX(tx);
      const balAfter = await JUSD.balanceOf(owner.address);
      const balAfterVOL = await mockVOL.balanceOf(owner.address);
      const dJUSD = dec18ToFloat(balAfter - balBefore);
      const dVOL = dec18ToFloat(balAfterVOL - balBeforeVOL);
      expect(dVOL).to.be.equal(BigInt(-initialCollateral));
      expect(dJUSD).to.be.equal(-dec18ToFloat(openingFeeJUSD));
      positionContract = await ethers.getContractAt('Position', positionAddr);
    });
    it('bid on challenged, flat sale, not expired position', async () => {
      challengeAmount = initialCollateralClone / 2;
      const fchallengeAmount = floatToDec18(challengeAmount);
      const price = await positionContract.price();
      await mockVOL.approve(mintingHub.getAddress(), fchallengeAmount);
      await mintingHub.challenge(positionAddr, fchallengeAmount, price);

      challengeNumber++;
      const challenge = await mintingHub.challenges(challengeNumber);
      const challengerAddress = challenge.challenger;
      const challengeData = await positionContract.challengeData();

      // Flat sale
      await evm_increaseTime(challengeData.phase / 2n);
      const liqPrice = await mintingHub.price(challengeNumber);
      expect(liqPrice).to.be.equal(price);

      const bidSize = floatToDec18(challengeAmount / 4);
      const bidAmountJUSD = (liqPrice * bidSize) / DECIMALS;
      const balanceBeforeBob = await JUSD.balanceOf(bob.address);
      let balanceBeforeChallenger = await JUSD.balanceOf(challengerAddress);
      let volBalanceBefore = await mockVOL.balanceOf(bob.address);

      await JUSD
        .connect(bob)
        .approve(await mintingHub.getAddress(), bidAmountJUSD);
      const tx = await mintingHub
        .connect(bob)
        .bid(challengeNumber, bidSize, false);
      await expect(tx).to.emit(mintingHub, "ChallengeAverted");
      let balanceAfterChallenger = await JUSD.balanceOf(challengerAddress);
      let balanceAfterBob = await JUSD.balanceOf(bob.address);
      let volBalanceAfter = await mockVOL.balanceOf(bob.address);

      expect(volBalanceAfter - volBalanceBefore).to.be.equal(bidSize);
      expect(balanceBeforeBob - balanceAfterBob).to.be.equal(bidAmountJUSD);
      expect(balanceAfterChallenger - balanceBeforeChallenger).to.be.equal(bidAmountJUSD);

      // Self bidding, should reduce challenge size
      balanceBeforeChallenger = await JUSD.balanceOf(challengerAddress);

      const updatedChallenge = await mintingHub.challenges(challengeNumber);
      await mintingHub.bid(challengeNumber, updatedChallenge.size, true);

      balanceAfterChallenger = await JUSD.balanceOf(challengerAddress);
      expect(balanceAfterChallenger).to.be.equal(balanceBeforeChallenger);
    });
    it('bid on challenged, auction sale, not expired position', async () => {
      challengeAmount = initialCollateralClone / 2;
      const fchallengeAmount = floatToDec18(challengeAmount);
      const price = await positionContract.price();
      await mockVOL.connect(charles).approve(mintingHub.getAddress(), fchallengeAmount);
      await mockVOL.connect(charles).mint(charles.address, fchallengeAmount);
      await mintingHub.connect(charles).challenge(positionAddr, fchallengeAmount, price);
      challengeNumber++;
      const challenge = await mintingHub.challenges(challengeNumber);
      const challengeData = await positionContract.challengeData();

      // Auction sale
      await evm_increaseTime(challengeData.phase + challengeData.phase / 2n);
      const liqPrice = await positionContract.price();
      const auctionPrice = await mintingHub.price(challengeNumber);
      expect(auctionPrice).to.be.approximately(liqPrice / 2n, auctionPrice / 100n);

      const bidSize = floatToDec18(challengeAmount / 4);
      await mockVOL.mint(challenge.position, floatToDec18(challengeAmount / 2));
      const availableCollateral = await mockVOL.balanceOf(challenge.position);
      expect(availableCollateral).to.be.above(bidSize);

      // bob sends a bid
      let bidAmountJUSD = (auctionPrice * bidSize) / DECIMALS;
      const challengerAddress = challenge.challenger;
      await JUSD.transfer(bob.address, bidAmountJUSD);
      const balanceBeforeBob = await JUSD.balanceOf(bob.address);
      const balanceBeforeChallenger = await JUSD.balanceOf(challengerAddress);
      const volBalanceBefore = await mockVOL.balanceOf(bob.address);
      const interest = await positionContract.getInterest();
      const propInterest = (interest * bidSize) / availableCollateral;
      await JUSD
        .connect(bob)
        .approve(await mintingHub.getAddress(), bidAmountJUSD);
      const tx = await mintingHub
        .connect(bob)
        .bid(challengeNumber, bidSize, true);
      await expect(tx)
        .to.emit(mintingHub, "ChallengeSucceeded")
        .emit(JUSD, "Profit");

      const balanceAfterChallenger = await JUSD.balanceOf(challengerAddress);
      const balanceAfterBob = await JUSD.balanceOf(bob.address);
      const volBalanceAfter = await mockVOL.balanceOf(bob.address);
      expect(volBalanceAfter - volBalanceBefore).to.be.equal(bidSize);
      expect(balanceBeforeBob - balanceAfterBob).to.be.approximately(bidAmountJUSD, bidAmountJUSD / 100n);
      expect(balanceAfterChallenger - balanceBeforeChallenger).to.be.approximately(
        bidAmountJUSD / 50n,
        bidAmountJUSD / 5000n,
      );

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
  describe('challenge clone', () => {
    let cloneContract: Position;
    const frontendCode = ethers.randomBytes(32);

    beforeEach(async () => {
      const fliqPrice = floatToDec18(5000);
      const minCollateral = floatToDec18(1);
      const fInitialCollateral = floatToDec18(initialCollateral);
      const duration = BigInt(60 * 86_400);
      const fFees = BigInt(fee * 1_000_000);
      const fReserve = BigInt(reserve * 1_000_000);
      const challengePeriod = BigInt(3 * 86400); // 3 days
      await mockVOL.connect(owner).approve(mintingHub.getAddress(), 2n * fInitialCollateral);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
      let tx = await mintingHub[
        'openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24,bytes32)'
      ](
        mockVOL.getAddress(),
        minCollateral,
        fInitialCollateral,
        initialLimit * 2n,
        7n * 24n * 3600n,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve,
        frontendCode,
      );
      const positionAddr = await getPositionAddressFromTX(tx);
      const positionContract = await ethers.getContractAt('Position', positionAddr);
      const expiration = await positionContract.expiration();
      await evm_increaseTimeTo(await positionContract.start());
      tx = await mintingHub['clone(address,uint256,uint256,uint40,bytes32)'](
        positionAddr,
        fInitialCollateral,
        initialLimit / 2n,
        expiration,
        frontendCode,
      );
      const clonePositionAddr = await getPositionAddressFromTX(tx);
      cloneContract = await ethers.getContractAt('Position', clonePositionAddr);
      cloneContract = cloneContract.connect(alice);
    });
    it('price should be zero at end of challenge', async () => {
      challengeAmount = initialCollateralClone / 2;
      const fchallengeAmount = floatToDec18(challengeAmount);
      await mockVOL.approve(mintingHub.getAddress(), fchallengeAmount);
      const tx = await mintingHub.challenge(cloneContract.getAddress(), fchallengeAmount, await cloneContract.price());
      await expect(tx).to.emit(mintingHub, 'ChallengeStarted');
      challengeNumber++;
      await evm_increaseTime(86400 * 60 * 2);
      expect(await mintingHub.price(challengeNumber)).to.be.equal(0);
    });
    it('send challenge and ensure owner cannot withdraw', async () => {
      challengeAmount = initialCollateralClone / 2;
      const fchallengeAmount = floatToDec18(challengeAmount);
      await mockVOL.approve(mintingHub.getAddress(), fchallengeAmount);
      const tx = await mintingHub.challenge(cloneContract.getAddress(), fchallengeAmount, await cloneContract.price());
      await expect(tx).to.emit(mintingHub, 'ChallengeStarted');
      challengeNumber++;
      const chprice = await mintingHub.price(challengeNumber);
      expect(chprice).to.be.equal(await cloneContract.price());
      const tx2 = cloneContract.connect(owner).withdrawCollateral(clonePositionAddr, floatToDec18(1));
      await expect(tx2).to.be.revertedWithCustomError(clonePositionContract, 'Challenged');
    });
    it("bid on challenged, expired position", async () => {
      const bidSize = challengeAmount / 2;
      const exp = await cloneContract.expiration();
      await evm_increaseTimeTo(exp - 5n);
      const fchallengeAmount = floatToDec18(challengeAmount);
      await mockVOL.approve(mintingHub.getAddress(), fchallengeAmount);
      const tx2 = await mintingHub.challenge(cloneContract.getAddress(), fchallengeAmount, await cloneContract.price());
      await expect(tx2).to.emit(mintingHub, 'ChallengeStarted');
      challengeNumber++;
      const challenge = await mintingHub.challenges(challengeNumber);
      const positionsAddress = challenge.position;

      await mockVOL.mint(clonePositionAddr, floatToDec18(bidSize)); // ensure there is something to bid on
      const volBalanceBefore = await mockVOL.balanceOf(alice.address);
      const challengeData = await positionContract.challengeData();
      await evm_increaseTime(challengeData.phase);
      const bidAmountJUSD =
        (challengeData.liqPrice * floatToDec18(bidSize)) / DECIMALS;
      const totCollateral = await mockVOL.balanceOf(positionsAddress);
      const interest = await cloneContract.getInterest();
      const propInterest = (interest * floatToDec18(bidSize)) / totCollateral;
      await JUSD
        .connect(bob)
        .approve(await mintingHub.getAddress(), bidAmountJUSD);
      const tx = await mintingHub
        .connect(alice)
        .bid(challengeNumber, floatToDec18(bidSize), false);
      const price = await mintingHub.price(challengeNumber);
      await expect(tx)
        .to.emit(mintingHub, 'ChallengeSucceeded')
        .withArgs(
          positionsAddress,
          challengeNumber,
          (floatToDec18(bidSize) * price) / DECIMALS,
          floatToDec18(bidSize),
          floatToDec18(bidSize),
        );

      const volBalanceAfter = await mockVOL.balanceOf(alice.address);
      expect(volBalanceAfter - volBalanceBefore).to.be.equal(floatToDec18(bidSize));
      await evm_increaseTime(86400);
      // Challenging challenge 3 at price 16666280864197424200 instead of 25
      let approvalAmount = (price * floatToDec18(bidSize)) / DECIMALS;
      await JUSD.approve(await mintingHub.getAddress(), approvalAmount);
      await expect(
        mintingHub.bid(challengeNumber, floatToDec18(bidSize), false),
      ).to.be.emit(mintingHub, "ChallengeSucceeded");
      expect(await mintingHub.price(challengeNumber)).to.be.equal(0);
    });
    it("bid on not existing challenge", async () => {
      const tx = mintingHub.connect(bob).bid(42, floatToDec18(42), false);
      await expect(tx).to.be.revertedWithPanic();
    });
    it('should revert notify challenge succeed call from non hub', async () => {
      await expect(positionContract.notifyChallengeSucceeded(100)).to.be.revertedWithCustomError(
        positionContract,
        'NotHub',
      );
    });
    it('should revert notify challenge avert call from non hub', async () => {
      await expect(positionContract.notifyChallengeAverted(100)).to.be.revertedWithCustomError(
        positionContract,
        'NotHub',
      );
    });
  });

  describe('adjusting position', async () => {
    const frontendCode = ethers.randomBytes(32);

    beforeEach(async () => {
      const fliqPrice = floatToDec18(5000);
      const minCollateral = floatToDec18(1);
      const fInitialCollateral = floatToDec18(initialCollateral);
      const duration = BigInt(60 * 86_400);
      const fFees = BigInt(fee * 1_000_000);
      const fReserve = BigInt(reserve * 1_000_000);
      const challengePeriod = BigInt(3 * 86400); // 3 days
      await mockVOL.connect(owner).approve(mintingHub.getAddress(), fInitialCollateral);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
      const tx = await mintingHub[
        'openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24,bytes32)'
      ](
        mockVOL.getAddress(),
        minCollateral,
        fInitialCollateral,
        initialLimit,
        7n * 24n * 3600n,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve,
        frontendCode,
      );
      positionAddr = await getPositionAddressFromTX(tx);
      positionContract = await ethers.getContractAt('Position', positionAddr);
      expect(await positionContract.isClosed()).to.be.false;
    });
    it('owner can provide more collaterals to the position', async () => {
      await evm_increaseTimeTo(await positionContract.cooldown() + 1n);
      const colBalance = await mockVOL.balanceOf(positionAddr);
      const amount = floatToDec18(100);
      await mockVOL.approve(positionAddr, amount);
      await positionContract.adjust(0, colBalance + amount, floatToDec18(1000));

      const newColBalance = await mockVOL.balanceOf(positionAddr);
      expect(newColBalance - colBalance).to.be.equal(amount);

      expect((await gateway.frontendCodes(frontendCode)).balance).to.be.equal(0);
    });
    it('owner can withdraw collaterals from the position', async () => {
      await evm_increaseTime(86400 * 8);
      const colBalance = await mockVOL.balanceOf(positionAddr);
      const amount = floatToDec18(100);
      await positionContract.adjust(0, colBalance - amount, floatToDec18(1000));

      const newColBalance = await mockVOL.balanceOf(positionAddr);
      expect(colBalance - newColBalance).to.be.equal(amount);
      expect((await gateway.frontendCodes(frontendCode)).balance).to.be.equal(0);
    });
    it('owner can mint new JUSD', async () => {
      await evm_increaseTime(86400 * 8);
      const price = floatToDec18(1000);
      const colBalance = await mockVOL.balanceOf(positionAddr);
      const minted = await positionContract.getDebt();
      const amount = floatToDec18(100);

      const beforeJUSDBal = await JUSD.balanceOf(owner.address);
      const lastAccrualTimeBefore = await positionContract.lastAccrual();
      await positionContract.adjust(minted + amount, colBalance, price);
      const lastAccrualTimeAfter = await positionContract.lastAccrual();
      const afterJUSDBal = await JUSD.balanceOf(owner.address);
      const reservePPM = await positionContract.reserveContribution();
      const expectedJUSDReceived = amount - (amount * reservePPM) / 1000000n;
      expect(afterJUSDBal - beforeJUSDBal).to.be.equal(expectedJUSDReceived);
      expect(lastAccrualTimeAfter).to.be.greaterThan(lastAccrualTimeBefore); // should accrue interest

      expect((await gateway.frontendCodes(frontendCode)).balance).to.be.equal(0);
    });
    it('owner can burn JUSD', async () => {
      await evm_increaseTime(86400 * 8);
      const frontendCodeBefore = (await gateway.frontendCodes(frontendCode)).balance;
      const price = floatToDec18(1000);
      const colBalance = await mockVOL.balanceOf(positionAddr);
      const principal = await positionContract.principal();
      const amount = floatToDec18(100);
      await positionContract.adjust(principal + amount, colBalance, price);
      expect(await positionContract.principal()).to.be.equal(principal + amount);
      expect((await gateway.frontendCodes(frontendCode)).balance).to.be.equal(
        0,
      );

      const interest = await positionContract.getInterest();
      await JUSD.approve(positionAddr, amount + interest + floatToDec18(1));
      await positionContract.adjust(principal, colBalance, price);
      expect(await positionContract.principal()).to.be.equal(principal);
      expect(
        (await gateway.frontendCodes(frontendCode)).balance,
      ).to.be.greaterThan(frontendCodeBefore);
    });
    it('owner can adjust price', async () => {
      await evm_increaseTime(86400 * 8);

      const frontendCodeBefore = (await gateway.frontendCodes(frontendCode)).balance;
      const price = await positionContract.price();
      const minted = await positionContract.getDebt();
      const collbal = await positionContract.minimumCollateral();

      await positionContract.adjust(minted, collbal, price * 2n);
      expect(await positionContract.price()).to.be.equal(price * 2n);
      expect((await gateway.frontendCodes(frontendCode)).balance).to.be.equal(frontendCodeBefore);
    });
  });
  describe('position expiration auction', () => {
    let test: PositionExpirationTest;
    let pos: Position;
    let frontendCode;

    before(async () => {
      const factory = await ethers.getContractFactory('PositionExpirationTest');
      test = await factory.deploy(mintingHub.getAddress());
      await JUSD.transfer(test.getAddress(), 1000n * 10n ** 18n);

      frontendCode = ethers.randomBytes(32);
      const tx = await test.openPositionFor(alice.getAddress(), frontendCode);
      const positionAddr = await getPositionAddressFromTX(tx);
      pos = await ethers.getContractAt('Position', positionAddr);

      // ensure minter's reserve is at least half there to make tests more interesting
      const target = await JUSD.minterReserve();
      const present = await JUSD.balanceOf(equity.getAddress());
      if (present < target) {
        const amount = (target - present) / 2n;
        await JUSD.connect(owner).transfer(await JUSD.reserve(), amount);
      }
    });

    it('should be possible to borrow after starting', async () => {
      await evm_increaseTimeTo(await pos.start());

      const balanceBefore = await JUSD.balanceOf(alice.getAddress());
      const mintedAmount = 50000n * 10n ** 18n;

      await pos.connect(alice).mint(alice.getAddress(), mintedAmount);

      const balanceAfter = await JUSD.balanceOf(alice.getAddress());
      const reservePPM = await pos.reserveContribution();
      const expectedAmount = mintedAmount - (mintedAmount * reservePPM) / 1_000_000n;
      expect(balanceAfter - balanceBefore).to.be.equal(expectedAmount);
      expect(await pos.principal()).to.be.equal(mintedAmount);
      await JUSD.transfer(test.getAddress(), 39794550000000000000000n);
      await JUSD.transfer(test.getAddress(), 100000000000000000000000n);
    });

    it('force sale should succeed after expiration', async () => {
      await evm_increaseTimeTo(await pos.expiration());
      const frontendCodeBefore = (await gateway.frontendCodes(await test.frontendCode())).balance;
      const totInterest = await pos.getInterest();
      const collateralContract = await ethers.getContractAt("IERC20", await pos.collateral());
      const totCollateral = await collateralContract.balanceOf(pos.getAddress());
      const propInterest = (totInterest * 1n) / totCollateral;
      await test.approveJUSD(await pos.getAddress(), floatToDec18(10_000) + propInterest);
      await test.forceBuy(pos.getAddress(), 1n);
      expect((await gateway.frontendCodes(await test.frontendCode())).balance).to.be.greaterThan(frontendCodeBefore);
    });

    it('price should reach liq price after one period', async () => {
      await evm_increaseTimeTo((await pos.expiration()) + (await pos.challengePeriod()));
      const expPrice = await mintingHub.expiredPurchasePrice(pos.getAddress());
      const liqPrice = await pos.price();
      expect(liqPrice).to.be.equal(expPrice);
    });

    it('force sale at liquidation price should succeed in cleaning up position', async () => {
      const debtBefore = await pos.getDebt();
      const frontendCodeBefore = (
        await gateway.frontendCodes(await test.frontendCode())
      ).balance;
      const collateralContract = await ethers.getContractAt("IERC20", await pos.collateral());
      const totCollateral = await collateralContract.balanceOf(pos.getAddress());
      const totInterest = await pos.getInterest();
      const principal = await pos.principal();
      const propInterest = (totInterest * 35n) / totCollateral;
      const colBalPosBefore = await collateralContract.balanceOf(pos.getAddress());
      const JUSDBalPosBefore = await JUSD.balanceOf(pos.getAddress());

      // forceBuy
      await test.approveJUSD(await pos.getAddress(), floatToDec18(35_000) + propInterest);
      const tx = await test.forceBuy(pos.getAddress(), 35n);
      const receipt = await tx.wait();

      // Emitted Event
      const event = receipt?.logs
        .map((log) => mintingHub.interface.parseLog(log))
        .find((parsedLog) => parsedLog?.name === 'ForcedSale');
      const [ePos, eAmount, ePriceE36MinusDecimals] = event?.args ?? [];

      expect(ePos).to.be.equal(ethers.getAddress(await pos.getAddress()));
      expect(eAmount).to.be.equal(35n);
      expect(ePriceE36MinusDecimals).to.be.equal(await mintingHub.expiredPurchasePrice(pos.getAddress()));

      // TODO: Continue here
      const colBalPosAfter = await collateralContract.balanceOf(pos.getAddress());
      const JUSDBalPosAfter = await JUSD.balanceOf(pos.getAddress());
      const debtAfter = await pos.getDebt();
      let proceeds = (ePriceE36MinusDecimals * BigInt(eAmount)) / 10n ** 18n;
      const maxPrincipalExclReserve = await pos.getUsableMint(principal);
      const principalToRepayExclReserve = maxPrincipalExclReserve > proceeds ? proceeds : maxPrincipalExclReserve;
      proceeds -= principalToRepayExclReserve;
      const principalToRepayWithReserve = await JUSD.calculateFreedAmount(principalToRepayExclReserve, await pos.reserveContribution());
      const remainingPrincipal = principal - principalToRepayWithReserve;
      const principalToRepayDirectly = proceeds > remainingPrincipal ? remainingPrincipal : proceeds;
      const principalToRepay = principalToRepayWithReserve + principalToRepayDirectly;
      proceeds -= principalToRepayDirectly;
      const remainingInterest = propInterest < totInterest ? totInterest - propInterest : 0n;
      const additionalInterestToRepay = proceeds > remainingInterest ? remainingInterest : proceeds;
      const interestToRepay = propInterest + additionalInterestToRepay;
      proceeds -= additionalInterestToRepay;
      const expectedDebtPayoff = principalToRepay + interestToRepay;

      expect(debtBefore - debtAfter).to.be.equal(expectedDebtPayoff);
      expect(debtBefore).to.be.equal(expectedDebtPayoff);
      expect(colBalPosBefore - colBalPosAfter).to.be.equal(35n);
      expect(JUSDBalPosBefore).to.be.equal(JUSDBalPosAfter);
      expect(debtAfter).to.be.equal(0n);
      expect(await pos.isClosed()).to.be.false; // still 64 collateral left

      expect((await gateway.frontendCodes(await test.frontendCode())).balance).to.be.greaterThan(frontendCodeBefore);
    });

    it("get rest for cheap and close position", async () => {
      // At this point there is still 64 collateral left but the debt (principal + interest) is paid off already
      await evm_increaseTimeTo(
        (await pos.expiration()) + 2n * (await pos.challengePeriod()),
      );
      const frontendCodeBefore = (
        await gateway.frontendCodes(await test.frontendCode())
      ).balance;
      const collateralContract = await ethers.getContractAt("IERC20", await pos.collateral());

      const totInterest = await pos.getInterest();
      const colBalanceBefore = await collateralContract.balanceOf(test.getAddress());
      await JUSD.transfer(test, totInterest);
      await test.approveJUSD(await pos.getAddress(), floatToDec18(64_000) + totInterest);
      await test.forceBuy(pos.getAddress(), 64n);
      const colBalanceAfter = await collateralContract.balanceOf(test.getAddress());

      expect(await pos.getDebt()).to.be.equal(0n);
      expect(await pos.isClosed()).to.be.true;
      expect(await collateralContract.balanceOf(pos.getAddress())).to.be.equal(0n);
      expect(await mockVOL.balanceOf(pos.getAddress())).to.be.equal(0n); // still collateral left
      expect(await collateralContract.balanceOf(pos.getAddress())).to.be.equal(0n);
      expect(colBalanceAfter - colBalanceBefore).to.be.equal(64n);

      // No profit from interest as debt was paid off in previous test
      // -> no accrual of new interest, hence the FrontendCode balance remains the same
      expect(
        (await gateway.frontendCodes(await test.frontendCode())).balance,
      ).to.be.equal(frontendCodeBefore);
    });
  });

  describe('position rolling with frontend code', () => {
    let frontendCode1: Uint8Array;
    let frontendCode2: Uint8Array;
    let pos1: Position;
    let pos2: Position;

    beforeEach(async () => {
      await mockVOL.approve(await mintingHub.getAddress(), floatToDec18(10));
      await mockVOL.connect(alice).approve(await mintingHub.getAddress(), floatToDec18(10));

      frontendCode1 = ethers.randomBytes(32);
      frontendCode2 = ethers.randomBytes(32);
      // ---------------------------------------------------------------------------
      // give OWNER a position
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
      const txPos1 = await mintingHub[
        'openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24,bytes32)'
      ](
        mockVOL.getAddress(),
        floatToDec18(1), // min size
        floatToDec18(10), // size
        floatToDec18(100_000), // mint limit
        3 * 86_400,
        100 * 86_400,
        86_400,
        10000,
        floatToDec18(6000),
        100000,
        frontendCode1,
      );
      const pos1Addr = await getPositionAddressFromTX(txPos1);
      pos1 = await ethers.getContractAt('Position', pos1Addr);
      expect(await gateway.referredPositions(pos1Addr)).to.be.equal(ethers.hexlify(frontendCode1));
      // ---------------------------------------------------------------------------
      // give ALICE a position
      const txPos2 = await mintingHub
        .connect(alice)
        ['openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24,bytes32)'](
          mockVOL.getAddress(),
          floatToDec18(1), // min size
          floatToDec18(10), // size
          floatToDec18(100_000), // mint limit
          3 * 86_400,
          100 * 86_400,
          86_400,
          10000,
          floatToDec18(6000),
          100000,
          frontendCode2,
        );
      const pos2Addr = await getPositionAddressFromTX(txPos2);
      pos2 = await ethers.getContractAt('Position', pos2Addr);
      expect(await gateway.referredPositions(pos2Addr)).to.be.equal(ethers.hexlify(frontendCode2));
    });

    it('cloned target position should have the same frontend code as the rolled source position', async () => {
      await evm_increaseTime(10 * 86_400 + 300);
      await pos1.mint(owner.address, floatToDec18(10_000));

      await mockVOL.approve(roller.getAddress(), floatToDec18(10_000));
      await JUSD.approve(roller.getAddress(), floatToDec18(20_000));
      const rollerTx = await roller.rollFully(pos1.getAddress(), pos2.getAddress());
      const rolledPosAddr = await getPositionAddressFromTX(rollerTx);

      expect(await pos1.isClosed()).to.be.true;
      expect(await gateway.referredPositions(rolledPosAddr)).to.be.equal(ethers.hexlify(frontendCode1));
    });
  });
});
