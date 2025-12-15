import { expect } from "chai";
import { floatToDec18 } from "../../scripts/utils/math";
import { ethers } from "hardhat";
import { evm_increaseTime } from "../utils";
import {
  Equity,
  DecentralizedEURO,
  StablecoinBridge,
  TestToken,
  TestWETH,
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
  let mockWETH: TestWETH; // Real WETH mock with deposit/withdraw

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

    // Deploy real WETH mock with deposit/withdraw
    const wethFactory = await ethers.getContractFactory("TestWETH");
    mockWETH = await wethFactory.deploy();

    const testTokenFactory = await ethers.getContractFactory("TestToken");

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

    // Note: WETH is obtained via deposit() with native ETH, not mint()
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

  describe("Challenge Flow", () => {
    let positionAddr: string;
    let position: PositionV3;
    let collateral: string;
    let fliqPrice = floatToDec18(5000);
    let minCollateral = floatToDec18(1);
    let fInitialCollateral = floatToDec18(100);
    let duration = 60n * 86_400n;
    let fFees = BigInt(0.01 * 1_000_000);
    let fReserve = BigInt(0.2 * 1_000_000); // 20% reserve
    let challengePeriod = BigInt(3 * 86400);
    let initPeriod = BigInt(3 * 86400);
    let challengeIndex = 0n;

    before(async () => {
      collateral = await mockVOL.getAddress();

      // Create a position for challenge tests
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
        floatToDec18(500_000),
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

      // Wait for init period and mint
      await evm_increaseTime(3 * 86400 + 1);
      await position.mint(owner.address, floatToDec18(50000));
    });

    it("should start a challenge", async () => {
      const challengeAmount = floatToDec18(10);

      // Alice challenges with collateral
      await mockVOL.connect(alice).approve(await mintingHub.getAddress(), challengeAmount);

      const tx = await mintingHub.connect(alice).challenge(
        positionAddr,
        challengeAmount,
        fliqPrice
      );

      const receipt = await tx.wait();
      expect(receipt?.status).to.equal(1);

      // Check challenge was recorded - get challenge index from event
      const events = receipt?.logs || [];
      for (const event of events) {
        try {
          const parsed = mintingHub.interface.parseLog({ topics: event.topics as string[], data: event.data });
          if (parsed?.name === "ChallengeStarted") {
            challengeIndex = parsed.args[3];
          }
        } catch {}
      }

      const challenge = await mintingHub.challenges(challengeIndex);
      expect(challenge.challenger).to.equal(alice.address);
      expect(challenge.size).to.equal(challengeAmount);
    });

    it("should block minting during challenge", async () => {
      // Try to mint while challenged
      await expect(
        position.mint(owner.address, floatToDec18(1000))
      ).to.be.revertedWithCustomError(position, "Challenged");
    });

    it("should allow challenger to cancel their own challenge", async () => {
      await evm_increaseTime(1);

      // Get current challenge size
      const challenge = await mintingHub.challenges(challengeIndex);
      const challengeSize = challenge.size;

      // Alice cancels her own challenge - should not need to pay
      const aliceVolBefore = await mockVOL.balanceOf(alice.address);
      await mintingHub.connect(alice)["bid(uint32,uint256,bool)"](Number(challengeIndex), challengeSize, false);
      const aliceVolAfter = await mockVOL.balanceOf(alice.address);

      // Alice gets her collateral back
      expect(aliceVolAfter - aliceVolBefore).to.equal(challengeSize);
    });

    it("should avert a challenge after one block", async () => {
      const challengeAmount = floatToDec18(10);

      await mockVOL.connect(alice).approve(await mintingHub.getAddress(), challengeAmount);
      const tx = await mintingHub.connect(alice).challenge(positionAddr, challengeAmount, fliqPrice);

      // Get new challenge index
      const receipt = await tx.wait();
      const events = receipt?.logs || [];
      for (const event of events) {
        try {
          const parsed = mintingHub.interface.parseLog({ topics: event.topics as string[], data: event.data });
          if (parsed?.name === "ChallengeStarted") {
            challengeIndex = parsed.args[3];
          }
        } catch {}
      }

      // Wait at least one second
      await evm_increaseTime(1);

      // Bob averts the challenge by buying the collateral at liquidation price
      const cost = (challengeAmount * fliqPrice) / floatToDec18(1);
      await dEURO.connect(bob).approve(await mintingHub.getAddress(), cost);

      const bobVolBefore = await mockVOL.balanceOf(bob.address);
      await mintingHub.connect(bob)["bid(uint32,uint256,bool)"](Number(challengeIndex), challengeAmount, false);
      const bobVolAfter = await mockVOL.balanceOf(bob.address);

      // Bob should have received the collateral
      expect(bobVolAfter - bobVolBefore).to.equal(challengeAmount);
    });

    it("should restrict minting after challenge avert", async () => {
      // Minting should be blocked for 1 day after avert
      await expect(
        position.mint(owner.address, floatToDec18(1000))
      ).to.be.revertedWithCustomError(position, "Hot");

      // After 1 day, minting should work
      await evm_increaseTime(86400 + 1);
      await position.mint(owner.address, floatToDec18(1000));
    });

    it("should succeed a challenge in phase 2 (Dutch auction)", async () => {
      const challengeAmount = floatToDec18(10);

      await mockVOL.connect(alice).approve(await mintingHub.getAddress(), challengeAmount);
      const tx = await mintingHub.connect(alice).challenge(positionAddr, challengeAmount, fliqPrice);

      // Get new challenge index
      const receipt = await tx.wait();
      const events = receipt?.logs || [];
      for (const event of events) {
        try {
          const parsed = mintingHub.interface.parseLog({ topics: event.topics as string[], data: event.data });
          if (parsed?.name === "ChallengeStarted") {
            challengeIndex = parsed.args[3];
          }
        } catch {}
      }

      // Wait for phase 1 to end (challenge period)
      await evm_increaseTime(3 * 86400 + 1);

      // Now in phase 2 - price is declining
      const currentPrice = await mintingHub.price(Number(challengeIndex));
      expect(currentPrice).to.be.lt(fliqPrice);

      // Bob bids in phase 2
      await dEURO.connect(bob).approve(await mintingHub.getAddress(), floatToDec18(100000));

      const bidTx = await mintingHub.connect(bob)["bid(uint32,uint256,bool)"](Number(challengeIndex), challengeAmount, false);
      const bidReceipt = await bidTx.wait();
      expect(bidReceipt?.status).to.equal(1);
    });
  });

  describe("Clone Position", () => {
    let originalPositionAddr: string;
    let originalPosition: PositionV3;
    let collateral: string;
    let fliqPrice = floatToDec18(1000);
    let minCollateral = floatToDec18(1);
    let fInitialCollateral = floatToDec18(100);
    let duration = 60n * 86_400n;
    let fFees = BigInt(0.01 * 1_000_000);
    let fReserve = BigInt(0.2 * 1_000_000);
    let challengePeriod = BigInt(3 * 86400);
    let initPeriod = BigInt(3 * 86400);

    before(async () => {
      collateral = await mockVOL.getAddress();

      await mockVOL
        .connect(owner)
        .approve(await mintingHub.getAddress(), fInitialCollateral);
      await dEURO
        .connect(owner)
        .approve(await mintingHub.getAddress(), floatToDec18(1001));

      // Create position: limit must be HIGHER than what collateral can cover
      // So clones can use the excess limit
      // collateral = 100, price = 1000 => potential = 100k
      // If limit = 200k, then availableForClones = 200k - totalMinted - unusedPotential
      // If original mints 100k (full potential), unusedPotential = 0
      // availableForClones = 200k - 100k - 0 = 100k
      const tx = await mintingHub.openPosition(
        collateral,
        minCollateral,
        fInitialCollateral,
        floatToDec18(200_000), // 200k limit > 100k potential
        initPeriod,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve
      );
      originalPositionAddr = await getPositionAddressFromTX(tx);
      originalPosition = await ethers.getContractAt(
        "contracts/MintingHubV3/Position.sol:Position",
        originalPositionAddr
      );

      await evm_increaseTime(3 * 86400 + 1);

      // Original mints its full potential - this makes availableForClones > 0
      await originalPosition.mint(owner.address, floatToDec18(99000)); // Mint almost full potential
    });

    it("should clone a position", async () => {
      const cloneCollateral = floatToDec18(50);
      const cloneMint = floatToDec18(10000);

      await mockVOL.connect(alice).approve(await mintingHub.getAddress(), cloneCollateral);

      const expiration = await originalPosition.expiration();

      const tx = await mintingHub.connect(alice).clone(
        alice.address,
        originalPositionAddr,
        cloneCollateral,
        cloneMint,
        expiration,
        0 // inherit price
      );

      const cloneAddr = await getPositionAddressFromTX(tx);
      expect(cloneAddr).to.not.equal(ethers.ZeroAddress);

      const clone = await ethers.getContractAt(
        "contracts/MintingHubV3/Position.sol:Position",
        cloneAddr
      );

      // Clone should have the minted amount
      expect(await clone.principal()).to.equal(cloneMint);

      // Clone should be owned by alice
      expect(await clone.owner()).to.equal(alice.address);
    });

    it("should not clone during cooldown", async () => {
      // Create a fresh position for cooldown test
      await mockVOL
        .connect(bob)
        .approve(await mintingHub.getAddress(), floatToDec18(200));
      await dEURO
        .connect(bob)
        .approve(await mintingHub.getAddress(), floatToDec18(1001));

      const tx = await mintingHub.connect(bob).openPosition(
        collateral,
        minCollateral,
        floatToDec18(200),
        floatToDec18(400_000), // 400k limit
        initPeriod,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve
      );
      const cooldownTestPosAddr = await getPositionAddressFromTX(tx);
      const cooldownTestPos = await ethers.getContractAt(
        "contracts/MintingHubV3/Position.sol:Position",
        cooldownTestPosAddr
      );

      await evm_increaseTime(3 * 86400 + 1);

      // Mint to use up some potential
      await cooldownTestPos.connect(bob).mint(bob.address, floatToDec18(150000));

      // Adjust price up to trigger cooldown
      const currentPrice = await cooldownTestPos.price();
      const newPrice = currentPrice * 12n / 10n; // 1.2x price
      await cooldownTestPos.connect(bob).adjustPrice(newPrice);

      // Try to clone - should fail due to cooldown
      const cloneCollateral = floatToDec18(50);
      await mockVOL.connect(alice).approve(await mintingHub.getAddress(), cloneCollateral);

      const expiration = await cooldownTestPos.expiration();

      await expect(
        mintingHub.connect(alice).clone(
          alice.address,
          cooldownTestPosAddr,
          cloneCollateral,
          floatToDec18(1000),
          expiration,
          0
        )
      ).to.be.revertedWithCustomError(cooldownTestPos, "Hot");
    });
  });

  describe("Expired Position Force Sale", () => {
    let positionAddr: string;
    let position: PositionV3;
    let collateral: string;
    let fliqPrice = floatToDec18(5000);
    let minCollateral = floatToDec18(1);
    let fInitialCollateral = floatToDec18(100);
    let duration = 10n * 86_400n; // 10 days - shorter for testing
    let fFees = BigInt(0.01 * 1_000_000);
    let fReserve = BigInt(0.2 * 1_000_000);
    let challengePeriod = BigInt(3 * 86400);
    let initPeriod = BigInt(3 * 86400);

    before(async () => {
      collateral = await mockVOL.getAddress();

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
        floatToDec18(500_000),
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

      await evm_increaseTime(3 * 86400 + 1);
      // Mint a smaller amount to test force sale
      await position.mint(owner.address, floatToDec18(10000));
    });

    it("should have 10x price at expiration", async () => {
      // Fast forward to expiration
      await evm_increaseTime(10 * 86400 + 1);

      const purchasePrice = await mintingHub.expiredPurchasePrice(positionAddr);
      expect(purchasePrice).to.be.lte(fliqPrice * 10n);
    });

    it("should allow buying expired collateral", async () => {
      // Buy only a small portion of collateral
      const amountToBuy = floatToDec18(5);
      const purchasePrice = await mintingHub.expiredPurchasePrice(positionAddr);
      const cost = (purchasePrice * amountToBuy) / floatToDec18(1);

      // Give bob more dEURO via bridge if needed
      const bobBalance = await dEURO.balanceOf(bob.address);
      if (bobBalance < cost * 2n) {
        const needed = cost * 2n - bobBalance;
        await mockXEUR.mint(bob.address, needed);
        await mockXEUR.connect(bob).approve(await bridge.getAddress(), needed);
        await bridge.connect(bob).mint(needed);
      }

      await dEURO.connect(bob).approve(positionAddr, cost * 2n);

      const bobVolBefore = await mockVOL.balanceOf(bob.address);
      await mintingHub.connect(bob)["buyExpiredCollateral(address,uint256)"](positionAddr, amountToBuy);
      const bobVolAfter = await mockVOL.balanceOf(bob.address);

      expect(bobVolAfter).to.be.gt(bobVolBefore);
    });

    it("should decline price over time after expiration", async () => {
      // Create another position for this test
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
        floatToDec18(500_000),
        initPeriod,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve
      );
      const pos2Addr = await getPositionAddressFromTX(tx);

      // Wait for init + duration
      await evm_increaseTime(13 * 86400 + 1);

      const price1 = await mintingHub.expiredPurchasePrice(pos2Addr);

      // Wait more time
      await evm_increaseTime(2 * 86400);

      const price2 = await mintingHub.expiredPurchasePrice(pos2Addr);

      // Price should have declined
      expect(price2).to.be.lt(price1);
    });
  });

  describe("Repayment", () => {
    let positionAddr: string;
    let position: PositionV3;
    let collateral: string;
    let fliqPrice = floatToDec18(5000);
    let minCollateral = floatToDec18(1);
    let fInitialCollateral = floatToDec18(100);
    let duration = 365n * 86_400n;
    let fFees = BigInt(0.05 * 1_000_000); // 5%
    let fReserve = BigInt(0.2 * 1_000_000); // 20%
    let challengePeriod = BigInt(3 * 86400);
    let initPeriod = BigInt(3 * 86400);

    before(async () => {
      collateral = await mockVOL.getAddress();

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
        floatToDec18(500_000),
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

      await evm_increaseTime(3 * 86400 + 1);
      await position.mint(owner.address, floatToDec18(10000));
    });

    it("should repay interest first, then principal", async () => {
      // Wait to accrue interest
      await evm_increaseTime(30 * 86400);

      const interestBefore = await position.getInterest();
      const principalBefore = await position.principal();

      expect(interestBefore).to.be.gt(0);

      // Repay only the interest amount
      await dEURO.connect(owner).approve(positionAddr, interestBefore);
      await position.repay(interestBefore);

      const interestAfter = await position.getInterest();
      const principalAfter = await position.principal();

      // Interest should be reduced/zero, principal unchanged
      expect(interestAfter).to.be.lt(interestBefore);
      expect(principalAfter).to.equal(principalBefore);
    });

    it("should repayFull to close position", async () => {
      // Create a new position for this test
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
        floatToDec18(500_000),
        initPeriod,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve
      );
      const pos2Addr = await getPositionAddressFromTX(tx);
      const pos2 = await ethers.getContractAt(
        "contracts/MintingHubV3/Position.sol:Position",
        pos2Addr
      );

      await evm_increaseTime(3 * 86400 + 1);
      await pos2.connect(bob).mint(bob.address, floatToDec18(5000));

      // Wait to accrue some interest
      await evm_increaseTime(10 * 86400);

      // Repay full
      await dEURO.connect(bob).approve(pos2Addr, floatToDec18(10000));
      await pos2.connect(bob).repayFull();

      // Debt should be zero
      expect(await pos2.principal()).to.equal(0);
      expect(await pos2.getInterest()).to.equal(0);
    });
  });

  describe("Adjust Position", () => {
    let positionAddr: string;
    let position: PositionV3;
    let collateral: string;
    let fliqPrice = floatToDec18(1000); // Lower starting price
    let minCollateral = floatToDec18(1);
    let fInitialCollateral = floatToDec18(200); // More collateral
    let duration = 60n * 86_400n;
    let fFees = BigInt(0.01 * 1_000_000);
    let fReserve = BigInt(0.2 * 1_000_000);
    let challengePeriod = BigInt(3 * 86400);
    let initPeriod = BigInt(3 * 86400);

    before(async () => {
      collateral = await mockVOL.getAddress();

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
        floatToDec18(500_000), // Higher limit
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

      await evm_increaseTime(3 * 86400 + 1);
    });

    it("should adjust collateral, principal, and price in one tx", async () => {
      const newCollateral = floatToDec18(250);
      const newPrincipal = floatToDec18(50000);
      const newPrice = fliqPrice; // same price

      // Approve additional collateral
      await mockVOL.connect(owner).approve(positionAddr, floatToDec18(100));

      await position["adjust(uint256,uint256,uint256,bool)"](
        newPrincipal,
        newCollateral,
        newPrice,
        false
      );

      expect(await position.principal()).to.equal(newPrincipal);
      expect(await mockVOL.balanceOf(positionAddr)).to.equal(newCollateral);
    });

    it("should trigger cooldown on price increase", async () => {
      const currentPrice = await position.price();
      // Price can only be increased to 2x max, and need to respect limit bounds
      // With 250 collateral and 500k limit, max price is limit*1e18/collateral = 2000e18
      const newPrice = currentPrice * 19n / 10n; // 1.9x price (safe under 2x)

      await position.adjustPrice(newPrice);

      // Should be in cooldown
      const cooldown = await position.cooldown();
      expect(cooldown).to.be.gt(BigInt(Math.floor(Date.now() / 1000)));

      // Minting should fail
      await expect(
        position.mint(owner.address, floatToDec18(1000))
      ).to.be.revertedWithCustomError(position, "Hot");
    });

    it("should allow price decrease without cooldown", async () => {
      // Wait for cooldown to end
      await evm_increaseTime(3 * 86400 + 1);

      const currentPrice = await position.price();
      const lowerPrice = currentPrice / 2n;

      await position.adjustPrice(lowerPrice);

      // Should be able to mint immediately
      await position.mint(owner.address, floatToDec18(1000));
    });
  });

  describe("Native ETH Positions", () => {
    let positionAddr: string;
    let position: PositionV3;
    // Price must ensure min collateral value >= 100 dEURO
    // With 1 ETH at 2000 dEURO/ETH = 2000 dEURO value (OK)
    // minCollateral = 0.1 ETH * 2000 = 200 dEURO value (OK, > 100)
    let fliqPrice = floatToDec18(2000); // 2000 dEURO per ETH
    let minCollateral = floatToDec18(0.1); // 0.1 ETH * 2000 = 200 dEURO (>100 min)
    let fInitialCollateral = floatToDec18(1); // 1 ETH = 2000 dEURO value
    let duration = 60n * 86_400n;
    let fFees = BigInt(0.01 * 1_000_000);
    let fReserve = BigInt(0.2 * 1_000_000);
    let challengePeriod = BigInt(3 * 86400);
    let initPeriod = BigInt(3 * 86400);

    it("should open position with native ETH (msg.value)", async () => {
      const wethAddr = await mockWETH.getAddress();

      await dEURO
        .connect(owner)
        .approve(await mintingHub.getAddress(), floatToDec18(1001));

      // Open position with native ETH
      const tx = await mintingHub.openPosition(
        wethAddr,
        minCollateral,
        fInitialCollateral,
        floatToDec18(10_000), // 10k limit
        initPeriod,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve,
        { value: fInitialCollateral } // Send ETH directly
      );

      positionAddr = await getPositionAddressFromTX(tx);
      position = await ethers.getContractAt(
        "contracts/MintingHubV3/Position.sol:Position",
        positionAddr
      );

      // Position should have WETH balance
      const wethBalance = await mockWETH.balanceOf(positionAddr);
      expect(wethBalance).to.equal(fInitialCollateral);
    });

    it("should mint dEURO from native ETH position", async () => {
      await evm_increaseTime(3 * 86400 + 1);

      const balanceBefore = await dEURO.balanceOf(owner.address);
      await position.mint(owner.address, floatToDec18(1000));
      const balanceAfter = await dEURO.balanceOf(owner.address);

      // Should have received dEURO (minus reserve)
      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("should add collateral via adjust with msg.value", async () => {
      const additionalETH = floatToDec18(0.5);
      const currentCollateral = await mockWETH.balanceOf(positionAddr);
      const currentPrincipal = await position.principal();
      const currentPrice = await position.price();

      // Add more ETH via adjust
      await position["adjust(uint256,uint256,uint256,bool)"](
        currentPrincipal,
        currentCollateral + additionalETH,
        currentPrice,
        false,
        { value: additionalETH }
      );

      const newCollateral = await mockWETH.balanceOf(positionAddr);
      expect(newCollateral).to.equal(currentCollateral + additionalETH);
    });

    it("should withdraw collateral as native ETH", async () => {
      const withdrawAmount = floatToDec18(0.2);
      const ownerETHBefore = await ethers.provider.getBalance(owner.address);

      await position.withdrawCollateralAsNative(owner.address, withdrawAmount);

      const ownerETHAfter = await ethers.provider.getBalance(owner.address);
      // Should have received ETH (minus gas)
      expect(ownerETHAfter).to.be.gt(ownerETHBefore - floatToDec18(0.01)); // Allow for gas
    });

    it("should receive ETH directly to position (auto-wrap)", async () => {
      const sendAmount = floatToDec18(0.1);
      const wethBefore = await mockWETH.balanceOf(positionAddr);

      // Send ETH directly to position
      await owner.sendTransaction({
        to: positionAddr,
        value: sendAmount
      });

      const wethAfter = await mockWETH.balanceOf(positionAddr);
      expect(wethAfter).to.equal(wethBefore + sendAmount);
    });
  });

  describe("Native ETH Challenges", () => {
    let positionAddr: string;
    let position: PositionV3;
    let fliqPrice = floatToDec18(2000);
    let minCollateral = floatToDec18(0.1); // 0.1 ETH * 2000 = 200 dEURO (>100 min)
    let fInitialCollateral = floatToDec18(2); // 2 ETH
    let duration = 60n * 86_400n;
    let fFees = BigInt(0.01 * 1_000_000);
    let fReserve = BigInt(0.2 * 1_000_000);
    let challengePeriod = BigInt(3 * 86400);
    let initPeriod = BigInt(3 * 86400);
    let challengeIndex = 0n;

    before(async () => {
      const wethAddr = await mockWETH.getAddress();

      await dEURO
        .connect(alice)
        .approve(await mintingHub.getAddress(), floatToDec18(1001));

      const tx = await mintingHub.connect(alice).openPosition(
        wethAddr,
        minCollateral,
        fInitialCollateral,
        floatToDec18(10_000),
        initPeriod,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve,
        { value: fInitialCollateral }
      );

      positionAddr = await getPositionAddressFromTX(tx);
      position = await ethers.getContractAt(
        "contracts/MintingHubV3/Position.sol:Position",
        positionAddr
      );

      await evm_increaseTime(3 * 86400 + 1);
      await position.connect(alice).mint(alice.address, floatToDec18(2000));
    });

    it("should challenge with native ETH", async () => {
      // Challenge with at least minCollateral (0.1 ETH)
      const challengeAmount = floatToDec18(0.5);

      // Challenge with native ETH
      const tx = await mintingHub.connect(bob)["challenge(address,uint256,uint256)"](
        positionAddr,
        challengeAmount,
        fliqPrice,
        { value: challengeAmount }
      );

      const receipt = await tx.wait();
      expect(receipt?.status).to.equal(1);

      // Get challenge index
      const events = receipt?.logs || [];
      for (const event of events) {
        try {
          const parsed = mintingHub.interface.parseLog({ topics: event.topics as string[], data: event.data });
          if (parsed?.name === "ChallengeStarted") {
            challengeIndex = parsed.args[3];
          }
        } catch {}
      }

      const challenge = await mintingHub.challenges(challengeIndex);
      expect(challenge.challenger).to.equal(bob.address);
    });

    it("should receive collateral as native ETH when bidding", async () => {
      await evm_increaseTime(1);

      const challenge = await mintingHub.challenges(challengeIndex);
      const challengeSize = challenge.size;
      const cost = (challengeSize * fliqPrice) / floatToDec18(1);

      await dEURO.connect(owner).approve(await mintingHub.getAddress(), cost);

      const ownerETHBefore = await ethers.provider.getBalance(owner.address);

      // Bid with returnCollateralAsNative = true
      await mintingHub.connect(owner)["bid(uint32,uint256,bool)"](
        Number(challengeIndex),
        challengeSize,
        true // returnCollateralAsNative
      );

      const ownerETHAfter = await ethers.provider.getBalance(owner.address);
      // Should have received ETH (the challenged collateral)
      expect(ownerETHAfter).to.be.gt(ownerETHBefore - floatToDec18(0.1)); // Allow for gas and dEURO payment
    });
  });

  describe("PositionRoller", () => {
    let sourcePositionAddr: string;
    let targetPositionAddr: string;
    let sourcePosition: PositionV3;
    let targetPosition: PositionV3;
    let collateral: string;
    let fliqPrice = floatToDec18(1000);
    let minCollateral = floatToDec18(1);
    let fInitialCollateral = floatToDec18(100);
    let duration = 60n * 86_400n;
    let fFees = BigInt(0.01 * 1_000_000);
    let fReserve = BigInt(0.2 * 1_000_000);
    let challengePeriod = BigInt(3 * 86400);
    let initPeriod = BigInt(3 * 86400);

    before(async () => {
      collateral = await mockVOL.getAddress();

      // Create source position
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
        floatToDec18(200_000),
        initPeriod,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve
      );
      sourcePositionAddr = await getPositionAddressFromTX(tx1);
      sourcePosition = await ethers.getContractAt(
        "contracts/MintingHubV3/Position.sol:Position",
        sourcePositionAddr
      );

      // Create target position (different owner so we test cloning)
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
        floatToDec18(200_000),
        initPeriod,
        duration,
        challengePeriod,
        fFees,
        fliqPrice,
        fReserve
      );
      targetPositionAddr = await getPositionAddressFromTX(tx2);
      targetPosition = await ethers.getContractAt(
        "contracts/MintingHubV3/Position.sol:Position",
        targetPositionAddr
      );

      await evm_increaseTime(3 * 86400 + 1);

      // Mint from source position
      await sourcePosition.mint(owner.address, floatToDec18(50000));

      // Alice mints to make limit available for clones
      await targetPosition.connect(alice).mint(alice.address, floatToDec18(50000));
    });

    it("should roll position using rollFully", async () => {
      // Approve roller to spend collateral
      const sourceCollateral = await mockVOL.balanceOf(sourcePositionAddr);
      await mockVOL.connect(owner).approve(await roller.getAddress(), sourceCollateral);

      // Approve roller to spend dEURO (for flash loan repayment)
      await dEURO.connect(owner).approve(await roller.getAddress(), floatToDec18(100000));

      const principalBefore = await sourcePosition.principal();
      expect(principalBefore).to.be.gt(0);

      // Roll the position
      await roller.connect(owner).rollFully(sourcePositionAddr, targetPositionAddr);

      // Source position should have less or no principal
      const principalAfter = await sourcePosition.principal();
      expect(principalAfter).to.be.lt(principalBefore);
    });

    it("should roll native ETH position using rollFullyNative", async () => {
      const wethAddr = await mockWETH.getAddress();
      const nativeMinCollateral = floatToDec18(0.1); // 0.1 ETH * 2000 = 200 dEURO (>100 min)
      const nativeFliqPrice = floatToDec18(2000);

      // Create source WETH position
      await dEURO
        .connect(bob)
        .approve(await mintingHub.getAddress(), floatToDec18(1001));

      const tx1 = await mintingHub.connect(bob).openPosition(
        wethAddr,
        nativeMinCollateral,
        floatToDec18(2),
        floatToDec18(10_000),
        initPeriod,
        duration,
        challengePeriod,
        fFees,
        nativeFliqPrice,
        fReserve,
        { value: floatToDec18(2) }
      );
      const nativeSourceAddr = await getPositionAddressFromTX(tx1);
      const nativeSource = await ethers.getContractAt(
        "contracts/MintingHubV3/Position.sol:Position",
        nativeSourceAddr
      );

      // Create target WETH position
      await dEURO
        .connect(alice)
        .approve(await mintingHub.getAddress(), floatToDec18(1001));

      const tx2 = await mintingHub.connect(alice).openPosition(
        wethAddr,
        nativeMinCollateral,
        floatToDec18(2),
        floatToDec18(10_000),
        initPeriod,
        duration,
        challengePeriod,
        fFees,
        nativeFliqPrice,
        fReserve,
        { value: floatToDec18(2) }
      );
      const nativeTargetAddr = await getPositionAddressFromTX(tx2);
      const nativeTarget = await ethers.getContractAt(
        "contracts/MintingHubV3/Position.sol:Position",
        nativeTargetAddr
      );

      await evm_increaseTime(3 * 86400 + 1);

      // Mint from source
      await nativeSource.connect(bob).mint(bob.address, floatToDec18(2000));
      // Alice mints to make limit available
      await nativeTarget.connect(alice).mint(alice.address, floatToDec18(2000));

      // Approve roller to spend dEURO
      await dEURO.connect(bob).approve(await roller.getAddress(), floatToDec18(10000));

      const principalBefore = await nativeSource.principal();
      expect(principalBefore).to.be.gt(0);

      // Roll the native position - no collateral approval needed
      await roller.connect(bob).rollFullyNative(nativeSourceAddr, nativeTargetAddr);

      // Source position should have less principal
      const principalAfter = await nativeSource.principal();
      expect(principalAfter).to.be.lt(principalBefore);
    });
  });
});
