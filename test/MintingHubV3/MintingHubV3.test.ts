import { expect } from "chai";
import { floatToDec18 } from "../../scripts/utils/math";
import { ethers } from "hardhat";
import { evm_increaseTime } from "../utils";
import {
  Equity,
  DecentralizedEURO,
  StablecoinBridge,
  TestToken,
} from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ContractTransactionResponse } from "ethers";

// MintingHubV3 specific imports
import { MintingHub as MintingHubV3 } from "../../typechain/contracts/MintingHubV3/MintingHub";
import { Position as PositionV3 } from "../../typechain/contracts/MintingHubV3/Position";
import { PositionRoller as PositionRollerV3 } from "../../typechain/contracts/MintingHubV3/PositionRoller";
import { PositionFactory as PositionFactoryV3 } from "../../typechain/contracts/MintingHubV3/PositionFactory";

const weeks = 30;

const getPositionAddressFromTX = async (
  tx: ContractTransactionResponse
): Promise<string> => {
  const PositionOpenedTopic =
    "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175";
  const rc = await tx.wait();
  const log = rc?.logs.find((x) => x.topics.indexOf(PositionOpenedTopic) >= 0);
  return "0x" + log?.topics[2].substring(26);
};

describe("MintingHub V3 Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let dEURO: DecentralizedEURO;
  let mintingHub: MintingHubV3;
  let bridge: StablecoinBridge;
  let roller: PositionRollerV3;
  let equity: Equity;
  let mockVOL: TestToken;
  let mockXEUR: TestToken;
  let mockWETH: TestToken; // Mock WETH for testing

  let limit: bigint;

  before(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    // Deploy DecentralizedEURO
    const DecentralizedEUROFactory =
      await ethers.getContractFactory("DecentralizedEURO");
    dEURO = await DecentralizedEUROFactory.deploy(10 * 86400);
    equity = await ethers.getContractAt("Equity", await dEURO.reserve());

    // Deploy V3 Position Factory
    const positionFactoryFactory = await ethers.getContractFactory(
      "contracts/MintingHubV3/PositionFactory.sol:PositionFactory"
    );
    const positionFactory = await positionFactoryFactory.deploy();

    // Deploy mock WETH
    const testTokenFactory = await ethers.getContractFactory("TestToken");
    mockWETH = await testTokenFactory.deploy("Wrapped Ether", "WETH", 18);

    // Deploy mock Leadrate
    const leadrateFactory = await ethers.getContractFactory("Savings");
    const leadrate = await leadrateFactory.deploy(dEURO.getAddress(), 0n);

    // Deploy V3 Position Roller
    const rollerFactory = await ethers.getContractFactory(
      "contracts/MintingHubV3/PositionRoller.sol:PositionRoller"
    );
    roller = await rollerFactory.deploy(dEURO.getAddress());

    // Deploy V3 Minting Hub
    const mintingHubFactory = await ethers.getContractFactory(
      "contracts/MintingHubV3/MintingHub.sol:MintingHub"
    );
    mintingHub = await mintingHubFactory.deploy(
      await dEURO.getAddress(),
      await leadrate.getAddress(),
      await roller.getAddress(),
      await positionFactory.getAddress(),
      await mockWETH.getAddress()
    );

    // Deploy mock tokens
    mockXEUR = await testTokenFactory.deploy("CryptoFranc", "XEUR", 18);
    mockVOL = await testTokenFactory.deploy("Volatile Token", "VOL", 18);

    // Bootstrap with bridge
    limit = floatToDec18(1_000_000);
    const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
    bridge = await bridgeFactory.deploy(
      await mockXEUR.getAddress(),
      await dEURO.getAddress(),
      limit,
      weeks
    );

    // Initialize minters
    await dEURO.initialize(await bridge.getAddress(), "XEUR Bridge");
    await dEURO.initialize(await mintingHub.getAddress(), "MintingHub V3");
    await dEURO.initialize(await roller.getAddress(), "Roller V3");

    await evm_increaseTime(60);

    // Mint test tokens
    await mockXEUR.mint(owner.address, limit / 3n);
    await mockXEUR.mint(alice.address, limit / 3n);
    await mockXEUR.mint(bob.address, limit / 3n);

    // Mint dEURO via bridge
    let amount = floatToDec18(100_000);
    await mockXEUR.connect(owner).approve(await bridge.getAddress(), amount);
    await bridge.connect(owner).mint(amount);
    await mockXEUR.connect(alice).approve(await bridge.getAddress(), amount);
    await bridge.connect(alice).mint(amount);
    await mockXEUR.connect(bob).approve(await bridge.getAddress(), amount);
    await bridge.connect(bob).mint(amount);

    // Mint VOL tokens
    amount = floatToDec18(500_000);
    await mockVOL.mint(owner.address, amount);
    await mockVOL.mint(alice.address, amount);
    await mockVOL.mint(bob.address, amount);

    // Mint WETH tokens
    await mockWETH.mint(owner.address, amount);
    await mockWETH.mint(alice.address, amount);
  });

  describe("Basic Position Operations", () => {
    let collateral: string;
    let fliqPrice = floatToDec18(5000);
    let minCollateral = floatToDec18(1);
    let fInitialCollateral = floatToDec18(110);
    let duration = 60n * 86_400n;
    let fFees = BigInt(0.01 * 1_000_000);
    let fReserve = BigInt(0.1 * 1_000_000);
    let challengePeriod = BigInt(3 * 86400);
    let initPeriod = BigInt(3 * 86400);

    before(async () => {
      collateral = await mockVOL.getAddress();
    });

    it("should create a genesis position with short init period", async () => {
      await mockVOL
        .connect(owner)
        .approve(await mintingHub.getAddress(), fInitialCollateral);
      await dEURO
        .connect(owner)
        .approve(await mintingHub.getAddress(), floatToDec18(1001));

      // Genesis position can have init period < 3 days (but > 0 due to price check)
      const tx = await mintingHub.openPosition(
        collateral,
        minCollateral,
        fInitialCollateral,
        floatToDec18(550_000),
        86400, // 1 day - allowed for genesis
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve
      );

      const positionAddr = await getPositionAddressFromTX(tx);
      expect(positionAddr).to.not.equal(ethers.ZeroAddress);
    });

    it("should revert position opening when init period < 3 days (non-genesis)", async () => {
      await mockVOL
        .connect(alice)
        .approve(await mintingHub.getAddress(), fInitialCollateral);
      await dEURO
        .connect(alice)
        .approve(await mintingHub.getAddress(), floatToDec18(1001));

      await expect(
        mintingHub.connect(alice).openPosition(
          collateral,
          minCollateral,
          fInitialCollateral,
          floatToDec18(550_000),
          86400 * 2, // Only 2 days
          duration,
          challengePeriod,
          fFees,
          fliqPrice,
          fReserve
        )
      ).to.be.revertedWithCustomError(mintingHub, "InitPeriodTooShort");
    });

    it("should create a regular position with 3-day init period", async () => {
      await mockVOL
        .connect(alice)
        .approve(await mintingHub.getAddress(), fInitialCollateral);
      await dEURO
        .connect(alice)
        .approve(await mintingHub.getAddress(), floatToDec18(1001));

      const tx = await mintingHub.connect(alice).openPosition(
        collateral,
        minCollateral,
        fInitialCollateral,
        floatToDec18(550_000),
        initPeriod,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve
      );

      const positionAddr = await getPositionAddressFromTX(tx);
      expect(positionAddr).to.not.equal(ethers.ZeroAddress);
    });

    it("should verify WETH address in MintingHub", async () => {
      const wethAddr = await mintingHub.WETH();
      expect(wethAddr).to.equal(await mockWETH.getAddress());
    });
  });

  describe("Price Reference System", () => {
    let position1Addr: string;
    let position2Addr: string;
    let position1: PositionV3;
    let position2: PositionV3;
    let collateral: string;
    let fliqPrice = floatToDec18(5000);
    let minCollateral = floatToDec18(1);
    let fInitialCollateral = floatToDec18(110);
    let duration = 60n * 86_400n;
    let fFees = BigInt(0.01 * 1_000_000);
    let fReserve = BigInt(0.1 * 1_000_000);
    let challengePeriod = BigInt(3 * 86400);
    let initPeriod = BigInt(3 * 86400);

    before(async () => {
      collateral = await mockVOL.getAddress();

      // Create first position
      await mockVOL
        .connect(owner)
        .approve(await mintingHub.getAddress(), fInitialCollateral);
      await dEURO
        .connect(owner)
        .approve(await mintingHub.getAddress(), floatToDec18(1001));

      const tx1 = await mintingHub.openPosition(
        collateral,
        minCollateral,
        fInitialCollateral,
        floatToDec18(550_000),
        initPeriod,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve
      );
      position1Addr = await getPositionAddressFromTX(tx1);
      position1 = await ethers.getContractAt(
        "contracts/MintingHubV3/Position.sol:Position",
        position1Addr
      );

      // Wait for init period and mint some dEURO
      await evm_increaseTime(3 * 86400 + 1);
      await dEURO.connect(owner).approve(position1Addr, floatToDec18(100));
      await position1.mint(owner.address, floatToDec18(1000));

      // Create second position
      await mockVOL
        .connect(alice)
        .approve(await mintingHub.getAddress(), fInitialCollateral);
      await dEURO
        .connect(alice)
        .approve(await mintingHub.getAddress(), floatToDec18(1001));

      const tx2 = await mintingHub.connect(alice).openPosition(
        collateral,
        minCollateral,
        fInitialCollateral,
        floatToDec18(550_000),
        initPeriod,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve
      );
      position2Addr = await getPositionAddressFromTX(tx2);
      position2 = await ethers.getContractAt(
        "contracts/MintingHubV3/Position.sol:Position",
        position2Addr
      );

      // Wait for init period
      await evm_increaseTime(3 * 86400 + 1);
    });

    it("should validate reference position correctly", async () => {
      // Position1 should be valid reference for position2 at same price
      const isValid = await position2.isValidPriceReference(
        position1Addr,
        fliqPrice
      );
      expect(isValid).to.be.true;
    });

    it("should reject self as reference", async () => {
      const isValid = await position1.isValidPriceReference(
        position1Addr,
        fliqPrice
      );
      expect(isValid).to.be.false;
    });

    it("should reject reference with higher price", async () => {
      const higherPrice = floatToDec18(6000);
      const isValid = await position2.isValidPriceReference(
        position1Addr,
        higherPrice
      );
      expect(isValid).to.be.false;
    });
  });

  describe("Interest Accrual", () => {
    let positionAddr: string;
    let position: PositionV3;
    let collateral: string;
    let fliqPrice = floatToDec18(5000);
    let minCollateral = floatToDec18(1);
    let fInitialCollateral = floatToDec18(110);
    let duration = 365n * 86_400n;
    let fFees = BigInt(0.05 * 1_000_000); // 5% risk premium
    let fReserve = BigInt(0.2 * 1_000_000);
    let challengePeriod = BigInt(3 * 86400);
    let initPeriod = BigInt(3 * 86400);

    before(async () => {
      collateral = await mockVOL.getAddress();

      await mockVOL
        .connect(bob)
        .approve(await mintingHub.getAddress(), fInitialCollateral);
      await dEURO
        .connect(bob)
        .approve(await mintingHub.getAddress(), floatToDec18(1001));

      const tx = await mintingHub.connect(bob).openPosition(
        collateral,
        minCollateral,
        fInitialCollateral,
        floatToDec18(550_000),
        initPeriod,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve
      );
      positionAddr = await getPositionAddressFromTX(tx);
      position = await ethers.getContractAt(
        "contracts/MintingHubV3/Position.sol:Position",
        positionAddr
      );

      // Wait for init period
      await evm_increaseTime(3 * 86400 + 1);

      // Mint some dEURO
      await position.connect(bob).mint(bob.address, floatToDec18(10000));
    });

    it("should track principal correctly", async () => {
      const principal = await position.principal();
      expect(principal).to.equal(floatToDec18(10000));
    });

    it("should accrue interest over time", async () => {
      // Check initial interest
      const initialInterest = await position.getInterest();

      // Wait 30 days
      await evm_increaseTime(30 * 86400);

      // Interest should have accrued
      const laterInterest = await position.getInterest();
      expect(laterInterest).to.be.gt(initialInterest);
    });

    it("should calculate debt correctly", async () => {
      const principal = await position.principal();
      const interest = await position.getInterest();
      const debt = await position.getDebt();

      expect(debt).to.equal(principal + interest);
    });
  });

  describe("Token Rescue", () => {
    let positionAddr: string;
    let position: PositionV3;
    let collateral: string;
    let randomToken: TestToken;
    let fliqPrice = floatToDec18(5000);
    let minCollateral = floatToDec18(1);
    let fInitialCollateral = floatToDec18(110);
    let duration = 60n * 86_400n;
    let fFees = BigInt(0.01 * 1_000_000);
    let fReserve = BigInt(0.1 * 1_000_000);
    let challengePeriod = BigInt(3 * 86400);
    let initPeriod = BigInt(3 * 86400);

    before(async () => {
      collateral = await mockVOL.getAddress();

      // Deploy a random token
      const testTokenFactory = await ethers.getContractFactory("TestToken");
      randomToken = await testTokenFactory.deploy("Random", "RND", 18);

      await mockVOL
        .connect(owner)
        .approve(await mintingHub.getAddress(), fInitialCollateral);
      await dEURO
        .connect(owner)
        .approve(await mintingHub.getAddress(), floatToDec18(1001));

      const tx = await mintingHub.openPosition(
        collateral,
        minCollateral,
        fInitialCollateral,
        floatToDec18(550_000),
        initPeriod,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve
      );
      positionAddr = await getPositionAddressFromTX(tx);
      position = await ethers.getContractAt(
        "contracts/MintingHubV3/Position.sol:Position",
        positionAddr
      );

      // Send random token to position
      await randomToken.mint(positionAddr, floatToDec18(100));
    });

    it("should rescue random tokens", async () => {
      const balanceBefore = await randomToken.balanceOf(owner.address);
      await position.rescueToken(
        await randomToken.getAddress(),
        owner.address,
        floatToDec18(100)
      );
      const balanceAfter = await randomToken.balanceOf(owner.address);

      expect(balanceAfter - balanceBefore).to.equal(floatToDec18(100));
    });

    it("should revert when trying to rescue collateral", async () => {
      await expect(
        position.rescueToken(collateral, owner.address, floatToDec18(1))
      ).to.be.revertedWithCustomError(position, "CannotRescueCollateral");
    });
  });
});
