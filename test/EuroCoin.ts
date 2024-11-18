import { expect } from "chai";
import { floatToDec18, dec18ToFloat } from "../scripts/math";
import { ethers } from "hardhat";
import { EuroCoin, StablecoinBridge, TestToken } from "../typechain";
import { evm_increaseTime } from "./helper";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const limit = floatToDec18(100_000);
describe("EuroCoin", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;

  let dEURO: EuroCoin;
  let mockXCHF: TestToken;
  let bridge: StablecoinBridge;

  before(async () => {
    [owner, alice] = await ethers.getSigners();
    // create contracts
    // 10 day application period
    const euroCoinFactory = await ethers.getContractFactory("EuroCoin");
    dEURO = await euroCoinFactory.deploy(10 * 86400);
  });

  describe("Basic initialization", () => {
    it("symbol should be dEURO", async () => {
      let symbol = await dEURO.symbol();
      expect(symbol).to.be.equal("dEURO");
      let name = await dEURO.name();
      expect(name).to.be.equal("EuroCoin");
    });

    it("should support permit interface", async () => {
      let supportsInterface = await dEURO.supportsInterface("0x9d8ff7da");
      expect(supportsInterface).to.be.true;
    });

    it("create mock token", async () => {
      const xchfFactory = await ethers.getContractFactory("TestToken");
      mockXCHF = await xchfFactory.deploy("CryptoFranc", "XCHF", 18);
      let symbol = await mockXCHF.symbol();
      expect(symbol).to.be.equal("XCHF");
    });
  });

  describe("Initializing Minters", () => {
    before(async () => {
      const xchfFactory = await ethers.getContractFactory("TestToken");
      mockXCHF = await xchfFactory.deploy("CryptoFranc", "XCHF", 18);
      const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
      bridge = await bridgeFactory.deploy(
        await mockXCHF.getAddress(),
        await dEURO.getAddress(),
        limit
      );
    });

    it("bootstrap suggestMinter", async () => {
      let msg = "XCHF Bridge";
      await dEURO.initialize(await bridge.getAddress(), msg);
      let isMinter = await dEURO.isMinter(await bridge.getAddress());
      expect(isMinter).to.be.true;
    });

    it("should revert initialization when there is supply", async () => {
      let amount = floatToDec18(10000);
      await mockXCHF.approve(await bridge.getAddress(), amount);
      await bridge.mint(amount);
      await expect(
        dEURO.initialize(await bridge.getAddress(), "Bridge")
      ).to.be.revertedWithoutReason();
    });

    it("should revert minter suggestion when application period is too short", async () => {
      await expect(
        dEURO.suggestMinter(owner.address, 9 * 86400, floatToDec18(1000), "")
      ).to.be.revertedWithCustomError(dEURO, "PeriodTooShort");
    });

    it("should revert minter suggestion when application fee is too low", async () => {
      await expect(
        dEURO.suggestMinter(owner.address, 10 * 86400, floatToDec18(900), "")
      ).to.be.revertedWithCustomError(dEURO, "FeeTooLow");
    });

    it("should revert when minter is already registered", async () => {
      await expect(
        dEURO.suggestMinter(
          await bridge.getAddress(),
          10 * 86400,
          floatToDec18(1000),
          ""
        )
      ).to.be.revertedWithCustomError(dEURO, "AlreadyRegistered");
    });

    it("should revert registering position when not from minters", async () => {
      expect(await dEURO.isMinter(owner.address)).to.be.false;
      await expect(
        dEURO.registerPosition(owner.address)
      ).to.be.revertedWithCustomError(dEURO, "NotMinter");
    });

    it("should revert denying minters when exceed application period", async () => {
      await expect(
        dEURO.suggestMinter(owner.address, 10 * 86400, floatToDec18(1000), "")
      ).to.emit(dEURO, "MinterApplied");
      await evm_increaseTime(86400 * 11);
      await expect(
        dEURO.denyMinter(owner.address, [], "")
      ).to.be.revertedWithCustomError(dEURO, "TooLate");
    });
  });

  describe("Minting & Burning", () => {
    before(async () => {
      const euroCoinFactory = await ethers.getContractFactory("EuroCoin");
      dEURO = await euroCoinFactory.deploy(10 * 86400);
      const xchfFactory = await ethers.getContractFactory("TestToken");
      mockXCHF = await xchfFactory.deploy("CryptoFranc", "XCHF", 18);
      const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
      bridge = await bridgeFactory.deploy(
        await mockXCHF.getAddress(),
        await dEURO.getAddress(),
        limit
      );
    });

    it("should revert minting if minter is not whitelisted", async () => {
      let amount = floatToDec18(10000);
      await mockXCHF.mint(owner.address, amount);
      await mockXCHF.approve(await bridge.getAddress(), amount);
      await expect(bridge.mint(amount)).to.be.revertedWithCustomError(
        dEURO,
        "NotMinter"
      );
      await dEURO.initialize(await bridge.getAddress(), "Bridge");
      expect(await dEURO.isMinter(await bridge.getAddress())).to.be.true;
    });

    it("minter of XCHF-bridge should receive dEURO", async () => {
      let amount = floatToDec18(5000);
      let balanceBefore = await dEURO.balanceOf(owner.address);
      // set allowance
      await mockXCHF.approve(await bridge.getAddress(), amount);
      await bridge.mint(amount);

      let balanceXCHFOfBridge = await mockXCHF.balanceOf(
        await bridge.getAddress()
      );
      let balanceAfter = await dEURO.balanceOf(owner.address);
      let dEUROReceived = dec18ToFloat(balanceAfter - balanceBefore);
      let isBridgeBalanceCorrect = dec18ToFloat(balanceXCHFOfBridge) == 5000n;
      let isSenderBalanceCorrect = dEUROReceived == 5000n;
      if (!isBridgeBalanceCorrect || !isSenderBalanceCorrect) {
        console.log(
          "Bridge received XCHF tokens ",
          dec18ToFloat(balanceXCHFOfBridge)
        );
        console.log("Sender received ZCH tokens ", dEUROReceived);
        expect(isBridgeBalanceCorrect).to.be.true;
        expect(isSenderBalanceCorrect).to.be.true;
      }
    });

    it("burner of XCHF-bridge should receive XCHF", async () => {
      let amount = floatToDec18(50);
      let balanceBefore = await dEURO.balanceOf(owner.address);
      let balanceXCHFBefore = await mockXCHF.balanceOf(owner.address);
      await dEURO.approve(await bridge.getAddress(), amount);
      let allowance1 = await dEURO.allowance(
        owner.address,
        await bridge.getAddress()
      );
      expect(allowance1).to.be.eq(amount);
      let allowance2 = await dEURO.allowance(owner.address, alice.address);
      expect(allowance2).to.be.eq(floatToDec18(0));
      await dEURO.burn(amount);
      await bridge.burn(amount);
      await bridge.burnAndSend(owner.address, amount);

      let balanceXCHFOfBridge = await mockXCHF.balanceOf(
        await bridge.getAddress()
      );
      let balanceXCHFAfter = await mockXCHF.balanceOf(owner.address);
      let balanceAfter = await dEURO.balanceOf(owner.address);
      let dEUROReceived = dec18ToFloat(balanceAfter - balanceBefore);
      let XCHFReceived = dec18ToFloat(balanceXCHFAfter - balanceXCHFBefore);
      let isBridgeBalanceCorrect = dec18ToFloat(balanceXCHFOfBridge) == 4900n;
      let isSenderBalanceCorrect = dEUROReceived == -150n;
      let isXCHFBalanceCorrect = XCHFReceived == 100n;
      if (
        !isBridgeBalanceCorrect ||
        !isSenderBalanceCorrect ||
        !isXCHFBalanceCorrect
      ) {
        console.log(
          "Bridge balance XCHF tokens ",
          dec18ToFloat(balanceXCHFOfBridge)
        );
        console.log("Sender burned ZCH tokens ", -dEUROReceived);
        console.log("Sender received XCHF tokens ", XCHFReceived);
        expect(isBridgeBalanceCorrect).to.be.true;
        expect(isSenderBalanceCorrect).to.be.true;
        expect(isXCHFBalanceCorrect).to.be.true;
      }
    });

    it("should revert minting when exceed limit", async () => {
      let amount = limit + 100n;
      await mockXCHF.approve(await bridge.getAddress(), amount);
      await expect(bridge.mint(amount)).to.be.revertedWithCustomError(
        bridge,
        "Limit"
      );
    });

    it("should revert minting when bridge is expired", async () => {
      let amount = floatToDec18(1);
      await evm_increaseTime(60 * 60 * 24 * 7 * 53); // pass 53 weeks
      await mockXCHF.approve(await bridge.getAddress(), amount);
      await expect(bridge.mint(amount)).to.be.revertedWithCustomError(
        bridge,
        "Expired"
      );
    });

    it("should revert minting with reserve from non minters", async () => {
      await expect(
        dEURO.mintWithReserve(owner.address, 1000, 0, 0)
      ).to.be.revertedWithCustomError(dEURO, "NotMinter");
    });

    it("should revert burning from non minters", async () => {
      await expect(
        dEURO.burnFrom(owner.address, 1000)
      ).to.be.revertedWithCustomError(dEURO, "NotMinter");
    });

    it("should revert burning without reserve from non minters", async () => {
      await expect(
        dEURO.burnWithoutReserve(owner.address, 1000)
      ).to.be.revertedWithCustomError(dEURO, "NotMinter");
    });

    it("should revert burning with reserve from non minters", async () => {
      await expect(
        dEURO.burnWithReserve(owner.address, 1000)
      ).to.be.revertedWithCustomError(dEURO, "NotMinter");
    });

    it("should revert burning from with reserve from non minters", async () => {
      await expect(
        dEURO.burnFromWithReserve(owner.address, 0, 0)
      ).to.be.revertedWithCustomError(dEURO, "NotMinter");
    });

    it("should revert covering loss from non minters", async () => {
      await expect(dEURO.coverLoss(owner.address, 0)).to.be.revertedWithCustomError(
        dEURO,
        "NotMinter"
      );
    });

    it("should revert collecting profits from non minters", async () => {
      await expect(dEURO.collectProfits(owner.address, 7)).to.be.revertedWithCustomError(
        dEURO,
        "NotMinter"
      );
    });
  });

  describe("view func", () => {
    before(async () => {
      const euroCoinFactory = await ethers.getContractFactory("EuroCoin");
      dEURO = await euroCoinFactory.deploy(10 * 86400);

      const xchfFactory = await ethers.getContractFactory("TestToken");
      mockXCHF = await xchfFactory.deploy("CryptoFranc", "XCHF", 18);

      const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
      bridge = await bridgeFactory.deploy(
        await mockXCHF.getAddress(),
        await dEURO.getAddress(),
        limit
      );
    });
    it("calculateAssignedReserve", async () => {});
  });
});
