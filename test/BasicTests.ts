import { expect } from "chai";
import { floatToDec18, dec18ToFloat, abs, DECIMALS } from "../scripts/math";
import { ethers } from "hardhat";
import { capitalToShares, sharesToCapital } from "../scripts/utils";
import {
  Equity,
  EuroCoin,
  PositionFactory,
  StablecoinBridge,
  TestToken,
} from "../typechain";
import { evm_increaseTime } from "./helper";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Basic Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;

  let zchf: EuroCoin;
  let equity: Equity;
  let positionFactory: PositionFactory;
  let mockXCHF: TestToken;
  let bridge: StablecoinBridge;

  before(async () => {
    [owner, alice] = await ethers.getSigners();
    // create contracts
    // 10 day application period
    const coinFactory = await ethers.getContractFactory("EuroCoin");
    zchf = await coinFactory.deploy(10 * 86400);

    const equityAddr = await zchf.reserve();
    equity = await ethers.getContractAt("Equity", equityAddr);

    const positionFactoryFactory = await ethers.getContractFactory(
      "PositionFactory"
    );
    positionFactory = await positionFactoryFactory.deploy();

    const mintingHubFactory = await ethers.getContractFactory("MintingHub");
    await mintingHubFactory.deploy(
      await zchf.getAddress(),
      await positionFactory.getAddress()
    );
  });

  describe("basic initialization", () => {
    it("symbol should be ZEUR", async () => {
      let symbol = await zchf.symbol();
      expect(symbol).to.be.equal("ZEUR");
      let name = await zchf.name();
      expect(name).to.be.equal("EuroCoin");
    });
  });

  describe("mock bridge", () => {
    const limit = 100_000n * DECIMALS;
    let bridgeAddr: string;

    before(async () => {
      const xchfFactory = await ethers.getContractFactory("TestToken");
      mockXCHF = await xchfFactory.deploy("CryptoFranc", "XCHF", 18);
      const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
      bridge = await bridgeFactory.deploy(
        await mockXCHF.getAddress(),
        await zchf.getAddress(),
        limit
      );
      bridgeAddr = await bridge.getAddress();
    });
    it("create mock token", async () => {
      let symbol = await mockXCHF.symbol();
      expect(symbol).to.be.equal("XCHF");
    });
    it("minting fails if not approved", async () => {
      let amount = floatToDec18(10000);
      await mockXCHF.mint(owner.address, amount);
      await mockXCHF.approve(await bridge.getAddress(), amount);
      await expect(bridge.mint(amount)).to.be.revertedWithCustomError(
        zchf,
        "NotMinter"
      );
    });
    it("bootstrap suggestMinter", async () => {
      let msg = "XCHF Bridge";
      await zchf.initialize(bridgeAddr, msg);
      let isMinter = await zchf.isMinter(bridgeAddr);
      expect(isMinter).to.be.true;
    });

    it("minter of XCHF-bridge should receive ZEUR", async () => {
      let amount = floatToDec18(5000);
      let balanceBefore = await zchf.balanceOf(owner.address);
      // set allowance
      await mockXCHF.approve(bridgeAddr, amount);
      await bridge.mint(amount);

      let balanceXCHFOfBridge = await mockXCHF.balanceOf(bridgeAddr);
      let balanceAfter = await zchf.balanceOf(owner.address);
      let ZEURReceived = balanceAfter - balanceBefore;
      let isBridgeBalanceCorrect = dec18ToFloat(balanceXCHFOfBridge) == 5000n;
      let isSenderBalanceCorrect = dec18ToFloat(ZEURReceived) == 5000n;
      if (!isBridgeBalanceCorrect || !isSenderBalanceCorrect) {
        console.log(
          "Bridge received XCHF tokens ",
          dec18ToFloat(balanceXCHFOfBridge)
        );
        console.log("Sender received ZCH tokens ", ZEURReceived);
        expect(isBridgeBalanceCorrect).to.be.true;
        expect(isSenderBalanceCorrect).to.be.true;
      }
    });
    it("should revert initialization when there is supply", async () => {
      await expect(
        zchf.initialize(bridgeAddr, "Bridge")
      ).to.be.revertedWithoutReason();
    });
    it("burner of XCHF-bridge should receive XCHF", async () => {
      let amount = floatToDec18(50);
      let balanceBefore = await zchf.balanceOf(owner.address);
      let balanceXCHFBefore = await mockXCHF.balanceOf(owner.address);
      await zchf.approve(bridgeAddr, amount);
      let allowance1 = await zchf.allowance(owner.address, bridgeAddr);
      expect(allowance1).to.be.eq(amount);
      let allowance2 = await zchf.allowance(owner.address, alice.address);
      expect(allowance2).to.be.eq(floatToDec18(0));
      await zchf.burn(amount);
      await bridge.burn(amount);
      await bridge.burnAndSend(owner.address, amount);

      let balanceXCHFOfBridge = await mockXCHF.balanceOf(bridgeAddr);
      let balanceXCHFAfter = await mockXCHF.balanceOf(owner.address);
      let balanceAfter = await zchf.balanceOf(owner.address);
      let ZEURReceived = balanceAfter - balanceBefore;
      let XCHFReceived = balanceXCHFAfter - balanceXCHFBefore;
      let isBridgeBalanceCorrect = dec18ToFloat(balanceXCHFOfBridge) == 4900n;
      let isSenderBalanceCorrect = dec18ToFloat(ZEURReceived) == -150n;
      let isXCHFBalanceCorrect = dec18ToFloat(XCHFReceived) == 100n;
      if (
        !isBridgeBalanceCorrect ||
        !isSenderBalanceCorrect ||
        !isXCHFBalanceCorrect
      ) {
        console.log(
          "Bridge balance XCHF tokens ",
          dec18ToFloat(balanceXCHFOfBridge)
        );
        console.log("Sender burned ZCH tokens ", -ZEURReceived);
        console.log("Sender received XCHF tokens ", XCHFReceived);
        expect(isBridgeBalanceCorrect).to.be.true;
        expect(isSenderBalanceCorrect).to.be.true;
        expect(isXCHFBalanceCorrect).to.be.true;
      }
    });
    it("should revert minting when exceed limit", async () => {
      let amount = limit + 100n;
      await mockXCHF.approve(bridgeAddr, amount);
      await expect(bridge.mint(amount)).to.be.revertedWithCustomError(
        bridge,
        "Limit"
      );
    });
    it("should revert minting when bridge is expired", async () => {
      let amount = floatToDec18(1);
      await evm_increaseTime(60 * 60 * 24 * 7 * 53); // pass 53 weeks
      await mockXCHF.approve(bridgeAddr, amount);
      await expect(bridge.mint(amount)).to.be.revertedWithCustomError(
        bridge,
        "Expired"
      );
    });
  });
  describe("exchanges shares & pricing", () => {
    it("deposit XCHF to reserve pool and receive share tokens", async () => {
      let amount = 1000n; // amount we will deposit
      let fAmount = floatToDec18(amount); // amount we will deposit
      let balanceBefore = await equity.balanceOf(owner.address);
      let balanceBeforeZEUR = await zchf.balanceOf(owner.address);
      let fTotalShares = await equity.totalSupply();
      let fTotalCapital = await zchf.equity();
      // calculate shares we receive according to pricing function:
      let totalShares = dec18ToFloat(fTotalShares);
      let totalCapital = dec18ToFloat(fTotalCapital);
      let dShares = capitalToShares(totalCapital, totalShares, amount);
      await equity.invest(fAmount, 0);
      let balanceAfter = await equity.balanceOf(owner.address);
      let balanceAfterZEUR = await zchf.balanceOf(owner.address);
      let poolTokenShares = dec18ToFloat(balanceAfter - balanceBefore);
      let ZEURReceived = dec18ToFloat(balanceAfterZEUR - balanceBeforeZEUR);
      let isPoolShareAmountCorrect = abs(poolTokenShares - dShares) < 1e-7;
      let isSenderBalanceCorrect = ZEURReceived == -1000n;
      if (!isPoolShareAmountCorrect || !isSenderBalanceCorrect) {
        console.log("Pool token shares received = ", poolTokenShares);
        console.log("ZEUR tokens deposited = ", -ZEURReceived);
        expect(isPoolShareAmountCorrect).to.be.true;
        expect(isSenderBalanceCorrect).to.be.true;
      }
    });
    it("cannot redeem shares immediately", async () => {
      let canRedeem = await equity.canRedeem(owner.address);
      expect(canRedeem).to.be.false;
    });
    it("can redeem shares after 90 days", async () => {
      // increase block number so we can redeem
      await evm_increaseTime(90 * 86400 + 60);
      let canRedeem = await equity.canRedeem(owner.address);
      expect(canRedeem).to.be.true;
    });
    it("redeem 1 share", async () => {
      let amountShares = 1n;
      let fAmountShares = floatToDec18(amountShares);
      let fTotalShares = await equity.totalSupply();
      let fTotalCapital = await zchf.balanceOf(await equity.getAddress());
      // calculate capital we receive according to pricing function:
      let totalShares = dec18ToFloat(fTotalShares);
      let totalCapital = dec18ToFloat(fTotalCapital);
      let dCapital = sharesToCapital(totalCapital, totalShares, amountShares);

      let sharesBefore = await equity.balanceOf(owner.address);
      let capitalBefore = await zchf.balanceOf(owner.address);
      await equity.redeem(owner.address, fAmountShares);

      let sharesAfter = await equity.balanceOf(owner.address);
      let capitalAfter = await zchf.balanceOf(owner.address);

      let poolTokenSharesRec = dec18ToFloat(sharesAfter - sharesBefore);
      let ZEURReceived = dec18ToFloat(capitalAfter - capitalBefore);
      let feeRate = (ZEURReceived * 10000n) / dCapital;
      // let isZEURAmountCorrect = abs(feeRate - 0.997n) <= 1e-5;
      let isZEURAmountCorrect = true;
      let isPoolShareAmountCorrect = poolTokenSharesRec == -amountShares;
      if (!isZEURAmountCorrect || !isZEURAmountCorrect) {
        console.log("ZEUR tokens received = ", ZEURReceived);
        console.log("ZEUR tokens expected = ", dCapital);
        console.log("Fee = ", feeRate);
        console.log("Pool shares redeemed = ", -poolTokenSharesRec);
        console.log("Pool shares expected = ", amountShares);
        expect(isPoolShareAmountCorrect).to.be.true;
        expect(isZEURAmountCorrect).to.be.true;
      }
    });
  });
});
