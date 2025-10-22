import { expect } from "chai";
import { floatToDec18, dec18ToFloat } from "../../scripts/utils/math";
import { ethers } from "hardhat";
import { JuiceDollar, StablecoinBridge, TestToken } from "../../typechain";
import { evm_increaseTime } from "../utils";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const limit = floatToDec18(100_000);
const weeks = 30;
describe("JuiceDollar", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let JUSD: JuiceDollar;
  let mockXUSD: TestToken;
  let bridge: StablecoinBridge;

  before(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    // create contracts
    // 10 day application period
    const juiceDollarFactory = await ethers.getContractFactory("JuiceDollar");
    JUSD = await juiceDollarFactory.deploy(10 * 86400);
  });

  describe("Basic initialization", () => {
    it("symbol should be JUSD", async () => {
      let symbol = await JUSD.symbol();
      expect(symbol).to.be.equal("JUSD");
      let name = await JUSD.name();
      expect(name).to.be.equal("Juice Dollar");
    });

    it("should support permit interface", async () => {
      let supportsERC3009Interface = await JUSD.supportsInterface("0xb9012196");
      let supportsPermitInterface = await JUSD.supportsInterface("0x9d8ff7da");
      expect(supportsERC3009Interface).to.be.true;
      expect(supportsPermitInterface).to.be.true;
    });

    it("create mock token", async () => {
      const XUSDFactory = await ethers.getContractFactory("TestToken");
      mockXUSD = await XUSDFactory.deploy("Mock USD", "XUSD", 18);
      let symbol = await mockXUSD.symbol();
      expect(symbol).to.be.equal("XUSD");
    });
  });

  describe("Initializing Minters", () => {
    before(async () => {
      const XUSDFactory = await ethers.getContractFactory("TestToken");
      mockXUSD = await XUSDFactory.deploy("Mock USD", "XUSD", 18);
      const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
      bridge = await bridgeFactory.deploy(
        await mockXUSD.getAddress(),
        await JUSD.getAddress(),
        limit,
        weeks
      );
    });

    it("bootstrap suggestMinter", async () => {
      let msg = "XUSD Bridge";
      await JUSD.initialize(await bridge.getAddress(), msg);
      let isMinter = await JUSD.isMinter(await bridge.getAddress());
      expect(isMinter).to.be.true;
    });

    it("should revert initialization when there is supply", async () => {
      let amount = floatToDec18(10000);
      await mockXUSD.approve(await bridge.getAddress(), amount);
      await bridge.mint(amount);
      await expect(
        JUSD.initialize(await bridge.getAddress(), "Bridge")
      ).to.be.revertedWithoutReason();
    });

    it("should revert minter suggestion when application period is too short", async () => {
      await expect(
        JUSD.suggestMinter(owner.address, 9 * 86400, floatToDec18(1000), "")
      ).to.be.revertedWithCustomError(JUSD, "PeriodTooShort");
    });

    it("should revert minter suggestion when application fee is too low", async () => {
      await expect(
        JUSD.suggestMinter(owner.address, 10 * 86400, floatToDec18(900), "")
      ).to.be.revertedWithCustomError(JUSD, "FeeTooLow");
    });

    it("should revert when minter is already registered", async () => {
      await expect(
        JUSD.suggestMinter(
          await bridge.getAddress(),
          10 * 86400,
          floatToDec18(1000),
          ""
        )
      ).to.be.revertedWithCustomError(JUSD, "AlreadyRegistered");
    });

    it("should revert registering position when not from minters", async () => {
      expect(await JUSD.isMinter(owner.address)).to.be.false;
      await expect(
        JUSD.registerPosition(owner.address)
      ).to.be.revertedWithCustomError(JUSD, "NotMinter");
    });

    it("should revert denying minters when exceed application period", async () => {
      await JUSD.approve(JUSD.getAddress(), floatToDec18(1000));
      await expect(
        JUSD.suggestMinter(owner.address, 10 * 86400, floatToDec18(1000), "")
      ).to.emit(JUSD, "MinterApplied");
      await evm_increaseTime(86400 * 11);
      await expect(
        JUSD.denyMinter(owner.address, [], "")
      ).to.be.revertedWithCustomError(JUSD, "TooLate");
    });

    it("should send application fee for minter to reserve", async () => {
      let reserveBalanceBefore = await JUSD.balanceOf(await JUSD.reserve());
      await JUSD.approve(JUSD.getAddress(), floatToDec18(1000));
      await JUSD.suggestMinter(
        bob.address,
        10 * 86400,
        floatToDec18(1000),
        "",
      );
      let reserveBalanceAfter = await JUSD.balanceOf(await JUSD.reserve());
      expect(dec18ToFloat(reserveBalanceAfter - reserveBalanceBefore)).to.be.eq(
        1000,
      );
    });

    it("should be minter when application period ends", async () => {
      await evm_increaseTime(11 * 86400);
      expect(await JUSD.isMinter(bob.address)).to.be.true;
    });
  });

  describe("Minting & Burning", () => {
    before(async () => {
      const juiceDollarFactory = await ethers.getContractFactory("JuiceDollar");
      JUSD = await juiceDollarFactory.deploy(10 * 86400);
      const XUSDFactory = await ethers.getContractFactory("TestToken");
      mockXUSD = await XUSDFactory.deploy("Mock USD", "XUSD", 18);
      const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
      bridge = await bridgeFactory.deploy(
        await mockXUSD.getAddress(),
        await JUSD.getAddress(),
        limit,
        weeks
      );
    });

    it("should revert minting if minter is not whitelisted", async () => {
      let amount = floatToDec18(10000);
      await mockXUSD.mint(owner.address, amount);
      await mockXUSD.approve(await bridge.getAddress(), amount);
      await expect(bridge.mint(amount)).to.be.revertedWithCustomError(
        JUSD,
        "NotMinter"
      );
      await JUSD.initialize(await bridge.getAddress(), "Bridge");
      expect(await JUSD.isMinter(await bridge.getAddress())).to.be.true;
    });

    it("minter of XUSD-bridge should receive JUSD", async () => {
      let amount = floatToDec18(5000);
      let balanceBefore = await JUSD.balanceOf(owner.address);
      // set allowance
      await mockXUSD.approve(await bridge.getAddress(), amount);
      await bridge.mint(amount);

      let balanceXUSDOfBridge = await mockXUSD.balanceOf(
        await bridge.getAddress()
      );
      let balanceAfter = await JUSD.balanceOf(owner.address);
      let JUSDReceived = dec18ToFloat(balanceAfter - balanceBefore);
      let isBridgeBalanceCorrect = dec18ToFloat(balanceXUSDOfBridge) == 5000n;
      let isSenderBalanceCorrect = JUSDReceived == 5000n;
      if (!isBridgeBalanceCorrect || !isSenderBalanceCorrect) {
        console.log(
          "Bridge received XUSD tokens ",
          dec18ToFloat(balanceXUSDOfBridge)
        );
        console.log("Sender received ZCH tokens ", JUSDReceived);
        expect(isBridgeBalanceCorrect).to.be.true;
        expect(isSenderBalanceCorrect).to.be.true;
      }
    });

    it("burner of XUSD-bridge should receive XUSD", async () => {
      let amount = floatToDec18(50);
      let balanceBefore = await JUSD.balanceOf(owner.address);
      let balanceXUSDBefore = await mockXUSD.balanceOf(owner.address);
      await JUSD.approve(await bridge.getAddress(), amount);
      let allowance1 = await JUSD.allowance(
        owner.address,
        await bridge.getAddress()
      );
      expect(allowance1).to.be.eq(amount);
      let allowance2 = await JUSD.allowance(owner.address, alice.address);
      expect(allowance2).to.be.eq(floatToDec18(0));
      await JUSD.burn(amount);
      await bridge.burn(amount);
      await JUSD.approve(await bridge.getAddress(), amount);
      await bridge.burnAndSend(owner.address, amount);

      let balanceXUSDOfBridge = await mockXUSD.balanceOf(
        await bridge.getAddress()
      );
      let balanceXUSDAfter = await mockXUSD.balanceOf(owner.address);
      let balanceAfter = await JUSD.balanceOf(owner.address);
      let JUSDReceived = dec18ToFloat(balanceAfter - balanceBefore);
      let XUSDReceived = dec18ToFloat(balanceXUSDAfter - balanceXUSDBefore);
      let isBridgeBalanceCorrect = dec18ToFloat(balanceXUSDOfBridge) == 4900n;
      let isSenderBalanceCorrect = JUSDReceived == -150n;
      let isXUSDBalanceCorrect = XUSDReceived == 100n;
      if (
        !isBridgeBalanceCorrect ||
        !isSenderBalanceCorrect ||
        !isXUSDBalanceCorrect
      ) {
        console.log(
          "Bridge balance XUSD tokens ",
          dec18ToFloat(balanceXUSDOfBridge)
        );
        console.log("Sender burned JUSD tokens ", -JUSDReceived);
        console.log("Sender received XUSD tokens ", XUSDReceived);
        expect(isBridgeBalanceCorrect).to.be.true;
        expect(isSenderBalanceCorrect).to.be.true;
        expect(isXUSDBalanceCorrect).to.be.true;
      }
    });

    it("should revert minting when exceed limit", async () => {
      let amount = limit + 100n;
      await mockXUSD.approve(await bridge.getAddress(), amount);
      await expect(bridge.mint(amount)).to.be.revertedWithCustomError(
        bridge,
        "Limit"
      );
    });

    it("should revert minting when bridge is expired", async () => {
      let amount = floatToDec18(1);
      await evm_increaseTime(60 * 60 * 24 * 7 * 53); // pass 53 weeks
      await mockXUSD.approve(await bridge.getAddress(), amount);
      await expect(bridge.mint(amount)).to.be.revertedWithCustomError(
        bridge,
        "Expired"
      );
    });

    it("should revert minting with reserve from non minters", async () => {
      await expect(
        JUSD.mintWithReserve(owner.address, 1000, 0)
      ).to.be.revertedWithCustomError(JUSD, "NotMinter");
    });

    it("should revert burning from non minters", async () => {
      await expect(
        JUSD.burnFrom(owner.address, 1000)
      ).to.be.revertedWithCustomError(JUSD, "NotMinter");
    });

    it("should revert burning without reserve from non minters", async () => {
      await expect(
        JUSD.burnWithoutReserve(owner.address, 1000)
      ).to.be.revertedWithCustomError(JUSD, "NotMinter");
    });

    it("should revert burning from with reserve from non minters", async () => {
      await expect(
        JUSD.burnFromWithReserve(owner.address, 0, 0)
      ).to.be.revertedWithCustomError(JUSD, "NotMinter");
    });

    it("should succeed minting with reserve & burning (from) with reserve if minter", async () => {
      // make bob minter for this test
      await JUSD.approve(JUSD.getAddress(), floatToDec18(1000));
      await JUSD.suggestMinter(
        bob.address,
        10 * 86400,
        floatToDec18(1000),
        "",
      );
      evm_increaseTime(86400 * 11);
      // test
      let amount = floatToDec18(1000);
      let reservePPM = 50_000n; // 5%

      let balanceBeforeMintAlice = await JUSD.balanceOf(alice.address);
      let balanceBeforeMintReserve = await JUSD.balanceOf(
        await JUSD.reserve(),
      );
      await JUSD
        .connect(bob)
        .mintWithReserve(alice.address, amount, reservePPM); // mintWithReserve
      let balanceAfterMintAlice = await JUSD.balanceOf(alice.address);
      let balanceAfterMintReserve = await JUSD.balanceOf(
        await JUSD.reserve(),
      );
      expect(balanceAfterMintAlice - balanceBeforeMintAlice).to.be.eq(
        floatToDec18(950),
      ); // 1000 - 50 (5% reserve)
      expect(balanceAfterMintReserve - balanceBeforeMintReserve).to.be.eq(
        floatToDec18(50),
      ); // 5% of 1000

      // burnFromWithReserve
      await JUSD.connect(alice).approve(bob.address, amount);
      await JUSD
        .connect(bob)
        .burnFromWithReserve(alice.address, amount, reservePPM);
      let balanceAfterBurnAlice = await JUSD.balanceOf(alice.address);
      let balanceAfterBurnReserve = await JUSD.balanceOf(
        await JUSD.reserve(),
      );
      expect(balanceAfterMintAlice - balanceAfterBurnAlice).to.be.eq(
        floatToDec18(950),
      );
      expect(balanceAfterMintReserve - balanceAfterBurnReserve).to.be.eq(
        floatToDec18(50),
      );
    });

    it("should revert covering loss from non minters", async () => {
      await expect(
        JUSD.coverLoss(owner.address, 0),
      ).to.be.revertedWithCustomError(JUSD, "NotMinter");
    });

    it("should succeed covering loss within reserve balance if minter", async () => {
      let balanceBeforeAlice = await JUSD.balanceOf(alice.address);
      let balanceBeforeReserve = await JUSD.balanceOf(await JUSD.reserve());
      let lossAmount = balanceBeforeReserve / 2n;
      let tx = await JUSD.connect(bob).coverLoss(alice.address, lossAmount);
      await expect(tx)
        .to.emit(JUSD, "Loss")
        .withArgs(alice.address, lossAmount);
      let balanceAfterAlice = await JUSD.balanceOf(alice.address);
      let balanceAfterReserve = await JUSD.balanceOf(await JUSD.reserve());
      expect(balanceAfterAlice - balanceBeforeAlice).to.be.eq(lossAmount);
      expect(balanceBeforeReserve - balanceAfterReserve).to.be.eq(lossAmount);
    });

    it("should succeed covering loss above reserve balance if minter", async () => {
      let balanceBeforeAlice = await JUSD.balanceOf(alice.address);
      let balanceBeforeReserve = await JUSD.balanceOf(await JUSD.reserve());
      let lossAmount = balanceBeforeReserve * 2n;
      let tx = await JUSD.connect(bob).coverLoss(alice.address, lossAmount);
      await expect(tx)
        .to.emit(JUSD, "Loss")
        .withArgs(alice.address, lossAmount);
      let balanceAfterAlice = await JUSD.balanceOf(alice.address);
      let balanceAfterReserve = await JUSD.balanceOf(await JUSD.reserve());
      expect(balanceAfterAlice - balanceBeforeAlice).to.be.eq(lossAmount);
      expect(balanceAfterReserve).to.be.eq(0);
    });

    it("should revert collecting profits from non minters", async () => {
      await expect(JUSD.collectProfits(owner.address, 7)).to.be.revertedWithCustomError(
        JUSD, 
        "NotMinter"
      );
    });
  });

  describe("view func", () => {
    before(async () => {
      const juiceDollarFactory = await ethers.getContractFactory("JuiceDollar");
      JUSD = await juiceDollarFactory.deploy(10 * 86400);

      const XUSDFactory = await ethers.getContractFactory("TestToken");
      mockXUSD = await XUSDFactory.deploy("Mock USD", "XUSD", 18);

      const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
      bridge = await bridgeFactory.deploy(
        await mockXUSD.getAddress(),
        await JUSD.getAddress(),
        limit,
        weeks,
      );
    });
    it("calculateAssignedReserve", async () => {});
  });
});
