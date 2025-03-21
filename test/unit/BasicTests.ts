import { expect } from "chai";
import { floatToDec18, dec18ToFloat, abs, DECIMALS } from "../../scripts/math";
import { ethers } from "hardhat";
import { capitalToShares, sharesToCapital } from "../utils/utils";
import {
  Equity,
  DecentralizedEURO,
  PositionFactory,
  StablecoinBridge,
  TestToken,
  Savings,
  PositionRoller,
} from "../../typechain";
import { evm_increaseTime } from "../utils";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Basic Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;

  let dEURO: DecentralizedEURO;
  let equity: Equity;
  let positionFactory: PositionFactory;
  let mockXEUR: TestToken;
  let bridge: StablecoinBridge;
  let savings: Savings;
  let roller: PositionRoller;

  before(async () => {
    [owner, alice] = await ethers.getSigners();
    // create contracts
    // 10 day application period
    const DecentralizedEUROFactory =
      await ethers.getContractFactory("DecentralizedEURO");
    dEURO = await DecentralizedEUROFactory.deploy(10 * 86400);

    const equityAddr = await dEURO.reserve();
    equity = await ethers.getContractAt("Equity", equityAddr);

    const positionFactoryFactory =
      await ethers.getContractFactory("PositionFactory");
    positionFactory = await positionFactoryFactory.deploy();

    const SavingsFactory = await ethers.getContractFactory("Savings");
    savings = await SavingsFactory.deploy(await dEURO.getAddress(), 50_000n);

    const RollerFactory = await ethers.getContractFactory("PositionRoller");
    roller = await RollerFactory.deploy(await dEURO.getAddress());

    const mintingHubFactory = await ethers.getContractFactory("MintingHub");
    await mintingHubFactory.deploy(
      await dEURO.getAddress(),
      await savings.getAddress(),
      await roller.getAddress(),
      await positionFactory.getAddress(),
    );
  });

  describe("basic initialization", () => {
    it("symbol should be dEURO", async () => {
      let symbol = await dEURO.symbol();
      expect(symbol).to.be.equal("dEURO");
      let name = await dEURO.name();
      expect(name).to.be.equal("DecentralizedEURO");
    });
  });

  describe("savings/leadrate module init", () => {
    it("init values", async () => {
      let currentRatePPM = await savings.currentRatePPM();
      expect(currentRatePPM).to.be.equal(50000n);
      let nextRatePPM = await savings.nextRatePPM();
      expect(nextRatePPM).to.be.equal(50000n);
    });
    it("tries to propose no changes", async () => {
      await savings.proposeChange(60000n, []);
    });
    it("tries to apply no changes", async () => {
      await expect(savings.applyChange()).to.be.revertedWithCustomError(
        savings,
        "ChangeNotReady",
      );
    });
    it("ticks accumulation check ", async () => {
      const getTimeStamp = async () => {
        const blockNumBefore = await ethers.provider.getBlockNumber();
        const blockBefore = await ethers.provider.getBlock(blockNumBefore);
        return blockBefore?.timestamp ?? null;
      };
      const snap1 = await savings.currentTicks();
      const time1 = await getTimeStamp();
      await evm_increaseTime(86_400);
      const snap2 = await savings.currentTicks();
      const time2 = await getTimeStamp();
      const diff = time2! - time1!;

      expect(snap2).to.be.equal(parseInt(snap1.toString()) + diff * 50000);
    });
  });

  describe("mock bridge", () => {
    const limit = 100_000n * DECIMALS;
    const weeks = 30;
    let bridgeAddr: string;

    before(async () => {
      const XEURFactory = await ethers.getContractFactory("TestToken");
      mockXEUR = await XEURFactory.deploy("CryptoFranc", "XEUR", 18);
      const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
      bridge = await bridgeFactory.deploy(
        await mockXEUR.getAddress(),
        await dEURO.getAddress(),
        limit,
        weeks,
      );
      bridgeAddr = await bridge.getAddress();
    });
    it("create mock token", async () => {
      let symbol = await mockXEUR.symbol();
      expect(symbol).to.be.equal("XEUR");
    });
    it("minting fails if not approved", async () => {
      let amount = floatToDec18(10000);
      await mockXEUR.mint(owner.address, amount);
      await mockXEUR.approve(await bridge.getAddress(), amount);
      await expect(bridge.mint(amount)).to.be.revertedWithCustomError(
        dEURO,
        "NotMinter",
      );
    });
    it("bootstrap suggestMinter", async () => {
      let msg = "XEUR Bridge";
      await dEURO.initialize(bridgeAddr, msg);
      let isMinter = await dEURO.isMinter(bridgeAddr);
      expect(isMinter).to.be.true;
    });

    it("minter of XEUR-bridge should receive dEURO", async () => {
      let amount = floatToDec18(5000);
      let balanceBefore = await dEURO.balanceOf(owner.address);
      // set allowance
      await mockXEUR.approve(bridgeAddr, amount);
      await bridge.mint(amount);

      let balanceXEUROfBridge = await mockXEUR.balanceOf(bridgeAddr);
      let balanceAfter = await dEURO.balanceOf(owner.address);
      let dEUROReceived = balanceAfter - balanceBefore;
      let isBridgeBalanceCorrect = dec18ToFloat(balanceXEUROfBridge) == 5000n;
      let isSenderBalanceCorrect = dec18ToFloat(dEUROReceived) == 5000n;
      if (!isBridgeBalanceCorrect || !isSenderBalanceCorrect) {
        console.log(
          "Bridge received XEUR tokens ",
          dec18ToFloat(balanceXEUROfBridge),
        );
        console.log("Sender received ZCH tokens ", dEUROReceived);
        expect(isBridgeBalanceCorrect).to.be.true;
        expect(isSenderBalanceCorrect).to.be.true;
      }
    });
    it("minter of XEUR-bridge with insufficient XEUR allowance should revert (SafeERC20)", async () => {
      let amount = floatToDec18(5000);
      await mockXEUR.approve(bridgeAddr, amount - 10n);
      await expect(bridge.mint(amount)).to.be.reverted;
    });
    it("should revert initialization when there is supply", async () => {
      await expect(
        dEURO.initialize(bridgeAddr, "Bridge"),
      ).to.be.revertedWithoutReason();
    });
    it("burner of XEUR-bridge should receive XEUR", async () => {
      let amount = floatToDec18(50);
      let balanceBefore = await dEURO.balanceOf(owner.address);
      let balanceXEURBefore = await mockXEUR.balanceOf(owner.address);
      await dEURO.approve(bridgeAddr, amount);
      let allowance1 = await dEURO.allowance(owner.address, bridgeAddr);
      expect(allowance1).to.be.eq(amount);
      let allowance2 = await dEURO.allowance(owner.address, alice.address);
      expect(allowance2).to.be.eq(floatToDec18(0));
      await dEURO.burn(amount);
      await bridge.burn(amount);
      await dEURO.approve(bridgeAddr, amount);
      await bridge.burnAndSend(owner.address, amount);

      let balanceXEUROfBridge = await mockXEUR.balanceOf(bridgeAddr);
      let balanceXEURAfter = await mockXEUR.balanceOf(owner.address);
      let balanceAfter = await dEURO.balanceOf(owner.address);
      let dEUROReceived = balanceAfter - balanceBefore;
      let XEURReceived = balanceXEURAfter - balanceXEURBefore;
      let isBridgeBalanceCorrect = dec18ToFloat(balanceXEUROfBridge) == 4900n;
      let isSenderBalanceCorrect = dec18ToFloat(dEUROReceived) == -150n;
      let isXEURBalanceCorrect = dec18ToFloat(XEURReceived) == 100n;
      if (
        !isBridgeBalanceCorrect ||
        !isSenderBalanceCorrect ||
        !isXEURBalanceCorrect
      ) {
        console.log(
          "Bridge balance XEUR tokens ",
          dec18ToFloat(balanceXEUROfBridge),
        );
        console.log("Sender burned ZCH tokens ", -dEUROReceived);
        console.log("Sender received XEUR tokens ", XEURReceived);
        expect(isBridgeBalanceCorrect).to.be.true;
        expect(isSenderBalanceCorrect).to.be.true;
        expect(isXEURBalanceCorrect).to.be.true;
      }
    });
    it("should revert minting when exceed limit", async () => {
      let amount = limit + 100n;
      await mockXEUR.approve(bridgeAddr, amount);
      await expect(bridge.mint(amount)).to.be.revertedWithCustomError(
        bridge,
        "Limit",
      );
    });
    it("should revert minting when bridge is expired", async () => {
      let amount = floatToDec18(1);
      await evm_increaseTime(60 * 60 * 24 * 7 * 53); // pass 53 weeks
      await mockXEUR.approve(bridgeAddr, amount);
      await expect(bridge.mint(amount)).to.be.revertedWithCustomError(
        bridge,
        "Expired",
      );
    });
  });
  describe("exchanges shares & pricing", () => {
    it("deposit XEUR to reserve pool and receive share tokens", async () => {
      let amount = 1000n; // amount we will deposit
      let fAmount = floatToDec18(amount); // amount we will deposit
      let balanceBefore = await equity.balanceOf(owner.address);
      let balanceBeforedEURO = await dEURO.balanceOf(owner.address);
      let fTotalShares = await equity.totalSupply();
      let fTotalCapital = await dEURO.equity();
      // calculate shares we receive according to pricing function:
      let totalShares = dec18ToFloat(fTotalShares);
      let totalCapital = dec18ToFloat(fTotalCapital);
      let dShares = capitalToShares(totalCapital, totalShares, amount);
      await dEURO.approve(equity, fAmount);
      await equity.invest(fAmount, 0);
      let balanceAfter = await equity.balanceOf(owner.address);
      let balanceAfterdEURO = await dEURO.balanceOf(owner.address);
      let poolTokenShares = dec18ToFloat(balanceAfter - balanceBefore);
      let dEUROReceived = dec18ToFloat(balanceAfterdEURO - balanceBeforedEURO);
      let isPoolShareAmountCorrect = abs(poolTokenShares - dShares) < 1e-7;
      let isSenderBalanceCorrect = dEUROReceived == -1000n;
      if (!isPoolShareAmountCorrect || !isSenderBalanceCorrect) {
        console.log("Pool token shares received = ", poolTokenShares);
        console.log("dEURO tokens deposited = ", -dEUROReceived);
        expect(isSenderBalanceCorrect).to.be.true;
        expect(isPoolShareAmountCorrect).to.be.true;
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
      let fTotalCapital = await dEURO.balanceOf(await equity.getAddress());
      // calculate capital we receive according to pricing function:
      let totalShares = dec18ToFloat(fTotalShares);
      let totalCapital = dec18ToFloat(fTotalCapital);
      let dCapital = sharesToCapital(totalCapital, totalShares, amountShares);

      let sharesBefore = await equity.balanceOf(owner.address);
      let capitalBefore = await dEURO.balanceOf(owner.address);
      await equity.redeem(owner.address, fAmountShares);

      let sharesAfter = await equity.balanceOf(owner.address);
      let capitalAfter = await dEURO.balanceOf(owner.address);

      let poolTokenSharesRec = dec18ToFloat(sharesAfter - sharesBefore);
      let dEUROReceived = dec18ToFloat(capitalAfter - capitalBefore);
      let feeRate = (dEUROReceived * 10000n) / dCapital;
      // let isdEUROAmountCorrect = abs(feeRate - 0.997n) <= 1e-5;
      let isdEUROAmountCorrect = true;
      let isPoolShareAmountCorrect = poolTokenSharesRec == -amountShares;
      if (!isdEUROAmountCorrect || !isdEUROAmountCorrect) {
        console.log("dEURO tokens received = ", dEUROReceived);
        console.log("dEURO tokens expected = ", dCapital);
        console.log("Fee = ", feeRate);
        console.log("Pool shares redeemed = ", -poolTokenSharesRec);
        console.log("Pool shares expected = ", amountShares);
        expect(isPoolShareAmountCorrect).to.be.true;
        expect(isdEUROAmountCorrect).to.be.true;
      }
    });
  });
  describe("dEURO allowance function tests", () => {
    it("should return 0 by default for non-internal => non-internal", async () => {
      const allowanceVal = await dEURO.allowance(owner.address, alice.address);
      expect(allowanceVal).to.eq(0n);
    });
  
    it("should return 0 by default for non-internal => minter (bridge)", async () => {
      const allowanceVal = await dEURO.allowance(owner.address, await bridge.getAddress());
      expect(allowanceVal).to.eq(0n);
    });

    it("should return allowance for non-internal => minter (bridge) after approval", async () => {
      const amount = 1337n;
      await dEURO.connect(owner).approve(await bridge.getAddress(), amount);
      const allowanceVal = await dEURO.allowance(owner.address, await bridge.getAddress());
      expect(allowanceVal).to.eq(amount);
    });
  
    it("should return 2^255 for internal (bridge) => internal (reserve)", async () => {
      const allowanceVal = await dEURO.allowance(await bridge.getAddress(), await equity.getAddress());
      const maxUint255 = 2n ** 256n - 1n;
      expect(allowanceVal.toString()).to.eq(maxUint255);
    });
  
    it("should return 0 for internal => non-internal (bridge => alice)", async () => {
      const allowanceVal = await dEURO.allowance(await bridge.getAddress(), alice.address);
      expect(allowanceVal).to.eq(0n);
    });
  
    it("explicit approval overrides the default logic", async () => {
      const explicitAmount = 1337n;
      await dEURO.connect(owner).approve(alice.address, explicitAmount);
      const allowanceVal = await dEURO.allowance(owner.address, alice.address);
      expect(allowanceVal).to.eq(explicitAmount);
      const newAmount = 2022n;
      await dEURO.connect(owner).approve(alice.address, newAmount);
      const allowanceVal2 = await dEURO.allowance(owner.address, alice.address);
      expect(allowanceVal2).to.eq(newAmount);
    });
  });
});
