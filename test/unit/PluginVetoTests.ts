import { expect } from "chai";
import { floatToDec18 } from "../../scripts/utils/math";
import { ethers } from "hardhat";
import { JuiceDollar, StablecoinBridge, TestToken } from "../../typechain";
import { evm_increaseTime } from "../utils";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Plugin Veto Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;

  let bridge: StablecoinBridge;
  let secondBridge: StablecoinBridge;
  let JUSD: JuiceDollar;
  let mockXUSD: TestToken;
  let mockAEUR: TestToken;

  before(async () => {
    [owner, alice] = await ethers.getSigners();
    // create contracts
    const JuiceDollarFactory =
      await ethers.getContractFactory("JuiceDollar");
    JUSD = await JuiceDollarFactory.deploy(10 * 86400);

    // mocktoken
    const XUSDFactory = await ethers.getContractFactory("TestToken");
    mockXUSD = await XUSDFactory.deploy("CryptoFranc", "XUSD", 18);
    // mocktoken bridge to bootstrap
    let limit = floatToDec18(100_000);
    let weeks = 30;
    const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
    bridge = await bridgeFactory.deploy(
      await mockXUSD.getAddress(),
      await JUSD.getAddress(),
      limit,
      weeks,
    );
    await JUSD.initialize(await bridge.getAddress(), "");
    // wait for 1 block
    await evm_increaseTime(60);
    // now we are ready to bootstrap JUSD with Mock-XUSD
    await mockXUSD.mint(owner.address, limit / 2n);
    await mockXUSD.mint(alice.address, limit / 2n);
    // mint some JUSD to block bridges without veto
    let amount = floatToDec18(20_000);
    await mockXUSD.connect(alice).approve(await bridge.getAddress(), amount);
    await bridge.connect(alice).mint(amount);
    // owner also mints some to be able to veto
    await mockXUSD.approve(await bridge.getAddress(), amount);
    await bridge.mint(amount);
  });

  describe("create secondary bridge plugin", () => {
    it("create mock AEUR token&bridge", async () => {
      let limit = floatToDec18(100_000);
      let weeks = 30;
      const XUSDFactory = await ethers.getContractFactory("TestToken");
      mockAEUR = await XUSDFactory.deploy("Test Name", "Symbol", 18);
      await mockAEUR.mint(alice.address, floatToDec18(100_000));

      const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
      secondBridge = await bridgeFactory.deploy(
        await mockAEUR.getAddress(),
        await JUSD.getAddress(),
        limit,
        weeks,
      );
    });
    it("Participant suggests minter", async () => {
      let applicationPeriod = await JUSD.MIN_APPLICATION_PERIOD();
      let applicationFee = await JUSD.MIN_FEE();
      let msg = "AEUR Bridge";
      await mockXUSD
        .connect(alice)
        .approve(await JUSD.getAddress(), applicationFee);
      let balance = await JUSD.balanceOf(alice.address);
      expect(balance).to.be.greaterThan(applicationFee);
      await JUSD.connect(alice).approve(JUSD.getAddress(), floatToDec18(1000));
      await expect(
        JUSD
          .connect(alice)
          .suggestMinter(
            await secondBridge.getAddress(),
            applicationPeriod,
            applicationFee,
            msg,
          ),
      ).to.emit(JUSD, "MinterApplied");
    });
    it("can't mint before min period", async () => {
      let amount = floatToDec18(1_000);
      await mockAEUR
        .connect(alice)
        .approve(await secondBridge.getAddress(), amount);
      // set allowance
      await expect(
        secondBridge.connect(alice).mint(amount),
      ).to.be.revertedWithCustomError(JUSD, "NotMinter");
    });
    it("deny minter", async () => {
      await expect(
        JUSD.denyMinter(await secondBridge.getAddress(), [], "other denied"),
      ).to.emit(JUSD, "MinterDenied");
      await expect(
        secondBridge.connect(alice).mint(floatToDec18(1_000)),
      ).to.be.revertedWithCustomError(JUSD, "NotMinter");
    });
  });
});
