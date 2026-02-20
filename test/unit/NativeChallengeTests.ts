import { expect } from "chai";
import {
  floatToDec18,
  DECIMALS,
} from "../../scripts/utils/math";
import { ethers } from "hardhat";
import { evm_increaseTime, evm_increaseTimeTo } from "../utils";
import {
  DecentralizedEURO,
  MintingHub,
  Position,
  PositionRoller,
  StablecoinBridge,
  TestToken,
  TestWETH,
  RejectNative,
} from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ContractTransactionResponse } from "ethers";

const getPositionAddressFromTX = async (
  tx: ContractTransactionResponse,
): Promise<string> => {
  const PositionOpenedTopic =
    "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175";
  const rc = await tx.wait();
  const log = rc?.logs.find((x) => x.topics.indexOf(PositionOpenedTopic) >= 0);
  return "0x" + log?.topics[2].substring(26);
};

describe("Native Challenge Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let charles: HardhatEthersSigner;

  let dEURO: DecentralizedEURO;
  let mintingHub: MintingHub;
  let bridge: StablecoinBridge;
  let roller: PositionRoller;
  let weth: TestWETH;
  let mockXEUR: TestToken;
  let mockVOL: TestToken;
  let rejectNative: RejectNative;

  // Position params
  const initPeriod = 3n * 86400n;
  const duration = 60n * 86400n;
  const challengePeriod = 3n * 86400n;
  const liqPrice = floatToDec18(5000);
  const minCollateral = floatToDec18(1);
  const initialLimit = floatToDec18(550_000);
  const reservePPM = 100000n; // 10%
  const riskPremiumPPM = 10000n; // 1%
  const initialCollateral = floatToDec18(110);

  before(async () => {
    [owner, alice, bob, charles] = await ethers.getSigners();

    const DecentralizedEUROFactory = await ethers.getContractFactory("DecentralizedEURO");
    dEURO = await DecentralizedEUROFactory.deploy(10 * 86400);

    const positionFactoryFactory = await ethers.getContractFactory("PositionFactory");
    const positionFactory = await positionFactoryFactory.deploy();

    await ethers.getContractFactory("Savings");
    const savingsFactory = await ethers.getContractFactory("Savings");
    const savings = await savingsFactory.deploy(dEURO.getAddress(), 0n);

    const rollerFactory = await ethers.getContractFactory("PositionRoller");
    roller = await rollerFactory.deploy(dEURO.getAddress());

    weth = await (await ethers.getContractFactory("TestWETH")).deploy();

    const mintingHubFactory = await ethers.getContractFactory("MintingHub");
    mintingHub = await mintingHubFactory.deploy(
      await dEURO.getAddress(),
      0n,
      await roller.getAddress(),
      await positionFactory.getAddress(),
      await weth.getAddress(),
    );

    // Bootstrap dEURO
    const testTokenFactory = await ethers.getContractFactory("TestToken");
    mockXEUR = await testTokenFactory.deploy("CryptoFranc", "XEUR", 18);
    const limit = floatToDec18(1_000_000);
    const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
    bridge = await bridgeFactory.deploy(
      await mockXEUR.getAddress(),
      await dEURO.getAddress(),
      limit,
      30,
    );
    await dEURO.initialize(await bridge.getAddress(), "XEUR Bridge");
    await dEURO.initialize(await mintingHub.getAddress(), "Minting Hub");
    await dEURO.initialize(await savings.getAddress(), "Savings");
    await dEURO.initialize(await roller.getAddress(), "Roller");

    await evm_increaseTime(60);

    const mintAmount = floatToDec18(200_000);
    for (const signer of [owner, alice, bob, charles]) {
      await mockXEUR.mint(signer.address, mintAmount);
      await mockXEUR.connect(signer).approve(await bridge.getAddress(), mintAmount);
      await bridge.connect(signer).mint(mintAmount);
    }

    // VOL tokens for non-WETH tests
    mockVOL = await testTokenFactory.deploy("Volatile Token", "VOL", 18);
    await mockVOL.mint(owner.address, floatToDec18(500_000));

    // Deploy test helpers
    rejectNative = await (await ethers.getContractFactory("RejectNative")).deploy();
  });

  // Helper: open WETH position via native ETH
  async function openWethPositionNative(
    signer: HardhatEthersSigner,
    collAmount: bigint = initialCollateral,
  ): Promise<Position> {
    await dEURO.connect(signer).approve(await mintingHub.getAddress(), await mintingHub.OPENING_FEE());
    const tx = await mintingHub.connect(signer).openPosition(
      await weth.getAddress(),
      minCollateral,
      collAmount,
      initialLimit,
      initPeriod,
      duration,
      challengePeriod,
      riskPremiumPPM,
      liqPrice,
      reservePPM,
      { value: collAmount },
    );
    const addr = await getPositionAddressFromTX(tx);
    return ethers.getContractAt("Position", addr) as Promise<Position>;
  }

  // Helper: open non-WETH (VOL) position
  async function openVolPosition(): Promise<Position> {
    const collAmount = floatToDec18(110);
    await mockVOL.approve(await mintingHub.getAddress(), collAmount);
    await dEURO.approve(await mintingHub.getAddress(), await mintingHub.OPENING_FEE());
    const tx = await mintingHub.openPosition(
      await mockVOL.getAddress(),
      minCollateral,
      collAmount,
      initialLimit,
      initPeriod,
      duration,
      challengePeriod,
      riskPremiumPPM,
      liqPrice,
      reservePPM,
    );
    const addr = await getPositionAddressFromTX(tx);
    return ethers.getContractAt("Position", addr) as Promise<Position>;
  }

  // Helper: get challenge number from tx event
  async function getChallengeNumberFromTX(tx: ContractTransactionResponse): Promise<number> {
    const rc = await tx.wait();
    const iface = mintingHub.interface;
    const topicHash = iface.getEvent("ChallengeStarted")!.topicHash;
    const log = rc?.logs.find((x) => x.topics[0] === topicHash);
    const parsed = iface.parseLog({ topics: log!.topics as string[], data: log!.data });
    return Number(parsed!.args[3]); // 4th arg = number
  }

  // Helper: challenge a position with native and return the challenge number
  async function challengeWithNative(
    signer: HardhatEthersSigner,
    pos: Position,
    size: bigint,
  ): Promise<number> {
    const price = await pos.price();
    const tx = await mintingHub.connect(signer).challenge(
      await pos.getAddress(),
      size,
      price,
      { value: size },
    );
    return getChallengeNumberFromTX(tx);
  }

  // Helper: challenge a position with ERC20 WETH and return the challenge number
  async function challengeWithWETH(
    signer: HardhatEthersSigner,
    pos: Position,
    size: bigint,
  ): Promise<number> {
    await weth.connect(signer).deposit({ value: size });
    await weth.connect(signer).approve(await mintingHub.getAddress(), size);
    const price = await pos.price();
    const tx = await mintingHub.connect(signer).challenge(
      await pos.getAddress(),
      size,
      price,
    );
    return getChallengeNumberFromTX(tx);
  }

  describe("A. challenge() with Native", () => {
    let pos: Position;

    beforeEach(async () => {
      pos = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);
    });

    it("36. challenge WETH position with native ETH", async () => {
      const challengeSize = floatToDec18(2);
      const num = await challengeWithNative(bob, pos, challengeSize);

      const challenge = await mintingHub.challenges(num);
      expect(challenge.size).to.equal(challengeSize);
      expect(challenge.challenger).to.equal(bob.address);
    });

    it("37. revert challenge with native on non-WETH position", async () => {
      const volPos = await openVolPosition();
      await evm_increaseTime(Number(initPeriod) + 60);

      const challengeSize = floatToDec18(2);
      const price = await volPos.price();
      await expect(
        mintingHub.connect(bob).challenge(
          await volPos.getAddress(),
          challengeSize,
          price,
          { value: challengeSize },
        ),
      ).to.be.revertedWithCustomError(mintingHub, "NativeOnlyForWETH");
    });

    it("38. revert when msg.value != _collateralAmount", async () => {
      const challengeSize = floatToDec18(2);
      const price = await pos.price();
      await expect(
        mintingHub.connect(bob).challenge(
          await pos.getAddress(),
          challengeSize,
          price,
          { value: challengeSize + 1n },
        ),
      ).to.be.revertedWithCustomError(mintingHub, "ValueMismatch");
    });

    it("39. challenge with ERC20 WETH (backward compat)", async () => {
      const challengeSize = floatToDec18(2);
      await weth.connect(bob).deposit({ value: challengeSize });
      await weth.connect(bob).approve(await mintingHub.getAddress(), challengeSize);
      const price = await pos.price();
      const tx = await mintingHub.connect(bob).challenge(
        await pos.getAddress(),
        challengeSize,
        price,
      );
      await expect(tx).to.emit(mintingHub, "ChallengeStarted");
    });
  });

  describe("B. bid() Phase 1 — Aversion with returnAsNative", () => {
    let pos: Position;

    beforeEach(async () => {
      pos = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);
    });

    it("40. avert challenge, collateral returned as native ETH to bidder", async () => {
      const challengeSize = floatToDec18(2);
      const num = await challengeWithNative(bob, pos, challengeSize);
      await evm_increaseTime(1);

      const price = await pos.price();
      const bidCost = (price * challengeSize) / DECIMALS;
      await dEURO.connect(alice).approve(await mintingHub.getAddress(), bidCost);

      const ethBefore = await ethers.provider.getBalance(alice.address);
      const tx = await mintingHub.connect(alice)["bid(uint32,uint256,bool,bool)"](
        num, challengeSize, false, true,
      );
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const ethAfter = await ethers.provider.getBalance(alice.address);

      expect(ethAfter - ethBefore + gasCost).to.equal(challengeSize);
    });

    it("41. avert challenge, collateral returned as WETH when returnAsNative=false", async () => {
      const challengeSize = floatToDec18(2);
      const num = await challengeWithNative(bob, pos, challengeSize);
      await evm_increaseTime(1);

      const price = await pos.price();
      const bidCost = (price * challengeSize) / DECIMALS;
      await dEURO.connect(alice).approve(await mintingHub.getAddress(), bidCost);

      const wethBefore = await weth.balanceOf(alice.address);
      await mintingHub.connect(alice)["bid(uint32,uint256,bool,bool)"](
        num, challengeSize, false, false,
      );
      const wethAfter = await weth.balanceOf(alice.address);

      expect(wethAfter - wethBefore).to.equal(challengeSize);
    });

    it("42. challenger self-cancels with returnAsNative=true — gets ETH back", async () => {
      const challengeSize = floatToDec18(2);
      const num = await challengeWithNative(bob, pos, challengeSize);
      await evm_increaseTime(1);

      const ethBefore = await ethers.provider.getBalance(bob.address);
      const tx = await mintingHub.connect(bob)["bid(uint32,uint256,bool,bool)"](
        num, challengeSize, false, true,
      );
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const ethAfter = await ethers.provider.getBalance(bob.address);

      expect(ethAfter - ethBefore + gasCost).to.equal(challengeSize);
    });
  });

  describe("C. bid() Phase 2 — Liquidation with returnAsNative", () => {
    let pos: Position;

    beforeEach(async () => {
      pos = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);
      await pos.connect(owner).mint(owner.address, floatToDec18(10_000));
    });

    it("43. liquidate, bidder receives collateral as native ETH", async () => {
      const challengeSize = floatToDec18(2);
      const num = await challengeWithNative(bob, pos, challengeSize);

      const challengeData = await pos.challengeData();
      await evm_increaseTime(Number(challengeData.phase) + Number(challengeData.phase) / 2);

      const auctionPrice = await mintingHub.price(num);
      const bidAmount = (auctionPrice * challengeSize) / DECIMALS;
      await dEURO.connect(alice).approve(await mintingHub.getAddress(), bidAmount * 2n);

      const ethBefore = await ethers.provider.getBalance(alice.address);
      const tx = await mintingHub.connect(alice)["bid(uint32,uint256,bool,bool)"](
        num, challengeSize, false, true,
      );
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const ethAfter = await ethers.provider.getBalance(alice.address);

      // Alice received some native ETH (collateral from liquidation)
      expect(ethAfter + gasCost).to.be.gt(ethBefore);
    });

    it("44. liquidate, challenger collateral returned as native ETH", async () => {
      const challengeSize = floatToDec18(2);
      const num = await challengeWithNative(bob, pos, challengeSize);

      const challengeData = await pos.challengeData();
      await evm_increaseTime(Number(challengeData.phase) + Number(challengeData.phase) / 2);

      const auctionPrice = await mintingHub.price(num);
      const bidAmount = (auctionPrice * challengeSize) / DECIMALS;
      await dEURO.connect(alice).approve(await mintingHub.getAddress(), bidAmount * 2n);

      const ethBefore = await ethers.provider.getBalance(bob.address);
      await mintingHub.connect(alice)["bid(uint32,uint256,bool,bool)"](
        num, challengeSize, false, true,
      );
      const ethAfter = await ethers.provider.getBalance(bob.address);

      // Bob (challenger) gets collateral returned as native ETH
      expect(ethAfter).to.be.gt(ethBefore);
    });

    it("45. liquidate with postponeCollateralReturn, then claim as native", async () => {
      const challengeSize = floatToDec18(2);
      const num = await challengeWithNative(bob, pos, challengeSize);

      const challengeData = await pos.challengeData();
      await evm_increaseTime(Number(challengeData.phase) + Number(challengeData.phase) / 2);

      const auctionPrice = await mintingHub.price(num);
      const bidAmount = (auctionPrice * challengeSize) / DECIMALS;
      await dEURO.connect(alice).approve(await mintingHub.getAddress(), bidAmount * 2n);

      // Bid with postpone=true
      await mintingHub.connect(alice)["bid(uint32,uint256,bool,bool)"](
        num, challengeSize, true, false,
      );

      const wethAddr = await weth.getAddress();
      const pending = await mintingHub.pendingReturns(wethAddr, bob.address);
      expect(pending).to.be.gt(0n);

      // Bob claims as native
      const ethBefore = await ethers.provider.getBalance(bob.address);
      const tx = await mintingHub.connect(bob)["returnPostponedCollateral(address,address,bool)"](
        wethAddr, bob.address, true,
      );
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const ethAfter = await ethers.provider.getBalance(bob.address);

      expect(ethAfter - ethBefore + gasCost).to.equal(pending);
      expect(await mintingHub.pendingReturns(wethAddr, bob.address)).to.equal(0n);
    });

    it("46. liquidate with returnAsNative=false — all returns as WETH", async () => {
      const challengeSize = floatToDec18(2);
      const num = await challengeWithWETH(bob, pos, challengeSize);

      const challengeData = await pos.challengeData();
      await evm_increaseTime(Number(challengeData.phase) + Number(challengeData.phase) / 2);

      const auctionPrice = await mintingHub.price(num);
      const bidAmount = (auctionPrice * challengeSize) / DECIMALS;
      await dEURO.connect(alice).approve(await mintingHub.getAddress(), bidAmount * 2n);

      const aliceWethBefore = await weth.balanceOf(alice.address);
      await mintingHub.connect(alice)["bid(uint32,uint256,bool,bool)"](
        num, challengeSize, false, false,
      );
      const aliceWethAfter = await weth.balanceOf(alice.address);

      expect(aliceWethAfter).to.be.gt(aliceWethBefore);
    });
  });

  describe("D. buyExpiredCollateral() with receiveAsNative", () => {
    let pos: Position;

    beforeEach(async () => {
      pos = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);
      await pos.connect(owner).mint(owner.address, floatToDec18(1_000));
      // Advance well past expiration into phase 2 for affordable prices
      const expiration = await pos.expiration();
      const cPeriod = await pos.challengePeriod();
      await evm_increaseTimeTo(expiration + cPeriod * 19n / 10n);
    });

    it("47. buy expired collateral, receive as native ETH", async () => {
      const buyAmount = floatToDec18(5);
      const purchasePrice = await mintingHub.expiredPurchasePrice(await pos.getAddress());
      const cost = (purchasePrice * buyAmount) / DECIMALS;

      await dEURO.connect(alice).approve(await mintingHub.getAddress(), cost * 2n);

      const ethBefore = await ethers.provider.getBalance(alice.address);
      const tx = await mintingHub.connect(alice)["buyExpiredCollateral(address,uint256,bool)"](
        await pos.getAddress(), buyAmount, true,
      );
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const ethAfter = await ethers.provider.getBalance(alice.address);

      expect(ethAfter - ethBefore + gasCost).to.equal(buyAmount);
    });

    it("48. buy expired collateral, receive as WETH (receiveAsNative=false)", async () => {
      const buyAmount = floatToDec18(5);
      const purchasePrice = await mintingHub.expiredPurchasePrice(await pos.getAddress());
      const cost = (purchasePrice * buyAmount) / DECIMALS;

      // Non-native path: buyer interacts directly with Position via forceSale
      await dEURO.connect(alice).approve(await pos.getAddress(), cost * 2n);

      const wethBefore = await weth.balanceOf(alice.address);
      await mintingHub.connect(alice)["buyExpiredCollateral(address,uint256,bool)"](
        await pos.getAddress(), buyAmount, false,
      );
      const wethAfter = await weth.balanceOf(alice.address);

      expect(wethAfter - wethBefore).to.equal(buyAmount);
    });

    it("49. buy ALL expired collateral as native (position closes)", async () => {
      const maxAmount = await weth.balanceOf(await pos.getAddress());
      const purchasePrice = await mintingHub.expiredPurchasePrice(await pos.getAddress());
      const cost = (purchasePrice * maxAmount) / DECIMALS;

      await dEURO.connect(alice).approve(await mintingHub.getAddress(), cost * 2n);

      await mintingHub.connect(alice)["buyExpiredCollateral(address,uint256,bool)"](
        await pos.getAddress(), maxAmount, true,
      );

      expect(await weth.balanceOf(await pos.getAddress())).to.equal(0n);
      expect(await pos.isClosed()).to.be.true;
    });

    it("50. revert when position not expired", async () => {
      const freshPos = await openWethPositionNative(bob);
      await evm_increaseTime(Number(initPeriod) + 60);

      await expect(
        mintingHub.connect(alice)["buyExpiredCollateral(address,uint256,bool)"](
          await freshPos.getAddress(), floatToDec18(1), true,
        ),
      ).to.be.revertedWithCustomError(freshPos, "Alive");
    });
  });

  describe("E. returnPostponedCollateral() with asNative", () => {
    it("51. return postponed collateral as native ETH", async () => {
      const pos = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);
      await pos.connect(owner).mint(owner.address, floatToDec18(10_000));

      const challengeSize = floatToDec18(2);
      const num = await challengeWithNative(bob, pos, challengeSize);

      const challengeData = await pos.challengeData();
      await evm_increaseTime(Number(challengeData.phase) + Number(challengeData.phase) / 2);

      const auctionPrice = await mintingHub.price(num);
      const bidAmount = (auctionPrice * challengeSize) / DECIMALS;
      await dEURO.connect(alice).approve(await mintingHub.getAddress(), bidAmount * 2n);

      await mintingHub.connect(alice)["bid(uint32,uint256,bool,bool)"](num, challengeSize, true, false);

      const wethAddr = await weth.getAddress();
      const pending = await mintingHub.pendingReturns(wethAddr, bob.address);
      expect(pending).to.be.gt(0n);

      const ethBefore = await ethers.provider.getBalance(bob.address);
      const tx = await mintingHub.connect(bob)["returnPostponedCollateral(address,address,bool)"](
        wethAddr, bob.address, true,
      );
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const ethAfter = await ethers.provider.getBalance(bob.address);

      expect(ethAfter - ethBefore + gasCost).to.equal(pending);
    });

    it("52. return postponed collateral as WETH (asNative=false)", async () => {
      const pos = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);
      await pos.connect(owner).mint(owner.address, floatToDec18(10_000));

      const challengeSize = floatToDec18(2);
      const num = await challengeWithNative(bob, pos, challengeSize);

      const challengeData = await pos.challengeData();
      await evm_increaseTime(Number(challengeData.phase) + Number(challengeData.phase) / 2);

      const auctionPrice = await mintingHub.price(num);
      const bidAmount = (auctionPrice * challengeSize) / DECIMALS;
      await dEURO.connect(alice).approve(await mintingHub.getAddress(), bidAmount * 2n);

      await mintingHub.connect(alice)["bid(uint32,uint256,bool,bool)"](num, challengeSize, true, false);

      const wethAddr = await weth.getAddress();
      const pending = await mintingHub.pendingReturns(wethAddr, bob.address);
      expect(pending).to.be.gt(0n);

      const wethBefore = await weth.balanceOf(bob.address);
      await mintingHub.connect(bob)["returnPostponedCollateral(address,address,bool)"](
        wethAddr, bob.address, false,
      );
      const wethAfter = await weth.balanceOf(bob.address);

      expect(wethAfter - wethBefore).to.equal(pending);
    });

    it("53. revert when target rejects native", async () => {
      const pos = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);
      await pos.connect(owner).mint(owner.address, floatToDec18(10_000));

      const challengeSize = floatToDec18(2);
      const num = await challengeWithNative(bob, pos, challengeSize);

      const challengeData = await pos.challengeData();
      await evm_increaseTime(Number(challengeData.phase) + Number(challengeData.phase) / 2);

      const auctionPrice = await mintingHub.price(num);
      const bidAmount = (auctionPrice * challengeSize) / DECIMALS;
      await dEURO.connect(alice).approve(await mintingHub.getAddress(), bidAmount * 2n);

      await mintingHub.connect(alice)["bid(uint32,uint256,bool,bool)"](num, challengeSize, true, false);

      const wethAddr = await weth.getAddress();
      const pending = await mintingHub.pendingReturns(wethAddr, bob.address);
      expect(pending).to.be.gt(0n);

      await expect(
        mintingHub.connect(bob)["returnPostponedCollateral(address,address,bool)"](
          wethAddr, await rejectNative.getAddress(), true,
        ),
      ).to.be.revertedWithCustomError(mintingHub, "NativeTransferFailed");
    });
  });

  describe("F. NativeTransferFailed Error Cases", () => {
    it("54. bid phase 1 reverts when bidder (RejectNative) rejects ETH", async () => {
      const pos = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);

      const challengeSize = floatToDec18(2);
      const num = await challengeWithNative(bob, pos, challengeSize);
      await evm_increaseTime(1);

      const price = await pos.price();
      const bidCost = (price * challengeSize) / DECIMALS;
      await dEURO.transfer(await rejectNative.getAddress(), bidCost);
      await rejectNative.approve(await dEURO.getAddress(), await mintingHub.getAddress(), bidCost);

      await expect(
        rejectNative.callBid(await mintingHub.getAddress(), num, challengeSize),
      ).to.be.reverted;
    });

    it("55. bid phase 2 reverts when bidder (RejectNative) rejects ETH", async () => {
      const pos = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);
      await pos.connect(owner).mint(owner.address, floatToDec18(10_000));

      const challengeSize = floatToDec18(2);
      const num = await challengeWithNative(bob, pos, challengeSize);

      const challengeData = await pos.challengeData();
      await evm_increaseTime(Number(challengeData.phase) + Number(challengeData.phase) / 2);

      const auctionPrice = await mintingHub.price(num);
      const bidAmount = (auctionPrice * challengeSize) / DECIMALS;

      await dEURO.transfer(await rejectNative.getAddress(), bidAmount * 2n);
      await rejectNative.approve(await dEURO.getAddress(), await mintingHub.getAddress(), bidAmount * 2n);

      await expect(
        rejectNative.callBid(await mintingHub.getAddress(), num, challengeSize),
      ).to.be.reverted;
    });

    it("56. buyExpiredCollateral reverts when buyer (RejectNative) rejects ETH", async () => {
      const pos = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);
      await pos.connect(owner).mint(owner.address, floatToDec18(1_000));
      const expiration = await pos.expiration();
      const cPeriod = await pos.challengePeriod();
      await evm_increaseTimeTo(expiration + cPeriod * 19n / 10n);

      const buyAmount = floatToDec18(5);
      const purchasePrice = await mintingHub.expiredPurchasePrice(await pos.getAddress());
      const cost = (purchasePrice * buyAmount) / DECIMALS;

      await dEURO.transfer(await rejectNative.getAddress(), cost * 2n);
      await rejectNative.approve(await dEURO.getAddress(), await mintingHub.getAddress(), cost * 2n);

      await expect(
        rejectNative.callBuyExpired(
          await mintingHub.getAddress(),
          await pos.getAddress(),
          buyAmount,
        ),
      ).to.be.revertedWithCustomError(mintingHub, "NativeTransferFailed");
    });

    it("57. _returnChallengerCollateral: challenger receives native ETH when returnAsNative=true", async () => {
      const pos = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);
      await pos.connect(owner).mint(owner.address, floatToDec18(10_000));

      const challengeSize = floatToDec18(2);
      const num = await challengeWithWETH(charles, pos, challengeSize);

      const challengeData = await pos.challengeData();
      await evm_increaseTime(Number(challengeData.phase) + Number(challengeData.phase) / 2);

      const auctionPrice = await mintingHub.price(num);
      const bidAmount = (auctionPrice * challengeSize) / DECIMALS;
      await dEURO.connect(alice).approve(await mintingHub.getAddress(), bidAmount * 2n);

      // Alice bids with returnAsNative=true, challenger (charles) gets collateral back
      const ethBefore = await ethers.provider.getBalance(charles.address);
      await mintingHub.connect(alice)["bid(uint32,uint256,bool,bool)"](num, challengeSize, false, true);
      const ethAfter = await ethers.provider.getBalance(charles.address);

      expect(ethAfter).to.be.gt(ethBefore);
    });

    it("58. returnPostponedCollateral reverts when target is RejectNative", async () => {
      const pos = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);
      await pos.connect(owner).mint(owner.address, floatToDec18(10_000));

      const challengeSize = floatToDec18(2);
      const num = await challengeWithNative(bob, pos, challengeSize);

      const challengeData = await pos.challengeData();
      await evm_increaseTime(Number(challengeData.phase) + Number(challengeData.phase) / 2);

      const auctionPrice = await mintingHub.price(num);
      const bidAmount = (auctionPrice * challengeSize) / DECIMALS;
      await dEURO.connect(alice).approve(await mintingHub.getAddress(), bidAmount * 2n);

      await mintingHub.connect(alice)["bid(uint32,uint256,bool,bool)"](num, challengeSize, true, false);

      await expect(
        mintingHub.connect(bob)["returnPostponedCollateral(address,address,bool)"](
          await weth.getAddress(), await rejectNative.getAddress(), true,
        ),
      ).to.be.revertedWithCustomError(mintingHub, "NativeTransferFailed");
    });
  });
});
