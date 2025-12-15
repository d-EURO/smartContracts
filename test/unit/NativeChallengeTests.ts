import { expect } from "chai";
import { floatToDec18 } from "../../scripts/utils/math";
import { ethers } from "hardhat";
import { evm_increaseTime, evm_increaseTimeTo } from "../utils";
import {
  JuiceDollar,
  MintingHub,
  Position,
  Savings,
  PositionRoller,
  StablecoinBridge,
  TestToken,
  TestWcBTC,
  RejectNative,
} from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ContractTransactionResponse } from "ethers";

const getPositionAddressFromTX = async (
  tx: ContractTransactionResponse
): Promise<string> => {
  const PositionOpenedTopic =
    "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175";
  const rc = await tx.wait();
  const log = rc?.logs.find((x) => x.topics.indexOf(PositionOpenedTopic) >= 0);
  return "0x" + log?.topics[2].substring(26);
};

describe("Native cBTC Challenge & Liquidation Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let challenger: HardhatEthersSigner;
  let bidder: HardhatEthersSigner;

  let JUSD: JuiceDollar;
  let mintingHub: MintingHub;
  let bridge: StablecoinBridge;
  let savings: Savings;
  let roller: PositionRoller;
  let mockXUSD: TestToken;
  let wcbtc: TestWcBTC;

  // Position params
  const initialLimit = floatToDec18(10_000_000);
  const minCollateral = floatToDec18(1);
  const liqPrice = floatToDec18(100_000); // 1 WCBTC = 100,000 JUSD
  const reservePPM = 200_000; // 20%
  const riskPremiumPPM = 10_000; // 1%
  const duration = 365n * 86_400n; // 1 year
  const challengePeriod = 3n * 86_400n; // 3 days
  const initPeriod = 7n * 86_400n; // 7 days

  before(async () => {
    [owner, alice, bob, challenger, bidder] = await ethers.getSigners();

    // Deploy JUSD
    const JuiceDollarFactory = await ethers.getContractFactory("JuiceDollar");
    JUSD = await JuiceDollarFactory.deploy(10 * 86400);

    // Deploy TestWcBTC
    const TestWcBTCFactory = await ethers.getContractFactory("TestWcBTC");
    wcbtc = await TestWcBTCFactory.deploy();

    // Deploy PositionFactory
    const PositionFactoryFactory = await ethers.getContractFactory("PositionFactory");
    const positionFactory = await PositionFactoryFactory.deploy();

    // Deploy Savings
    const SavingsFactory = await ethers.getContractFactory("Savings");
    savings = await SavingsFactory.deploy(JUSD.getAddress(), 0n);

    // Deploy PositionRoller
    const RollerFactory = await ethers.getContractFactory("PositionRoller");
    roller = await RollerFactory.deploy(JUSD.getAddress());

    // Deploy MintingHub
    const MintingHubFactory = await ethers.getContractFactory("MintingHub");
    mintingHub = await MintingHubFactory.deploy(
      JUSD.getAddress(),
      savings.getAddress(),
      roller.getAddress(),
      positionFactory.getAddress(),
      wcbtc.getAddress()
    );

    // Create mockXUSD and bridge to bootstrap JUSD
    const TestTokenFactory = await ethers.getContractFactory("TestToken");
    mockXUSD = await TestTokenFactory.deploy("Mock USD", "XUSD", 18);

    const bridgeLimit = floatToDec18(10_000_000);
    const BridgeFactory = await ethers.getContractFactory("StablecoinBridge");
    bridge = await BridgeFactory.deploy(mockXUSD.getAddress(), JUSD.getAddress(), bridgeLimit, 30);

    // Initialize JUSD
    await JUSD.initialize(bridge.getAddress(), "XUSD Bridge");
    await JUSD.initialize(mintingHub.getAddress(), "Minting Hub");
    await JUSD.initialize(savings.getAddress(), "Savings");
    await JUSD.initialize(roller.getAddress(), "Roller");

    // Wait for initialization
    await evm_increaseTime(60);

    // Bootstrap JUSD by minting through bridge
    const bootstrapAmount = floatToDec18(5_000_000);
    await mockXUSD.mint(owner.address, bootstrapAmount);
    await mockXUSD.approve(bridge.getAddress(), bootstrapAmount);
    await bridge.mint(bootstrapAmount);

    // Distribute JUSD to other signers
    await JUSD.transfer(alice.address, floatToDec18(500_000));
    await JUSD.transfer(bob.address, floatToDec18(500_000));
    await JUSD.transfer(challenger.address, floatToDec18(500_000));
    await JUSD.transfer(bidder.address, floatToDec18(500_000));
  });

  describe("challenge() with Native cBTC", () => {
    let positionAddr: string;
    let positionContract: Position;

    beforeEach(async () => {
      // Create a fresh WCBTC position for each test
      const initialCollateral = floatToDec18(10);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      const tx = await mintingHub.openPosition(
        wcbtc.getAddress(),
        minCollateral,
        initialCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        liqPrice,
        reservePPM,
        { value: initialCollateral }
      );

      positionAddr = await getPositionAddressFromTX(tx);
      positionContract = await ethers.getContractAt("Position", positionAddr);

      // Wait for initialization and mint JUSD to create debt
      await evm_increaseTimeTo(await positionContract.start());
      await positionContract.mint(owner.address, floatToDec18(500_000));
    });

    it("should start challenge with native cBTC deposit via msg.value", async () => {
      const challengeAmount = floatToDec18(2);
      const price = await positionContract.price();

      const hubWcbtcBefore = await wcbtc.balanceOf(mintingHub.getAddress());
      const challengerNativeBefore = await ethers.provider.getBalance(challenger.address);

      // Challenge with native cBTC
      const tx = await mintingHub.connect(challenger).challenge(
        positionAddr,
        challengeAmount,
        price,
        { value: challengeAmount }
      );
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const hubWcbtcAfter = await wcbtc.balanceOf(mintingHub.getAddress());
      const challengerNativeAfter = await ethers.provider.getBalance(challenger.address);

      // Hub should hold the wrapped cBTC
      expect(hubWcbtcAfter - hubWcbtcBefore).to.equal(challengeAmount);

      // Challenger spent native cBTC
      expect(challengerNativeBefore - challengerNativeAfter - gasUsed).to.equal(challengeAmount);
    });

    it("should start challenge with ERC20 WcBTC (backward compatible)", async () => {
      const challengeAmount = floatToDec18(2);
      const price = await positionContract.price();

      // Get WcBTC via deposit
      await wcbtc.connect(challenger).deposit({ value: challengeAmount });
      await wcbtc.connect(challenger).approve(mintingHub.getAddress(), challengeAmount);

      const hubWcbtcBefore = await wcbtc.balanceOf(mintingHub.getAddress());

      // Challenge with ERC20 WcBTC (no msg.value)
      await mintingHub.connect(challenger).challenge(
        positionAddr,
        challengeAmount,
        price
        // No msg.value - ERC20 transfer
      );

      const hubWcbtcAfter = await wcbtc.balanceOf(mintingHub.getAddress());
      expect(hubWcbtcAfter - hubWcbtcBefore).to.equal(challengeAmount);
    });

    it("should revert challenge with NativeOnlyForWCBTC when using msg.value on non-WcBTC position", async () => {
      // Create a non-WcBTC position
      const TestTokenFactory = await ethers.getContractFactory("TestToken");
      const mockVOL = await TestTokenFactory.deploy("Volatile", "VOL", 18);

      const volCollateral = floatToDec18(1000);
      await mockVOL.mint(owner.address, volCollateral);
      await mockVOL.approve(mintingHub.getAddress(), volCollateral);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      const tx = await mintingHub.openPosition(
        mockVOL.getAddress(),
        floatToDec18(100),
        volCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        floatToDec18(100), // VOL price
        reservePPM
      );

      const volPositionAddr = await getPositionAddressFromTX(tx);
      const volPosition = await ethers.getContractAt("Position", volPositionAddr);
      await evm_increaseTimeTo(await volPosition.start());
      await volPosition.mint(owner.address, floatToDec18(10_000));

      const price = await volPosition.price();

      // Try to challenge with native cBTC (should fail)
      await expect(
        mintingHub.connect(challenger).challenge(
          volPositionAddr,
          floatToDec18(100),
          price,
          { value: floatToDec18(100) }
        )
      ).to.be.revertedWithCustomError(mintingHub, "NativeOnlyForWCBTC");
    });

    it("should revert challenge with ValueMismatch when msg.value != collateralAmount", async () => {
      const challengeAmount = floatToDec18(2);
      const wrongValue = floatToDec18(1); // Different from challengeAmount
      const price = await positionContract.price();

      await expect(
        mintingHub.connect(challenger).challenge(
          positionAddr,
          challengeAmount,
          price,
          { value: wrongValue }
        )
      ).to.be.revertedWithCustomError(mintingHub, "ValueMismatch");
    });

    it("should emit ChallengeStarted event with correct parameters", async () => {
      const challengeAmount = floatToDec18(2);
      const price = await positionContract.price();

      await expect(
        mintingHub.connect(challenger).challenge(
          positionAddr,
          challengeAmount,
          price,
          { value: challengeAmount }
        )
      ).to.emit(mintingHub, "ChallengeStarted");
    });
  });

  describe("bid() with Native cBTC Return", () => {
    it("should return collateral as native cBTC to challenger when returnCollateralAsNative=true", async () => {
      // Create position
      const initialCollateral = floatToDec18(10);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      const tx = await mintingHub.openPosition(
        wcbtc.getAddress(),
        minCollateral,
        initialCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        liqPrice,
        reservePPM,
        { value: initialCollateral }
      );

      const positionAddr = await getPositionAddressFromTX(tx);
      const positionContract = await ethers.getContractAt("Position", positionAddr);

      await evm_increaseTimeTo(await positionContract.start());
      await positionContract.mint(owner.address, floatToDec18(500_000));

      // Start a challenge with native cBTC
      const challengeAmount = floatToDec18(3);
      const price = await positionContract.price();
      const challengeNumber = await mintingHub.connect(challenger).challenge.staticCall(
        positionAddr,
        challengeAmount,
        price,
        { value: challengeAmount }
      );
      await mintingHub.connect(challenger).challenge(
        positionAddr,
        challengeAmount,
        price,
        { value: challengeAmount }
      );

      // Move past the challenge period so bid ends the challenge
      await evm_increaseTime(Number(challengePeriod) + 100);

      const challenge = await mintingHub.challenges(challengeNumber);
      const challengerNativeBefore = await ethers.provider.getBalance(challenger.address);

      // Bidder needs JUSD to bid
      const bidSize = challenge.size;
      await JUSD.connect(bidder).approve(mintingHub.getAddress(), floatToDec18(1_000_000));

      // Bid with returnCollateralAsNative=true
      await mintingHub.connect(bidder)["bid(uint32,uint256,bool,bool)"](
        challengeNumber,
        bidSize,
        false, // postponeCollateralReturn
        true   // returnCollateralAsNative
      );

      const challengerNativeAfter = await ethers.provider.getBalance(challenger.address);

      // Challenger should receive native cBTC
      expect(challengerNativeAfter - challengerNativeBefore).to.equal(bidSize);
    });

    it("should transfer collateral as native cBTC to BIDDER in phase 2 (liquidation) when returnCollateralAsNative=true", async () => {
      // Ensure bidder has enough JUSD
      await JUSD.transfer(bidder.address, floatToDec18(500_000));

      // Create position
      const initialCollateral = floatToDec18(10);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      const tx = await mintingHub.openPosition(
        wcbtc.getAddress(),
        minCollateral,
        initialCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        liqPrice,
        reservePPM,
        { value: initialCollateral }
      );

      const positionAddr = await getPositionAddressFromTX(tx);
      const positionContract = await ethers.getContractAt("Position", positionAddr);

      await evm_increaseTimeTo(await positionContract.start());
      await positionContract.mint(owner.address, floatToDec18(500_000));

      // Start challenge
      const challengeAmount = floatToDec18(3);
      const price = await positionContract.price();
      const challengeNumber = await mintingHub.connect(challenger).challenge.staticCall(
        positionAddr, challengeAmount, price, { value: challengeAmount }
      );
      await mintingHub.connect(challenger).challenge(
        positionAddr, challengeAmount, price, { value: challengeAmount }
      );

      // Move to phase 2 (past challenge period)
      await evm_increaseTime(Number(challengePeriod) + 100);

      // Record bidder's native balance BEFORE
      const bidderNativeBefore = await ethers.provider.getBalance(bidder.address);
      const bidderWcbtcBefore = await wcbtc.balanceOf(bidder.address);

      // Bidder bids with returnCollateralAsNative=true
      await JUSD.connect(bidder).approve(mintingHub.getAddress(), floatToDec18(1_000_000));
      const bidTx = await mintingHub.connect(bidder)["bid(uint32,uint256,bool,bool)"](
        challengeNumber,
        challengeAmount,
        false, // postponeCollateralReturn
        true   // returnCollateralAsNative
      );
      const receipt = await bidTx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const bidderNativeAfter = await ethers.provider.getBalance(bidder.address);
      const bidderWcbtcAfter = await wcbtc.balanceOf(bidder.address);

      // Bidder should receive collateral as native cBTC (not WCBTC)
      expect(bidderWcbtcAfter).to.equal(bidderWcbtcBefore); // No WCBTC change
      expect(bidderNativeAfter + gasUsed - bidderNativeBefore).to.be.gt(0); // Received native
    });

    it("should transfer collateral as native cBTC to BIDDER in phase 1 (aversion) when returnCollateralAsNative=true", async () => {
      // Ensure bidder has enough JUSD
      await JUSD.transfer(bidder.address, floatToDec18(500_000));

      // Create position
      const initialCollateral = floatToDec18(10);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      const tx = await mintingHub.openPosition(
        wcbtc.getAddress(),
        minCollateral,
        initialCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        liqPrice,
        reservePPM,
        { value: initialCollateral }
      );

      const positionAddr = await getPositionAddressFromTX(tx);
      const positionContract = await ethers.getContractAt("Position", positionAddr);

      await evm_increaseTimeTo(await positionContract.start());
      await positionContract.mint(owner.address, floatToDec18(500_000));

      // Start challenge
      const challengeAmount = floatToDec18(3);
      const price = await positionContract.price();
      const challengeNumber = await mintingHub.connect(challenger).challenge.staticCall(
        positionAddr, challengeAmount, price, { value: challengeAmount }
      );
      await mintingHub.connect(challenger).challenge(
        positionAddr, challengeAmount, price, { value: challengeAmount }
      );

      // Stay in phase 1 (do NOT move past challenge period)
      await evm_increaseTime(100); // Just 100 seconds, still in phase 1

      // Record bidder's native balance BEFORE
      const bidderNativeBefore = await ethers.provider.getBalance(bidder.address);
      const bidderWcbtcBefore = await wcbtc.balanceOf(bidder.address);

      // Bidder averts with returnCollateralAsNative=true
      await JUSD.connect(bidder).approve(mintingHub.getAddress(), floatToDec18(1_000_000));
      const bidTx = await mintingHub.connect(bidder)["bid(uint32,uint256,bool,bool)"](
        challengeNumber,
        challengeAmount,
        false, // postponeCollateralReturn
        true   // returnCollateralAsNative
      );
      const receipt = await bidTx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const bidderNativeAfter = await ethers.provider.getBalance(bidder.address);
      const bidderWcbtcAfter = await wcbtc.balanceOf(bidder.address);

      // Bidder should receive challenger's collateral as native cBTC
      expect(bidderWcbtcAfter).to.equal(bidderWcbtcBefore); // No WCBTC change
      // Use closeTo due to small rounding in gas calculations
      expect(bidderNativeAfter + gasUsed - bidderNativeBefore).to.be.closeTo(challengeAmount, floatToDec18(0.001));
    });

    it("should transfer collateral as WCBTC (not native) to bidder when returnCollateralAsNative=false", async () => {
      // Ensure bidder has enough JUSD
      await JUSD.transfer(bidder.address, floatToDec18(500_000));

      // Create position
      const initialCollateral = floatToDec18(10);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      const tx = await mintingHub.openPosition(
        wcbtc.getAddress(),
        minCollateral,
        initialCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        liqPrice,
        reservePPM,
        { value: initialCollateral }
      );

      const positionAddr = await getPositionAddressFromTX(tx);
      const positionContract = await ethers.getContractAt("Position", positionAddr);

      await evm_increaseTimeTo(await positionContract.start());
      await positionContract.mint(owner.address, floatToDec18(500_000));

      // Start challenge with ERC20 (not native)
      const challengeAmount = floatToDec18(3);
      await wcbtc.connect(challenger).deposit({ value: challengeAmount });
      await wcbtc.connect(challenger).approve(mintingHub.getAddress(), challengeAmount);

      const price = await positionContract.price();
      const challengeNumber = await mintingHub.connect(challenger).challenge.staticCall(
        positionAddr, challengeAmount, price
      );
      await mintingHub.connect(challenger).challenge(positionAddr, challengeAmount, price);

      // Move to phase 2
      await evm_increaseTime(Number(challengePeriod) + 100);

      const bidderWcbtcBefore = await wcbtc.balanceOf(bidder.address);

      // Bidder bids with 3-arg version (no asNative flag, defaults to false)
      await JUSD.connect(bidder).approve(mintingHub.getAddress(), floatToDec18(1_000_000));
      await mintingHub.connect(bidder)["bid(uint32,uint256,bool)"](
        challengeNumber,
        challengeAmount,
        false // postponeCollateralReturn
      );

      const bidderWcbtcAfter = await wcbtc.balanceOf(bidder.address);

      // Bidder should receive WCBTC (ERC20), not native
      expect(bidderWcbtcAfter - bidderWcbtcBefore).to.be.gt(0);
    });
  });

  describe("returnPostponedCollateral() with Native Option", () => {
    it("should withdraw postponed collateral as native cBTC", async () => {
      // Create position
      const initialCollateral = floatToDec18(10);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      const tx = await mintingHub.openPosition(
        wcbtc.getAddress(),
        minCollateral,
        initialCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        liqPrice,
        reservePPM,
        { value: initialCollateral }
      );

      const positionAddr = await getPositionAddressFromTX(tx);
      const positionContract = await ethers.getContractAt("Position", positionAddr);

      await evm_increaseTimeTo(await positionContract.start());
      await positionContract.mint(owner.address, floatToDec18(500_000));

      // Start challenge with native
      const challengeAmount = floatToDec18(3);
      const price = await positionContract.price();
      const challengeNumber = await mintingHub.connect(challenger).challenge.staticCall(
        positionAddr,
        challengeAmount,
        price,
        { value: challengeAmount }
      );
      await mintingHub.connect(challenger).challenge(
        positionAddr,
        challengeAmount,
        price,
        { value: challengeAmount }
      );

      // Move past challenge period
      await evm_increaseTime(Number(challengePeriod) + 100);

      // Give bidder more JUSD from owner
      await JUSD.transfer(bidder.address, floatToDec18(500_000));

      // Bid with postponed collateral return
      await JUSD.connect(bidder).approve(mintingHub.getAddress(), floatToDec18(1_000_000));
      await mintingHub.connect(bidder)["bid(uint32,uint256,bool)"](
        challengeNumber,
        challengeAmount,
        true // postponeCollateralReturn
      );

      const pending = await mintingHub.pendingReturns(wcbtc.getAddress(), challenger.address);
      expect(pending).to.be.gt(0);

      const challengerNativeBefore = await ethers.provider.getBalance(challenger.address);

      // Withdraw as native
      const withdrawTx = await mintingHub.connect(challenger)["returnPostponedCollateral(address,address,bool)"](
        wcbtc.getAddress(),
        challenger.address,
        true // asNative
      );
      const receipt = await withdrawTx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const challengerNativeAfter = await ethers.provider.getBalance(challenger.address);
      const pendingAfter = await mintingHub.pendingReturns(wcbtc.getAddress(), challenger.address);

      // Pending should be cleared
      expect(pendingAfter).to.equal(0);

      // Challenger received native cBTC
      expect(challengerNativeAfter - challengerNativeBefore + gasUsed).to.equal(pending);
    });

    it("should revert with NativeTransferFailed when native transfer fails", async () => {
      // Create position
      const initialCollateral = floatToDec18(10);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      const tx = await mintingHub.openPosition(
        wcbtc.getAddress(),
        minCollateral,
        initialCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        liqPrice,
        reservePPM,
        { value: initialCollateral }
      );

      const positionAddr = await getPositionAddressFromTX(tx);
      const positionContract = await ethers.getContractAt("Position", positionAddr);

      await evm_increaseTimeTo(await positionContract.start());
      await positionContract.mint(owner.address, floatToDec18(500_000));

      // Start challenge with native
      const challengeAmount = floatToDec18(3);
      const price = await positionContract.price();
      const challengeNumber = await mintingHub.connect(challenger).challenge.staticCall(
        positionAddr,
        challengeAmount,
        price,
        { value: challengeAmount }
      );
      await mintingHub.connect(challenger).challenge(
        positionAddr,
        challengeAmount,
        price,
        { value: challengeAmount }
      );

      // Move past challenge period
      await evm_increaseTime(Number(challengePeriod) + 100);

      // Give bidder more JUSD from owner
      await JUSD.transfer(bidder.address, floatToDec18(500_000));

      // Bid with postponed collateral return
      await JUSD.connect(bidder).approve(mintingHub.getAddress(), floatToDec18(1_000_000));
      await mintingHub.connect(bidder)["bid(uint32,uint256,bool)"](
        challengeNumber,
        challengeAmount,
        true
      );

      const RejectNativeFactory = await ethers.getContractFactory("RejectNative");
      const rejectNative: RejectNative = await RejectNativeFactory.deploy();

      // Try to withdraw to rejecting contract
      await expect(
        mintingHub.connect(challenger)["returnPostponedCollateral(address,address,bool)"](
          wcbtc.getAddress(),
          await rejectNative.getAddress(),
          true
        )
      ).to.be.revertedWithCustomError(mintingHub, "NativeTransferFailed");
    });
  });

  describe("MintingHub receive() Function", () => {
    it("should accept native cBTC sent directly to the hub", async () => {
      const hubBalanceBefore = await ethers.provider.getBalance(mintingHub.getAddress());
      const sendAmount = floatToDec18(1);

      await owner.sendTransaction({
        to: mintingHub.getAddress(),
        value: sendAmount,
      });

      const hubBalanceAfter = await ethers.provider.getBalance(mintingHub.getAddress());
      expect(hubBalanceAfter - hubBalanceBefore).to.equal(sendAmount);
    });
  });

  describe("Edge Cases and Security", () => {
    it("should not leave residual native cBTC in hub after challenge with native", async () => {
      const initialCollateral = floatToDec18(10);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      const tx = await mintingHub.openPosition(
        wcbtc.getAddress(),
        minCollateral,
        initialCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        liqPrice,
        reservePPM,
        { value: initialCollateral }
      );

      const posAddr = await getPositionAddressFromTX(tx);
      const pos = await ethers.getContractAt("Position", posAddr);

      await evm_increaseTimeTo(await pos.start());
      await pos.mint(owner.address, floatToDec18(500_000));

      const hubNativeBefore = await ethers.provider.getBalance(mintingHub.getAddress());

      // Challenge with native
      const challengeAmount = floatToDec18(2);
      await mintingHub.connect(challenger).challenge(
        posAddr,
        challengeAmount,
        await pos.price(),
        { value: challengeAmount }
      );

      const hubNativeAfter = await ethers.provider.getBalance(mintingHub.getAddress());

      // Hub should have same native balance (native was wrapped to WcBTC)
      expect(hubNativeAfter).to.equal(hubNativeBefore);
    });

    it("should handle zero-value challenge gracefully", async () => {
      const initialCollateral = floatToDec18(10);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      const tx = await mintingHub.openPosition(
        wcbtc.getAddress(),
        minCollateral,
        initialCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        liqPrice,
        reservePPM,
        { value: initialCollateral }
      );

      const posAddr = await getPositionAddressFromTX(tx);
      const pos = await ethers.getContractAt("Position", posAddr);

      await evm_increaseTimeTo(await pos.start());
      await pos.mint(owner.address, floatToDec18(500_000));

      // Try to challenge with 0 value
      await expect(
        mintingHub.connect(challenger).challenge(
          posAddr,
          0,
          await pos.price(),
          { value: 0 }
        )
      ).to.be.reverted; // Should fail in notifyChallengeStarted or similar
    });
  });

  describe("buyExpiredCollateral() with Native Option", () => {
    it("should allow buying expired collateral as native cBTC", async () => {
      // Transfer much more JUSD to bidder for this test (price at expiration is 10x liq price)
      // 5 cBTC at liqPrice=100,000 * 10 = 5,000,000 JUSD needed
      await JUSD.transfer(bidder.address, floatToDec18(6_000_000));

      // Create position
      const initialCollateral = floatToDec18(10);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      const tx = await mintingHub.openPosition(
        wcbtc.getAddress(),
        minCollateral,
        initialCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        liqPrice,
        reservePPM,
        { value: initialCollateral }
      );

      const positionAddr = await getPositionAddressFromTX(tx);
      const positionContract = await ethers.getContractAt("Position", positionAddr);

      await evm_increaseTimeTo(await positionContract.start());
      await positionContract.mint(owner.address, floatToDec18(500_000));

      // Wait for position to expire
      await evm_increaseTimeTo(await positionContract.expiration());

      // Buyer wants to buy expired collateral as native
      const buyAmount = floatToDec18(5);
      const bidderNativeBefore = await ethers.provider.getBalance(bidder.address);
      const bidderWcbtcBefore = await wcbtc.balanceOf(bidder.address);

      // Approve the Hub (not the Position) - our fix makes this work for native path
      await JUSD.connect(bidder).approve(mintingHub.getAddress(), floatToDec18(6_000_000));
      const buyTx = await mintingHub.connect(bidder)["buyExpiredCollateral(address,uint256,bool)"](
        positionAddr,
        buyAmount,
        true // receiveAsNative
      );
      const receipt = await buyTx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const bidderNativeAfter = await ethers.provider.getBalance(bidder.address);
      const bidderWcbtcAfter = await wcbtc.balanceOf(bidder.address);

      // Bidder should receive native cBTC (not WCBTC)
      expect(bidderWcbtcAfter).to.equal(bidderWcbtcBefore); // No WCBTC change
      expect(bidderNativeAfter + gasUsed - bidderNativeBefore).to.be.gt(0); // Received native
    });

    it("should allow buying expired collateral as WCBTC when receiveAsNative=false", async () => {
      // Transfer JUSD to bidder for this test (use smaller amount to not exhaust owner's balance)
      await JUSD.transfer(bidder.address, floatToDec18(2_000_000));

      // Create position
      const initialCollateral = floatToDec18(10);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      const tx = await mintingHub.openPosition(
        wcbtc.getAddress(),
        minCollateral,
        initialCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        liqPrice,
        reservePPM,
        { value: initialCollateral }
      );

      const positionAddr = await getPositionAddressFromTX(tx);
      const positionContract = await ethers.getContractAt("Position", positionAddr);

      await evm_increaseTimeTo(await positionContract.start());
      await positionContract.mint(owner.address, floatToDec18(500_000));

      // Wait for position to expire + half challenge period to get lower price
      const expiration = await positionContract.expiration();
      const challengePeriodVal = await positionContract.challengePeriod();
      await evm_increaseTimeTo(expiration + challengePeriodVal / 2n);

      // Buyer wants to buy expired collateral as WCBTC (not native)
      // At this point, price is ~5.5x liq price, so 1 cBTC costs ~550,000 JUSD
      const buyAmount = floatToDec18(1);
      const bidderWcbtcBefore = await wcbtc.balanceOf(bidder.address);

      // For non-native path, user must approve the Position directly (existing behavior)
      await JUSD.connect(bidder).approve(positionAddr, floatToDec18(2_000_000));
      await mintingHub.connect(bidder)["buyExpiredCollateral(address,uint256,bool)"](
        positionAddr,
        buyAmount,
        false // receiveAsNative = false
      );

      const bidderWcbtcAfter = await wcbtc.balanceOf(bidder.address);

      // Bidder should receive WCBTC (ERC20)
      expect(bidderWcbtcAfter - bidderWcbtcBefore).to.be.gt(0);
    });
  });
});
