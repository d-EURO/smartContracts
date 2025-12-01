import { expect } from "chai";
import { floatToDec18 } from "../../scripts/utils/math";
import { ethers } from "hardhat";
import { evm_increaseTime, evm_increaseTimeTo } from "../utils";
import {
  JuiceDollar,
  MintingHub,
  MintingHubGateway,
  Position,
  Savings,
  PositionRoller,
  PositionFactory,
  StablecoinBridge,
  TestToken,
  TestWcBTC,
  FrontendGateway,
  RejectNative,
  ReentrantAttacker,
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

describe("Native Coin Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let JUSD: JuiceDollar;
  let mintingHub: MintingHub;
  let mintingHubGateway: MintingHubGateway;
  let bridge: StablecoinBridge;
  let savings: Savings;
  let roller: PositionRoller;
  let mockXUSD: TestToken;
  let mockVOL: TestToken;
  let wcbtc: TestWcBTC;
  let gateway: FrontendGateway;

  // Position params
  const initialLimit = floatToDec18(10_000_000);
  const minCollateral = floatToDec18(1);
  const liqPrice = floatToDec18(100_000); // 1 WCBTC = 100,000 JUSD
  const reservePPM = 100_000; // 10%
  const riskPremiumPPM = 10_000; // 1%
  const duration = 365n * 86_400n; // 1 year
  const challengePeriod = 3n * 86_400n; // 3 days
  const initPeriod = 7n * 86_400n; // 7 days
  const frontendCode = ethers.randomBytes(32);

  before(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    // Deploy JUSD
    const JuiceDollarFactory = await ethers.getContractFactory("JuiceDollar");
    JUSD = await JuiceDollarFactory.deploy(10 * 86400);

    // Deploy TestWcBTC
    const TestWcBTCFactory = await ethers.getContractFactory("TestWcBTC");
    wcbtc = await TestWcBTCFactory.deploy();

    // Deploy FrontendGateway
    const GatewayFactory = await ethers.getContractFactory("FrontendGateway");
    gateway = await GatewayFactory.deploy(JUSD.getAddress());

    // Deploy PositionFactory
    const PositionFactoryFactory = await ethers.getContractFactory("PositionFactory");
    const positionFactory = await PositionFactoryFactory.deploy();

    // Deploy Savings
    const SavingsFactory = await ethers.getContractFactory("Savings");
    savings = await SavingsFactory.deploy(JUSD.getAddress(), 0n);

    // Deploy PositionRoller
    const RollerFactory = await ethers.getContractFactory("PositionRoller");
    roller = await RollerFactory.deploy(JUSD.getAddress());

    // Deploy MintingHub (without gateway)
    const MintingHubFactory = await ethers.getContractFactory("MintingHub");
    mintingHub = await MintingHubFactory.deploy(
      JUSD.getAddress(),
      savings.getAddress(),
      roller.getAddress(),
      positionFactory.getAddress(),
      wcbtc.getAddress() // WCBTC address for native coin support
    );

    // Deploy MintingHubGateway (with gateway)
    const MintingHubGatewayFactory = await ethers.getContractFactory("MintingHubGateway");
    mintingHubGateway = await MintingHubGatewayFactory.deploy(
      JUSD.getAddress(),
      savings.getAddress(),
      roller.getAddress(),
      positionFactory.getAddress(),
      gateway.getAddress(),
      wcbtc.getAddress()
    );

    // Initialize gateway
    await gateway.init(ethers.ZeroAddress, mintingHubGateway.getAddress());

    // Create mockXUSD and bridge to bootstrap JUSD
    const TestTokenFactory = await ethers.getContractFactory("TestToken");
    mockXUSD = await TestTokenFactory.deploy("Mock USD", "XUSD", 18);
    mockVOL = await TestTokenFactory.deploy("Volatile Token", "VOL", 18);

    const bridgeLimit = floatToDec18(1_000_000);
    const BridgeFactory = await ethers.getContractFactory("StablecoinBridge");
    bridge = await BridgeFactory.deploy(mockXUSD.getAddress(), JUSD.getAddress(), bridgeLimit, 30);

    // Initialize JUSD
    await JUSD.initialize(bridge.getAddress(), "XUSD Bridge");
    await JUSD.initialize(mintingHub.getAddress(), "Minting Hub");
    await JUSD.initialize(mintingHubGateway.getAddress(), "Minting Hub Gateway");
    await JUSD.initialize(savings.getAddress(), "Savings");
    await JUSD.initialize(roller.getAddress(), "Roller");

    // Wait for initialization
    await evm_increaseTime(60);

    // Bootstrap JUSD by minting through bridge
    await mockXUSD.mint(owner.address, floatToDec18(500_000));
    await mockXUSD.mint(alice.address, floatToDec18(100_000));
    await mockXUSD.approve(bridge.getAddress(), floatToDec18(500_000));
    await bridge.mint(floatToDec18(200_000));
    await mockXUSD.connect(alice).approve(bridge.getAddress(), floatToDec18(100_000));
    await bridge.connect(alice).mint(floatToDec18(50_000));

    // Mint VOL tokens for non-native tests
    await mockVOL.mint(owner.address, floatToDec18(1000));
    await mockVOL.mint(alice.address, floatToDec18(1000));
  });

  describe("MintingHub Native Deposits", () => {
    let parentPosition: string;
    let parentPositionContract: Position;

    before(async () => {
      // Create a parent position with WCBTC collateral using native deposit
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

      parentPosition = await getPositionAddressFromTX(tx);
      parentPositionContract = await ethers.getContractAt("Position", parentPosition);

      // Wait for initialization period
      await evm_increaseTimeTo(await parentPositionContract.start());
    });

    it("should create position with native coin deposit via openPosition", async () => {
      const initialCollateral = floatToDec18(5);
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

      // Verify WCBTC balance in position
      const wcbtcBalance = await wcbtc.balanceOf(positionAddr);
      expect(wcbtcBalance).to.equal(initialCollateral);

      // Verify collateral is WCBTC
      expect(await positionContract.collateral()).to.equal(await wcbtc.getAddress());
    });

    it("should never leave residual native coin or WCBTC in the Hub after native operations", async () => {
      // Get baseline balances
      const hubNativeBefore = await ethers.provider.getBalance(mintingHub.getAddress());
      const hubWcbtcBefore = await wcbtc.balanceOf(mintingHub.getAddress());

      // Perform a native OpenPosition
      const initialCollateral = floatToDec18(5);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
      await mintingHub.openPosition(
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

      // Verify Hub is empty (no residual value)
      const hubNativeAfter = await ethers.provider.getBalance(mintingHub.getAddress());
      const hubWcbtcAfter = await wcbtc.balanceOf(mintingHub.getAddress());

      expect(hubNativeAfter).to.equal(hubNativeBefore); // Should remain 0 (or baseline)
      expect(hubWcbtcAfter).to.equal(hubWcbtcBefore); // Should remain 0
    });

    it("should never leave residual native coin or WCBTC in the Hub after native clone", async () => {
      // Get baseline balances
      const hubNativeBefore = await ethers.provider.getBalance(mintingHub.getAddress());
      const hubWcbtcBefore = await wcbtc.balanceOf(mintingHub.getAddress());

      const cloneCollateral = floatToDec18(2);
      const mintAmount = floatToDec18(500);
      const expiration = await parentPositionContract.expiration();

      await mintingHub
        .connect(alice)
        .clone(
          alice.address,
          parentPosition,
          cloneCollateral,
          mintAmount,
          expiration,
          0,
          { value: cloneCollateral }
        );

      // Verify Hub is empty (no residual value)
      const hubNativeAfter = await ethers.provider.getBalance(mintingHub.getAddress());
      const hubWcbtcAfter = await wcbtc.balanceOf(mintingHub.getAddress());

      expect(hubNativeAfter).to.equal(hubNativeBefore);
      expect(hubWcbtcAfter).to.equal(hubWcbtcBefore);
    });

    it("should clone position with native coin deposit", async () => {
      const cloneCollateral = floatToDec18(3);
      const mintAmount = floatToDec18(1000);
      const expiration = await parentPositionContract.expiration();

      await wcbtc.connect(alice).approve(mintingHub.getAddress(), cloneCollateral);

      const aliceJUSDBefore = await JUSD.balanceOf(alice.address);

      const tx = await mintingHub
        .connect(alice)
        .clone(
          alice.address,
          parentPosition,
          cloneCollateral,
          mintAmount,
          expiration,
          0, // inherit price
          { value: cloneCollateral }
        );

      const cloneAddr = await getPositionAddressFromTX(tx);
      const cloneContract = await ethers.getContractAt("Position", cloneAddr);

      // Verify WCBTC balance in clone
      const wcbtcBalance = await wcbtc.balanceOf(cloneAddr);
      expect(wcbtcBalance).to.equal(cloneCollateral);

      // Verify owner
      expect(await cloneContract.owner()).to.equal(alice.address);

      // Verify JUSD was minted (minus reserve)
      const aliceJUSDAfter = await JUSD.balanceOf(alice.address);
      const expectedUsable = (mintAmount * (1_000_000n - BigInt(reservePPM))) / 1_000_000n;
      expect(aliceJUSDAfter - aliceJUSDBefore).to.equal(expectedUsable);
    });

    it("should revert with NativeOnlyForWCBTC when using msg.value with non-WCBTC collateral", async () => {
      const initialCollateral = floatToDec18(100);
      // Use a higher price to pass the minimum collateral value check (100 JUSD)
      const volPrice = floatToDec18(1000); // 1 VOL = 1000 JUSD, so minColl(1) * price(1000) = 1000 JUSD > 100 JUSD

      await mockVOL.approve(mintingHub.getAddress(), initialCollateral);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      // Try to send native coin with VOL (non-WCBTC) collateral
      await expect(
        mintingHub.openPosition(
          mockVOL.getAddress(), // Not WCBTC
          minCollateral,
          initialCollateral,
          initialLimit,
          initPeriod,
          duration,
          challengePeriod,
          riskPremiumPPM,
          volPrice,
          reservePPM,
          { value: initialCollateral }
        )
      ).to.be.revertedWithCustomError(mintingHub, "NativeOnlyForWCBTC");
    });

    it("should revert with ValueMismatch when msg.value != initialCollateral", async () => {
      const initialCollateral = floatToDec18(5);
      const wrongValue = floatToDec18(3); // Different from initialCollateral

      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      await expect(
        mintingHub.openPosition(
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
          { value: wrongValue }
        )
      ).to.be.revertedWithCustomError(mintingHub, "ValueMismatch");
    });

    it("should work with ERC20 deposit (no msg.value) for WCBTC", async () => {
      const initialCollateral = floatToDec18(2);

      // Get WCBTC via deposit first
      await wcbtc.deposit({ value: initialCollateral });
      await wcbtc.approve(mintingHub.getAddress(), initialCollateral);
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
        reservePPM
        // No msg.value - using ERC20 transfer
      );

      const positionAddr = await getPositionAddressFromTX(tx);
      const wcbtcBalance = await wcbtc.balanceOf(positionAddr);
      expect(wcbtcBalance).to.equal(initialCollateral);
    });
  });

  describe("MintingHubGateway Native Deposits", () => {
    let parentPosition: string;
    let parentPositionContract: Position;

    before(async () => {
      // Create a parent position with WCBTC via gateway
      const initialCollateral = floatToDec18(10);
      await JUSD.approve(mintingHubGateway.getAddress(), await mintingHubGateway.OPENING_FEE());

      const tx = await mintingHubGateway[
        "openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24,bytes32)"
      ](
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
        frontendCode,
        { value: initialCollateral }
      );

      parentPosition = await getPositionAddressFromTX(tx);
      parentPositionContract = await ethers.getContractAt("Position", parentPosition);

      await evm_increaseTimeTo(await parentPositionContract.start());
    });

    it("should create position via gateway with native deposit and frontend code", async () => {
      const initialCollateral = floatToDec18(4);
      await JUSD.approve(mintingHubGateway.getAddress(), await mintingHubGateway.OPENING_FEE());

      const tx = await mintingHubGateway[
        "openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24,bytes32)"
      ](
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
        frontendCode,
        { value: initialCollateral }
      );

      const positionAddr = await getPositionAddressFromTX(tx);
      const wcbtcBalance = await wcbtc.balanceOf(positionAddr);
      expect(wcbtcBalance).to.equal(initialCollateral);
    });

    it("should clone via gateway with native deposit and frontend code", async () => {
      const cloneCollateral = floatToDec18(2);
      const mintAmount = floatToDec18(500);
      const expiration = await parentPositionContract.expiration();

      const tx = await mintingHubGateway
        .connect(alice)
        ["clone(address,address,uint256,uint256,uint40,uint256,bytes32)"](
          alice.address,
          parentPosition,
          cloneCollateral,
          mintAmount,
          expiration,
          0,
          frontendCode,
          { value: cloneCollateral }
        );

      const cloneAddr = await getPositionAddressFromTX(tx);
      const cloneContract = await ethers.getContractAt("Position", cloneAddr);

      expect(await wcbtc.balanceOf(cloneAddr)).to.equal(cloneCollateral);
      expect(await cloneContract.owner()).to.equal(alice.address);
    });
  });

  describe("Position.withdrawCollateralAsNative()", () => {
    let positionAddr: string;
    let positionContract: Position;

    beforeEach(async () => {
      // Create a fresh position for each test
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

      // Wait for initialization and mint some JUSD
      await evm_increaseTimeTo(await positionContract.start());
      await positionContract.mint(owner.address, floatToDec18(100_000));
    });

    it("should withdraw collateral as native coin to target", async () => {
      const withdrawAmount = floatToDec18(1);
      const bobNativeBefore = await ethers.provider.getBalance(bob.address);
      const positionWcBTCBefore = await wcbtc.balanceOf(positionAddr);

      await positionContract.withdrawCollateralAsNative(bob.address, withdrawAmount);

      const bobNativeAfter = await ethers.provider.getBalance(bob.address);
      const positionWcBTCAfter = await wcbtc.balanceOf(positionAddr);

      // Bob should receive native coin
      expect(bobNativeAfter - bobNativeBefore).to.equal(withdrawAmount);

      // Position WCBTC balance should decrease
      expect(positionWcBTCBefore - positionWcBTCAfter).to.equal(withdrawAmount);
    });

    it("should verify collateral check happens after withdrawal", async () => {
      // Try to withdraw too much (would leave position undercollateralized)
      const tooMuch = floatToDec18(9); // Leave only 1 WCBTC for 100k JUSD debt

      await expect(
        positionContract.withdrawCollateralAsNative(bob.address, tooMuch)
      ).to.be.revertedWithCustomError(positionContract, "InsufficientCollateral");
    });

    it("should revert during cooldown", async () => {
      // Trigger cooldown by increasing price
      const newPrice = liqPrice * 15n / 10n; // 1.5x increase
      await positionContract.adjustPrice(newPrice);

      // Now withdrawCollateralAsNative should fail due to cooldown
      await expect(
        positionContract.withdrawCollateralAsNative(bob.address, floatToDec18(1))
      ).to.be.revertedWithCustomError(positionContract, "Hot");
    });

    it("should revert during challenge", async () => {
      // Start a challenge - challenger needs to deposit collateral (WCBTC)
      const challengeSize = floatToDec18(1);
      const price = await positionContract.price();

      // Get WCBTC for the challenge
      await wcbtc.deposit({ value: challengeSize });
      await wcbtc.approve(mintingHub.getAddress(), challengeSize);
      await mintingHub.challenge(positionAddr, challengeSize, price);

      // Now withdrawCollateralAsNative should fail due to challenge
      await expect(
        positionContract.withdrawCollateralAsNative(bob.address, floatToDec18(1))
      ).to.be.revertedWithCustomError(positionContract, "Challenged");
    });

    it("should emit MintingUpdate event", async () => {
      const withdrawAmount = floatToDec18(1);

      await expect(positionContract.withdrawCollateralAsNative(bob.address, withdrawAmount))
        .to.emit(positionContract, "MintingUpdate");
    });

    it("should revert withdrawCollateralAsNative from non-owner", async () => {
      await expect(
        positionContract.connect(alice).withdrawCollateralAsNative(alice.address, floatToDec18(1))
      ).to.be.revertedWithCustomError(positionContract, "OwnableUnauthorizedAccount");
    });

    it("should revert when native transfer to rejecting contract fails", async () => {
      const RejectFactory = await ethers.getContractFactory("RejectNative");
      const rejecter: RejectNative = await RejectFactory.deploy();

      await expect(
        positionContract.withdrawCollateralAsNative(await rejecter.getAddress(), floatToDec18(1))
      ).to.be.revertedWithCustomError(positionContract, "NativeTransferFailed");
    });

    it("should close position when withdrawal leaves balance < minimumCollateral", async () => {
      // Repay all debt first
      const debt = await positionContract.getDebt();
      await JUSD.approve(positionAddr, debt + floatToDec18(1000));
      await positionContract.adjust(0, await wcbtc.balanceOf(positionAddr), await positionContract.price(), false);

      // Withdraw leaving less than minimumCollateral (1 WCBTC)
      const balance = await wcbtc.balanceOf(positionAddr);
      const withdrawAmount = balance - floatToDec18(0.5); // Leave 0.5, less than minColl of 1

      await positionContract.withdrawCollateralAsNative(bob.address, withdrawAmount);

      expect(await positionContract.isClosed()).to.be.true;
    });

    it("should handle withdrawCollateralAsNative with amount = 0", async () => {
      const bobBalanceBefore = await ethers.provider.getBalance(bob.address);
      const wcbtcBefore = await wcbtc.balanceOf(positionAddr);

      // Should emit event but not transfer
      await expect(positionContract.withdrawCollateralAsNative(bob.address, 0))
        .to.emit(positionContract, "MintingUpdate");

      // Balances unchanged
      expect(await ethers.provider.getBalance(bob.address)).to.equal(bobBalanceBefore);
      expect(await wcbtc.balanceOf(positionAddr)).to.equal(wcbtcBefore);
    });
  });

  describe("Position.receive() Auto-wrap", () => {
    let wcbtcPositionAddr: string;
    let wcbtcPositionContract: Position;
    let volPositionAddr: string;

    before(async () => {
      // Create a WCBTC position
      const initialCollateral = floatToDec18(5);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      let tx = await mintingHub.openPosition(
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

      wcbtcPositionAddr = await getPositionAddressFromTX(tx);
      wcbtcPositionContract = await ethers.getContractAt("Position", wcbtcPositionAddr);

      // Create a non-WCBTC (VOL) position for negative test
      const volCollateral = floatToDec18(100);
      await mockVOL.approve(mintingHub.getAddress(), volCollateral);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      tx = await mintingHub.openPosition(
        mockVOL.getAddress(),
        floatToDec18(10),
        volCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        floatToDec18(10), // VOL price
        reservePPM
      );

      volPositionAddr = await getPositionAddressFromTX(tx);
    });

    it("should auto-wrap native coin sent to WCBTC position", async () => {
      const sendAmount = floatToDec18(1);
      const wcbtcBefore = await wcbtc.balanceOf(wcbtcPositionAddr);

      // Send native directly to position
      await owner.sendTransaction({
        to: wcbtcPositionAddr,
        value: sendAmount,
      });

      const wcbtcAfter = await wcbtc.balanceOf(wcbtcPositionAddr);
      expect(wcbtcAfter - wcbtcBefore).to.equal(sendAmount);
    });

    it("should revert when sending native to non-WCBTC position", async () => {
      const sendAmount = floatToDec18(1);

      // Sending native to VOL position should fail
      // (VOL doesn't have deposit() function, so it reverts)
      await expect(
        owner.sendTransaction({
          to: volPositionAddr,
          value: sendAmount,
        })
      ).to.be.reverted;
    });

    it("should not re-wrap when WCBTC sends native during withdraw", async () => {
      // This tests that the receive() check for msg.sender == collateral works
      // First, we need to set up a position and withdraw native

      await evm_increaseTimeTo(await wcbtcPositionContract.start());

      const wcbtcBefore = await wcbtc.balanceOf(wcbtcPositionAddr);
      const withdrawAmount = floatToDec18(1);

      // withdrawCollateralAsNative should work without causing a re-wrap loop
      // If the receive() didn't check msg.sender, this would cause infinite loop/revert
      await wcbtcPositionContract.withdrawCollateralAsNative(bob.address, withdrawAmount);

      const wcbtcAfter = await wcbtc.balanceOf(wcbtcPositionAddr);
      expect(wcbtcBefore - wcbtcAfter).to.equal(withdrawAmount);
    });
  });

  describe("Clone with _liqPrice Parameter", () => {
    let parentPosition: string;
    let parentPositionContract: Position;
    const parentPrice = liqPrice; // 100,000 JUSD

    before(async () => {
      // Create parent position
      const initialCollateral = floatToDec18(20);
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
        parentPrice,
        reservePPM,
        { value: initialCollateral }
      );

      parentPosition = await getPositionAddressFromTX(tx);
      parentPositionContract = await ethers.getContractAt("Position", parentPosition);

      // Wait for init period and mint to make position active
      await evm_increaseTimeTo(await parentPositionContract.start());
      await parentPositionContract.mint(owner.address, floatToDec18(100_000));
    });

    it("should inherit parent price when _liqPrice = 0", async () => {
      const cloneCollateral = floatToDec18(5);
      const mintAmount = floatToDec18(10_000);
      const expiration = await parentPositionContract.expiration();

      const tx = await mintingHub
        .connect(alice)
        .clone(
          alice.address,
          parentPosition,
          cloneCollateral,
          mintAmount,
          expiration,
          0, // Inherit price
          { value: cloneCollateral }
        );

      const cloneAddr = await getPositionAddressFromTX(tx);
      const cloneContract = await ethers.getContractAt("Position", cloneAddr);

      expect(await cloneContract.price()).to.equal(parentPrice);
      expect(await cloneContract.cooldown()).to.equal(0); // No cooldown
    });

    it("should adjust price lower without cooldown when _liqPrice < parent", async () => {
      const cloneCollateral = floatToDec18(5);
      const mintAmount = floatToDec18(5_000); // Smaller mint to allow lower price
      const expiration = await parentPositionContract.expiration();
      const lowerPrice = parentPrice * 8n / 10n; // 80% of parent price

      const tx = await mintingHub
        .connect(alice)
        .clone(
          alice.address,
          parentPosition,
          cloneCollateral,
          mintAmount,
          expiration,
          lowerPrice,
          { value: cloneCollateral }
        );

      const cloneAddr = await getPositionAddressFromTX(tx);
      const cloneContract = await ethers.getContractAt("Position", cloneAddr);

      expect(await cloneContract.price()).to.equal(lowerPrice);
      // Price decrease doesn't trigger cooldown
      expect(await cloneContract.cooldown()).to.equal(0);
    });

    it("should trigger cooldown when _liqPrice > parent price", async () => {
      const cloneCollateral = floatToDec18(10);
      const mintAmount = floatToDec18(10_000);
      const expiration = await parentPositionContract.expiration();
      const higherPrice = parentPrice * 15n / 10n; // 150% of parent price

      const tx = await mintingHub
        .connect(alice)
        .clone(
          alice.address,
          parentPosition,
          cloneCollateral,
          mintAmount,
          expiration,
          higherPrice,
          { value: cloneCollateral }
        );

      const cloneAddr = await getPositionAddressFromTX(tx);
      const cloneContract = await ethers.getContractAt("Position", cloneAddr);

      expect(await cloneContract.price()).to.equal(higherPrice);
      // Price increase triggers cooldown
      expect(await cloneContract.cooldown()).to.be.gt(0);
    });

    it("should revert when _liqPrice > 2x parent price", async () => {
      const cloneCollateral = floatToDec18(10);
      const mintAmount = floatToDec18(10_000);
      const expiration = await parentPositionContract.expiration();
      const tooHighPrice = parentPrice * 21n / 10n; // 210% of parent price

      await expect(
        mintingHub
          .connect(alice)
          .clone(
            alice.address,
            parentPosition,
            cloneCollateral,
            mintAmount,
            expiration,
            tooHighPrice,
            { value: cloneCollateral }
          )
      ).to.be.revertedWithCustomError(parentPositionContract, "PriceTooHigh");
    });

    it("should revert when price decrease leaves position undercollateralized", async () => {
      const cloneCollateral = floatToDec18(2);
      const mintAmount = floatToDec18(150_000); // Large mint
      const expiration = await parentPositionContract.expiration();
      const tooLowPrice = parentPrice / 2n; // 50% of parent price

      await expect(
        mintingHub
          .connect(alice)
          .clone(
            alice.address,
            parentPosition,
            cloneCollateral,
            mintAmount,
            expiration,
            tooLowPrice,
            { value: cloneCollateral }
          )
      ).to.be.revertedWithCustomError(parentPositionContract, "InsufficientCollateral");
    });
  });

  describe("MintingHub.clone() Native Error Cases", () => {
    let volParent: string;
    let volParentContract: Position;
    let wcbtcParent: string;
    let wcbtcParentContract: Position;

    before(async () => {
      // Create a VOL parent position for NativeOnlyForWCBTC test
      const volCollateral = floatToDec18(100);
      const volPrice = floatToDec18(1000); // 1 VOL = 1000 JUSD
      await mockVOL.mint(owner.address, volCollateral);
      await mockVOL.approve(mintingHub.getAddress(), volCollateral);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      let tx = await mintingHub.openPosition(
        mockVOL.getAddress(),
        floatToDec18(10), // minCollateral
        volCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        volPrice,
        reservePPM
      );
      volParent = await getPositionAddressFromTX(tx);
      volParentContract = await ethers.getContractAt("Position", volParent);
      await evm_increaseTimeTo(await volParentContract.start());
      await volParentContract.mint(owner.address, floatToDec18(10_000));

      // Create a WCBTC parent position for ValueMismatch test
      const wcbtcCollateral = floatToDec18(10);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      tx = await mintingHub.openPosition(
        wcbtc.getAddress(),
        minCollateral,
        wcbtcCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        liqPrice,
        reservePPM,
        { value: wcbtcCollateral }
      );
      wcbtcParent = await getPositionAddressFromTX(tx);
      wcbtcParentContract = await ethers.getContractAt("Position", wcbtcParent);
      await evm_increaseTimeTo(await wcbtcParentContract.start());
      await wcbtcParentContract.mint(owner.address, floatToDec18(100_000));
    });

    it("should revert with NativeOnlyForWCBTC when cloning non-WCBTC parent with msg.value", async () => {
      const cloneCollateral = floatToDec18(50);

      await expect(
        mintingHub.connect(alice).clone(
          alice.address,
          volParent,
          cloneCollateral,
          0, // no mint
          await volParentContract.expiration(),
          0, // inherit price
          { value: cloneCollateral }
        )
      ).to.be.revertedWithCustomError(mintingHub, "NativeOnlyForWCBTC");
    });

    it("should revert with ValueMismatch when msg.value != initialCollateral for clone", async () => {
      const cloneCollateral = floatToDec18(3);
      const wrongValue = floatToDec18(2); // Different from cloneCollateral

      await expect(
        mintingHub.connect(alice).clone(
          alice.address,
          wcbtcParent,
          cloneCollateral,
          0,
          await wcbtcParentContract.expiration(),
          0,
          { value: wrongValue }
        )
      ).to.be.revertedWithCustomError(mintingHub, "ValueMismatch");
    });
  });

  describe("WCBTC Position Lifecycle", () => {
    it("full lifecycle: create → mint → withdraw native → repay → close", async () => {
      // 1. Create position with native
      const initialColl = floatToDec18(10);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
      const tx = await mintingHub.openPosition(
        wcbtc.getAddress(),
        minCollateral,
        initialColl,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        liqPrice,
        reservePPM,
        { value: initialColl }
      );
      const posAddr = await getPositionAddressFromTX(tx);
      const pos = await ethers.getContractAt("Position", posAddr);
      await evm_increaseTimeTo(await pos.start());

      // 2. Mint JUSD
      const mintAmount = floatToDec18(100_000);
      await pos.mint(owner.address, mintAmount);
      expect(await pos.principal()).to.be.gt(0);

      // 3. Withdraw some native
      const withdrawAmt = floatToDec18(1);
      const bobBefore = await ethers.provider.getBalance(bob.address);
      await pos.withdrawCollateralAsNative(bob.address, withdrawAmt);
      expect(await ethers.provider.getBalance(bob.address)).to.equal(bobBefore + withdrawAmt);

      // 4. Repay all debt
      const debt = await pos.getDebt();
      await JUSD.approve(posAddr, debt + floatToDec18(1000));
      await pos.adjust(0, await wcbtc.balanceOf(posAddr), await pos.price(), false);
      expect(await pos.principal()).to.equal(0);

      // 5. Withdraw remaining and close
      const remaining = await wcbtc.balanceOf(posAddr);
      await pos.withdrawCollateralAsNative(owner.address, remaining);
      expect(await pos.isClosed()).to.be.true;
    });

    it("force sale should work correctly with WCBTC position", async () => {
      // Create and expire a WCBTC position
      const initialColl = floatToDec18(5);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());
      const tx = await mintingHub.openPosition(
        wcbtc.getAddress(),
        minCollateral,
        initialColl,
        initialLimit,
        initPeriod,
        30n * 86400n, // 30 days to expire quickly
        challengePeriod,
        riskPremiumPPM,
        liqPrice,
        reservePPM,
        { value: initialColl }
      );
      const posAddr = await getPositionAddressFromTX(tx);
      const pos = await ethers.getContractAt("Position", posAddr);

      // Wait for init, mint, then expire
      await evm_increaseTimeTo(await pos.start());
      await pos.mint(owner.address, floatToDec18(50_000));

      // Expire and wait for price to decrease to near liquidation price
      // Force sale price starts at 10x and decreases to 1x over FORCE_SALE_PERIOD (100 days)
      const expiration = await pos.expiration();
      await evm_increaseTimeTo(expiration + 100n * 86400n); // Wait 100 days after expiration

      // Buy all expired collateral - price should be near 1x liqPrice now
      const posCollateral = await wcbtc.balanceOf(posAddr);
      const purchasePrice = await mintingHub.expiredPurchasePrice(posAddr);
      const expectedCost = (posCollateral * purchasePrice) / floatToDec18(1);

      // Approval needs to go to position contract, not mintingHub
      await JUSD.connect(alice).approve(posAddr, expectedCost);

      const aliceWcbtcBefore = await wcbtc.balanceOf(alice.address);
      await mintingHub.connect(alice).buyExpiredCollateral(posAddr, posCollateral);
      const aliceWcbtcAfter = await wcbtc.balanceOf(alice.address);

      // Alice should receive WCBTC (not native - force sale returns ERC20)
      expect(aliceWcbtcAfter - aliceWcbtcBefore).to.equal(posCollateral);
    });
  });

  describe("Edge Case: Clone with _liqPrice == parent.price()", () => {
    let parentPosition: string;
    let parentPositionContract: Position;
    const parentPrice = liqPrice;

    before(async () => {
      const initialCollateral = floatToDec18(15);
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
        parentPrice,
        reservePPM,
        { value: initialCollateral }
      );

      parentPosition = await getPositionAddressFromTX(tx);
      parentPositionContract = await ethers.getContractAt("Position", parentPosition);

      await evm_increaseTimeTo(await parentPositionContract.start());
      await parentPositionContract.mint(owner.address, floatToDec18(100_000));
    });

    it("should do nothing when _liqPrice equals current price", async () => {
      const cloneCollateral = floatToDec18(3);
      const mintAmount = floatToDec18(1000);
      const expiration = await parentPositionContract.expiration();
      const currentPrice = await parentPositionContract.price();

      const tx = await mintingHub.connect(alice).clone(
        alice.address,
        parentPosition,
        cloneCollateral,
        mintAmount,
        expiration,
        currentPrice, // Same as parent price
        { value: cloneCollateral }
      );

      const cloneAddr = await getPositionAddressFromTX(tx);
      const cloneContract = await ethers.getContractAt("Position", cloneAddr);

      // Price should be exactly the parent price
      expect(await cloneContract.price()).to.equal(currentPrice);
      // No cooldown should be triggered
      expect(await cloneContract.cooldown()).to.equal(0);
    });
  });

  describe("Edge Case: Reentrancy Protection in withdrawCollateralAsNative", () => {
    let positionAddr: string;
    let positionContract: Position;
    let attacker: ReentrantAttacker;

    beforeEach(async () => {
      // Create a fresh position
      const initialCollateral = floatToDec18(20);
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

      await evm_increaseTimeTo(await positionContract.start());
      // Mint enough to have debt
      await positionContract.mint(owner.address, floatToDec18(100_000));

      // Deploy ReentrantAttacker
      const AttackerFactory = await ethers.getContractFactory("ReentrantAttacker");
      attacker = await AttackerFactory.deploy();
      await attacker.setTarget(positionAddr);
    });

    it("should enforce collateral requirements even with reentrancy attempts", async () => {
      // Transfer position ownership to attacker contract
      await positionContract.transferOwnership(await attacker.getAddress());

      const wcbtcBalanceBefore = await wcbtc.balanceOf(positionAddr);
      const withdrawAmount = floatToDec18(1);

      // Calculate minimum collateral needed BEFORE attack
      const debtBefore = await positionContract.getCollateralRequirement();
      const minRequiredCollateral = (debtBefore * floatToDec18(1)) / liqPrice;

      // Attacker attempts reentrancy
      // The security property is: regardless of reentrancy, final state must be collateralized
      try {
        await attacker.attack(withdrawAmount);
      } catch {
        // Attack may fail entirely, which is fine
      }

      const wcbtcBalanceAfter = await wcbtc.balanceOf(positionAddr);
      const isClosed = await positionContract.isClosed();

      // KEY SECURITY INVARIANT: Position must still be properly collateralized
      // or closed (if below minimum collateral)
      if (!isClosed) {
        // Position is open - verify it's still collateralized
        expect(wcbtcBalanceAfter).to.be.gte(minRequiredCollateral);
      }

      // Even if reentrancy "succeeded" (multiple withdrawals), the invariant holds
      // The attacker cannot extract more collateral than what the collateral check allows
    });

    it("should block reentrancy that would undercollateralize position", async () => {
      // Transfer position ownership to attacker
      await positionContract.transferOwnership(await attacker.getAddress());

      // Calculate withdrawal amount that would leave just enough collateral
      // If attacker withdraws this twice, second call should fail
      const currentCollateral = await wcbtc.balanceOf(positionAddr);
      const collateralRequirement = await positionContract.getCollateralRequirement();
      const minNeeded = (collateralRequirement * floatToDec18(1)) / liqPrice;

      // Try to withdraw slightly more than half of excess - second call should fail
      const excess = currentCollateral - minNeeded;
      const largeWithdraw = excess / 2n + floatToDec18(1); // Slightly more than half excess

      const wcbtcBalanceBefore = await wcbtc.balanceOf(positionAddr);

      // Attempt attack - second withdrawal should fail due to collateral check
      try {
        await attacker.attack(largeWithdraw);
      } catch {
        // Expected to fail
      }

      const wcbtcBalanceAfter = await wcbtc.balanceOf(positionAddr);
      const totalWithdrawn = wcbtcBalanceBefore - wcbtcBalanceAfter;

      // Verify: either only one withdrawal succeeded, or position closed properly
      const isClosed = await positionContract.isClosed();
      if (!isClosed) {
        // If position is open, verify it's still collateralized
        const debtAfter = await positionContract.getCollateralRequirement();
        const minNeededAfter = (debtAfter * floatToDec18(1)) / liqPrice;
        expect(wcbtcBalanceAfter).to.be.gte(minNeededAfter);
      }
    });
  });

  describe("Edge Case: WCBTC = address(0) Deployment", () => {
    // These tests deploy a completely fresh set of contracts to test WCBTC=0 scenario
    let freshJUSD: JuiceDollar;
    let freshPositionFactory: PositionFactory;
    let freshSavings: Savings;
    let freshRoller: PositionRoller;
    let hubWithZeroWCBTC: MintingHub;

    before(async () => {
      // Deploy fresh JUSD
      const JuiceDollarFactory = await ethers.getContractFactory("JuiceDollar");
      freshJUSD = await JuiceDollarFactory.deploy(10 * 86400);

      // Deploy fresh position factory
      const PositionFactoryFactory = await ethers.getContractFactory("PositionFactory");
      freshPositionFactory = await PositionFactoryFactory.deploy();

      // Deploy fresh savings
      const SavingsFactory = await ethers.getContractFactory("Savings");
      freshSavings = await SavingsFactory.deploy(freshJUSD.getAddress(), 0n);

      // Deploy fresh roller
      const RollerFactory = await ethers.getContractFactory("PositionRoller");
      freshRoller = await RollerFactory.deploy(freshJUSD.getAddress());

      // Deploy MintingHub with WCBTC = address(0)
      const MintingHubFactory = await ethers.getContractFactory("MintingHub");
      hubWithZeroWCBTC = await MintingHubFactory.deploy(
        freshJUSD.getAddress(),
        freshSavings.getAddress(),
        freshRoller.getAddress(),
        freshPositionFactory.getAddress(),
        ethers.ZeroAddress // WCBTC = address(0)
      );

      // Initialize fresh JUSD with the hub
      await freshJUSD.initialize(hubWithZeroWCBTC.getAddress(), "MintingHub Zero WCBTC");
      await freshJUSD.initialize(freshSavings.getAddress(), "Savings");
      await freshJUSD.initialize(freshRoller.getAddress(), "Roller");

      // Wait for initialization
      await evm_increaseTime(60);

      // Bootstrap some JUSD for opening fee
      const TestTokenFactory = await ethers.getContractFactory("TestToken");
      const freshXUSD = await TestTokenFactory.deploy("Fresh XUSD", "FXUSD", 18);
      const BridgeFactory = await ethers.getContractFactory("StablecoinBridge");
      const freshBridge = await BridgeFactory.deploy(
        freshXUSD.getAddress(),
        freshJUSD.getAddress(),
        floatToDec18(100_000),
        30
      );
      await freshJUSD.initialize(freshBridge.getAddress(), "Fresh Bridge");
      await evm_increaseTime(60);

      await freshXUSD.mint(owner.address, floatToDec18(10_000));
      await freshXUSD.approve(freshBridge.getAddress(), floatToDec18(10_000));
      await freshBridge.mint(floatToDec18(5_000));
    });

    it("should block native deposits when WCBTC is address(0)", async () => {
      await freshJUSD.approve(hubWithZeroWCBTC.getAddress(), await hubWithZeroWCBTC.OPENING_FEE());

      // Attempt to create position with native coin should fail
      // because wcbtc.getAddress() != address(0) (the hub's WCBTC)
      await expect(
        hubWithZeroWCBTC.openPosition(
          wcbtc.getAddress(), // Real WCBTC address
          minCollateral,
          floatToDec18(1),
          initialLimit,
          initPeriod,
          duration,
          challengePeriod,
          riskPremiumPPM,
          liqPrice,
          reservePPM,
          { value: floatToDec18(1) }
        )
      ).to.be.revertedWithCustomError(hubWithZeroWCBTC, "NativeOnlyForWCBTC");
    });

    it("should still allow ERC20 deposits when WCBTC is address(0)", async () => {
      // Approve and deposit using ERC20 (should work)
      const initialCollateral = floatToDec18(10);
      await wcbtc.deposit({ value: initialCollateral });
      await wcbtc.approve(hubWithZeroWCBTC.getAddress(), initialCollateral);
      await freshJUSD.approve(hubWithZeroWCBTC.getAddress(), await hubWithZeroWCBTC.OPENING_FEE());

      // ERC20 deposit should succeed (no msg.value)
      const tx = await hubWithZeroWCBTC.openPosition(
        wcbtc.getAddress(),
        minCollateral,
        initialCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        liqPrice,
        reservePPM
        // No msg.value - ERC20 transfer
      );

      const positionAddr = await getPositionAddressFromTX(tx);
      expect(await wcbtc.balanceOf(positionAddr)).to.equal(initialCollateral);
    });
  });

  describe("Native Coin Support in adjust() Functions", () => {
    let wcbtcPositionAddr: string;
    let wcbtcPositionContract: Position;
    let volPositionAddr: string;
    let volPositionContract: Position;

    before(async () => {
      // Create a WCBTC position
      const initialCollateral = floatToDec18(10);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      let tx = await mintingHub.openPosition(
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

      wcbtcPositionAddr = await getPositionAddressFromTX(tx);
      wcbtcPositionContract = await ethers.getContractAt("Position", wcbtcPositionAddr);

      await evm_increaseTimeTo(await wcbtcPositionContract.start());
      await wcbtcPositionContract.mint(owner.address, floatToDec18(100_000));

      // Create a non-WCBTC (VOL) position
      const volCollateral = floatToDec18(100);
      await mockVOL.mint(owner.address, volCollateral);
      await mockVOL.approve(mintingHub.getAddress(), volCollateral);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      tx = await mintingHub.openPosition(
        mockVOL.getAddress(),
        floatToDec18(10), // minCollateral
        volCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        floatToDec18(1000), // VOL price
        reservePPM
      );

      volPositionAddr = await getPositionAddressFromTX(tx);
      volPositionContract = await ethers.getContractAt("Position", volPositionAddr);

      await evm_increaseTimeTo(await volPositionContract.start());
      await volPositionContract.mint(owner.address, floatToDec18(10_000));
    });

    it("should add native collateral via adjust()", async () => {
      const nativeDeposit = floatToDec18(2);
      const wcbtcBefore = await wcbtc.balanceOf(wcbtcPositionAddr);
      const currentPrincipal = await wcbtcPositionContract.principal();
      const currentPrice = await wcbtcPositionContract.price();

      // Add collateral via adjust with native deposit
      const newCollateral = wcbtcBefore + nativeDeposit;
      await wcbtcPositionContract.adjust(
        currentPrincipal,
        newCollateral,
        currentPrice,
        false,
        { value: nativeDeposit }
      );

      const wcbtcAfter = await wcbtc.balanceOf(wcbtcPositionAddr);
      expect(wcbtcAfter).to.equal(newCollateral);
    });

    it("should add native collateral via adjustWithReference()", async () => {
      // First create a reference position for cooldown-free price adjustment
      const refCollateral = floatToDec18(10);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      const tx = await mintingHub.openPosition(
        wcbtc.getAddress(),
        minCollateral,
        refCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        liqPrice,
        reservePPM,
        { value: refCollateral }
      );

      const refAddr = await getPositionAddressFromTX(tx);
      const refContract = await ethers.getContractAt("Position", refAddr);
      await evm_increaseTimeTo(await refContract.start());
      await refContract.mint(owner.address, floatToDec18(50_000));

      // Now use adjustWithReference with native deposit
      const nativeDeposit = floatToDec18(1);
      const wcbtcBefore = await wcbtc.balanceOf(refAddr);
      const currentPrincipal = await refContract.principal();
      const currentPrice = await refContract.price();
      const newCollateral = wcbtcBefore + nativeDeposit;

      await refContract.adjustWithReference(
        currentPrincipal,
        newCollateral,
        currentPrice,
        wcbtcPositionAddr, // Use existing position as reference
        false,
        { value: nativeDeposit }
      );

      const wcbtcAfter = await wcbtc.balanceOf(refAddr);
      expect(wcbtcAfter).to.equal(newCollateral);
    });

    it("should revert when sending msg.value to non-WCBTC position in adjust()", async () => {
      const currentCollateral = await mockVOL.balanceOf(volPositionAddr);
      const currentPrincipal = await volPositionContract.principal();
      const currentPrice = await volPositionContract.price();

      // Try to adjust with native deposit on non-WCBTC position
      // Should revert because VOL doesn't have deposit() function
      await expect(
        volPositionContract.adjust(
          currentPrincipal,
          currentCollateral,
          currentPrice,
          false,
          { value: floatToDec18(1) }
        )
      ).to.be.reverted;
    });

    it("should allow hybrid deposit (msg.value + ERC20 transferFrom)", async () => {
      // Get some WCBTC as ERC20
      const erc20Amount = floatToDec18(1);
      const nativeAmount = floatToDec18(1);
      await wcbtc.deposit({ value: erc20Amount });
      await wcbtc.approve(wcbtcPositionAddr, erc20Amount);

      const wcbtcBefore = await wcbtc.balanceOf(wcbtcPositionAddr);
      const currentPrincipal = await wcbtcPositionContract.principal();
      const currentPrice = await wcbtcPositionContract.price();

      // Add both native and ERC20 collateral
      // msg.value = 1 WCBTC (native), and transferFrom needs another 1 WCBTC
      const newCollateral = wcbtcBefore + nativeAmount + erc20Amount;

      await wcbtcPositionContract.adjust(
        currentPrincipal,
        newCollateral,
        currentPrice,
        false,
        { value: nativeAmount }
      );

      const wcbtcAfter = await wcbtc.balanceOf(wcbtcPositionAddr);
      expect(wcbtcAfter).to.equal(newCollateral);
    });

    it("should allow adjust without msg.value (ERC20 only)", async () => {
      // Get WCBTC as ERC20
      const erc20Amount = floatToDec18(1);
      await wcbtc.deposit({ value: erc20Amount });
      await wcbtc.approve(wcbtcPositionAddr, erc20Amount);

      const wcbtcBefore = await wcbtc.balanceOf(wcbtcPositionAddr);
      const currentPrincipal = await wcbtcPositionContract.principal();
      const currentPrice = await wcbtcPositionContract.price();
      const newCollateral = wcbtcBefore + erc20Amount;

      // No msg.value - pure ERC20 transfer
      await wcbtcPositionContract.adjust(
        currentPrincipal,
        newCollateral,
        currentPrice,
        false
      );

      const wcbtcAfter = await wcbtc.balanceOf(wcbtcPositionAddr);
      expect(wcbtcAfter).to.equal(newCollateral);
    });

    it("should withdraw collateral as native coin via adjust() with withdrawAsNative=true", async () => {
      const withdrawAmount = floatToDec18(1);
      const wcbtcBefore = await wcbtc.balanceOf(wcbtcPositionAddr);
      const currentPrincipal = await wcbtcPositionContract.principal();
      const currentPrice = await wcbtcPositionContract.price();
      const nativeBefore = await ethers.provider.getBalance(owner.address);

      // Withdraw collateral as native
      const newCollateral = wcbtcBefore - withdrawAmount;
      const tx = await wcbtcPositionContract.adjust(
        currentPrincipal,
        newCollateral,
        currentPrice,
        true // withdrawAsNative = true
      );
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const wcbtcAfter = await wcbtc.balanceOf(wcbtcPositionAddr);
      const nativeAfter = await ethers.provider.getBalance(owner.address);

      expect(wcbtcAfter).to.equal(newCollateral);
      expect(nativeAfter).to.equal(nativeBefore + withdrawAmount - gasUsed);
    });

    it("should withdraw collateral as ERC20 via adjust() with withdrawAsNative=false", async () => {
      const withdrawAmount = floatToDec18(1);
      const wcbtcBefore = await wcbtc.balanceOf(wcbtcPositionAddr);
      const currentPrincipal = await wcbtcPositionContract.principal();
      const currentPrice = await wcbtcPositionContract.price();
      const ownerWcbtcBefore = await wcbtc.balanceOf(owner.address);

      // Withdraw collateral as ERC20
      const newCollateral = wcbtcBefore - withdrawAmount;
      await wcbtcPositionContract.adjust(
        currentPrincipal,
        newCollateral,
        currentPrice,
        false // withdrawAsNative = false
      );

      const wcbtcAfter = await wcbtc.balanceOf(wcbtcPositionAddr);
      const ownerWcbtcAfter = await wcbtc.balanceOf(owner.address);

      expect(wcbtcAfter).to.equal(newCollateral);
      expect(ownerWcbtcAfter).to.equal(ownerWcbtcBefore + withdrawAmount);
    });

    it("should withdraw collateral as native via adjustWithReference() with withdrawAsNative=true", async () => {
      // First create a reference position
      const refCollateral = floatToDec18(10);
      await JUSD.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

      const tx = await mintingHub.openPosition(
        wcbtc.getAddress(),
        minCollateral,
        refCollateral,
        initialLimit,
        initPeriod,
        duration,
        challengePeriod,
        riskPremiumPPM,
        floatToDec18(100_000),
        reservePPM,
        { value: refCollateral }
      );
      const receipt = await tx.wait();
      const positionCreatedEvent = receipt?.logs.find(
        (log: any) => log.fragment?.name === "PositionOpened"
      ) as EventLog;
      const refAddr = positionCreatedEvent.args[1];
      const refContract = await ethers.getContractAt("Position", refAddr);

      // Wait for initialization period
      await evm_increaseTimeTo(await refContract.start());
      await refContract.mint(owner.address, floatToDec18(50_000));

      // Now withdraw via adjustWithReference with native
      const withdrawAmount = floatToDec18(1);
      const wcbtcBefore = await wcbtc.balanceOf(refAddr);
      const currentPrincipal = await refContract.principal();
      const currentPrice = await refContract.price();
      const nativeBefore = await ethers.provider.getBalance(owner.address);

      const newCollateral = wcbtcBefore - withdrawAmount;
      const txAdj = await refContract.adjustWithReference(
        currentPrincipal,
        newCollateral,
        currentPrice,
        wcbtcPositionAddr,
        true // withdrawAsNative
      );
      const receiptAdj = await txAdj.wait();
      const gasUsed = receiptAdj!.gasUsed * receiptAdj!.gasPrice;

      const wcbtcAfter = await wcbtc.balanceOf(refAddr);
      const nativeAfter = await ethers.provider.getBalance(owner.address);

      expect(wcbtcAfter).to.equal(newCollateral);
      expect(nativeAfter).to.equal(nativeBefore + withdrawAmount - gasUsed);
    });

    it("should close position when native withdrawal via adjust() leaves balance < minimumCollateral", async () => {
      // Repay all debt first
      const debt = await wcbtcPositionContract.getDebt();
      await JUSD.approve(wcbtcPositionAddr, debt + floatToDec18(1000));
      await wcbtcPositionContract.adjust(0, await wcbtc.balanceOf(wcbtcPositionAddr), await wcbtcPositionContract.price(), false);

      // Withdraw most collateral via adjust with native, leaving less than minimumCollateral
      const balance = await wcbtc.balanceOf(wcbtcPositionAddr);
      const newBalance = floatToDec18(0.5); // Leave 0.5, less than minColl of 1

      await wcbtcPositionContract.adjust(0, newBalance, await wcbtcPositionContract.price(), true);

      expect(await wcbtcPositionContract.isClosed()).to.be.true;
    });
  });
});
