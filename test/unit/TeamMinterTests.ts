import { expect } from "chai";
import { floatToDec18 } from "../../scripts/utils/math";
import { ethers } from "hardhat";
import { evm_increaseTime } from "../utils";
import {
  Equity,
  JuiceDollar,
  StablecoinBridge,
  TestToken,
  TeamMinter,
} from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("TeamMinter Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let equity: Equity;
  let bridge: StablecoinBridge;
  let JUSD: JuiceDollar;
  let XUSD: TestToken;
  let teamMinter: TeamMinter;

  const TEAM_SUPPLY = floatToDec18(50_000_000); // 50M tokens

  before(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    const XUSDFactory = await ethers.getContractFactory("TestToken");
    XUSD = await XUSDFactory.deploy("CryptoFranc", "XUSD", 18);
  });

  async function deployFresh(teamSupply = TEAM_SUPPLY) {
    const juiceDollarFactory =
      await ethers.getContractFactory("JuiceDollar");
    JUSD = await juiceDollarFactory.deploy(10 * 86400);

    const supply = floatToDec18(1_000_000);
    const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
    const maxUint96 = floatToDec18(2n ** 96n - 1n);
    bridge = await bridgeFactory.deploy(
      await XUSD.getAddress(),
      await JUSD.getAddress(),
      maxUint96 * 2n,
      30,
    );
    await JUSD.initialize(await bridge.getAddress(), "");

    await XUSD.mint(owner.address, supply);
    await XUSD.approve(await bridge.getAddress(), supply);
    await bridge.mint(supply);

    equity = await ethers.getContractAt("Equity", await JUSD.reserve());

    // Bootstrap equity with 10'000 JUSD
    await equity.invest(floatToDec18(10000), 0);

    // Deploy TeamMinter — mints TEAM to deployer
    const teamMinterFactory = await ethers.getContractFactory("TeamMinter");
    teamMinter = await teamMinterFactory.deploy(
      await JUSD.getAddress(),
      teamSupply,
    );

    // Register TeamMinter as a minter
    const minFee = floatToDec18(1000);
    const minPeriod = 10 * 86400;
    await JUSD.approve(await JUSD.getAddress(), minFee);
    await JUSD.suggestMinter(
      await teamMinter.getAddress(),
      minPeriod,
      minFee,
      "TeamMinter",
    );
    await evm_increaseTime(minPeriod + 1);
  }

  beforeEach(async () => {
    await deployFresh();
  });

  describe("constructor", () => {
    it("should set immutable values correctly", async () => {
      expect(await teamMinter.JUSD()).to.equal(await JUSD.getAddress());
      expect(await teamMinter.initialSupply()).to.equal(TEAM_SUPPLY);
    });

    it("should be an ERC20 named TEAM", async () => {
      expect(await teamMinter.name()).to.equal("TEAM");
      expect(await teamMinter.symbol()).to.equal("TEAM");
    });

    it("should mint all tokens to deployer", async () => {
      expect(await teamMinter.totalSupply()).to.equal(TEAM_SUPPLY);
      expect(await teamMinter.balanceOf(owner.address)).to.equal(TEAM_SUPPLY);
    });
  });

  describe("TEAM transfers", () => {
    it("should be freely transferable", async () => {
      const share = TEAM_SUPPLY / 3n;
      await teamMinter.transfer(alice.address, share);
      await teamMinter.transfer(bob.address, share);

      expect(await teamMinter.balanceOf(alice.address)).to.equal(share);
      expect(await teamMinter.balanceOf(bob.address)).to.equal(share);
    });

    it("should support approve and transferFrom", async () => {
      const amount = floatToDec18(1000);
      await teamMinter.approve(alice.address, amount);
      await teamMinter.connect(alice).transferFrom(owner.address, bob.address, amount);
      expect(await teamMinter.balanceOf(bob.address)).to.equal(amount);
    });
  });

  describe("redeemValue()", () => {
    it("should return value based on current equity", async () => {
      const equityValue = await JUSD.equity();
      const expectedPerToken = equityValue / (2n * TEAM_SUPPLY / floatToDec18(1));

      const valueFor1Token = await teamMinter.redeemValue(floatToDec18(1));
      expect(valueFor1Token).to.equal(expectedPerToken);
    });

    it("should return 50% of equity for all tokens", async () => {
      const equityValue = await JUSD.equity();
      const totalValue = await teamMinter.redeemValue(TEAM_SUPPLY);
      expect(totalValue).to.equal(equityValue / 2n);
    });

    it("should return 0 when equity is 0", async () => {
      // Deploy fresh without equity investment
      const juiceDollarFactory = await ethers.getContractFactory("JuiceDollar");
      const freshJUSD = await juiceDollarFactory.deploy(10 * 86400);
      const teamMinterFactory = await ethers.getContractFactory("TeamMinter");
      const freshMinter = await teamMinterFactory.deploy(
        await freshJUSD.getAddress(),
        TEAM_SUPPLY,
      );

      expect(await freshMinter.redeemValue(floatToDec18(1000))).to.equal(0);
    });
  });

  describe("redeem()", () => {
    beforeEach(async () => {
      // Distribute tokens to alice and bob
      await teamMinter.transfer(alice.address, TEAM_SUPPLY / 4n);
      await teamMinter.transfer(bob.address, TEAM_SUPPLY / 4n);
    });

    it("should burn TEAM and send JUSD", async () => {
      const teamBefore = await teamMinter.balanceOf(alice.address);
      const jusdBefore = await JUSD.balanceOf(alice.address);
      const expectedJusd = await teamMinter.redeemValue(teamBefore);

      await teamMinter.connect(alice)["redeem()"]();

      expect(await teamMinter.balanceOf(alice.address)).to.equal(0);
      expect(await JUSD.balanceOf(alice.address)).to.equal(jusdBefore + expectedJusd);
    });

    it("should reduce JUSD equity", async () => {
      const equityBefore = await JUSD.equity();
      const amount = await teamMinter.balanceOf(alice.address);
      const jusdPayout = await teamMinter.redeemValue(amount);

      await teamMinter.connect(alice)["redeem()"]();

      const equityAfter = await JUSD.equity();
      expect(equityBefore - equityAfter).to.equal(jusdPayout);
    });

    it("should emit Redeemed event", async () => {
      const amount = await teamMinter.balanceOf(alice.address);
      const jusdAmount = await teamMinter.redeemValue(amount);

      await expect(teamMinter.connect(alice)["redeem()"]())
        .to.emit(teamMinter, "Redeemed")
        .withArgs(alice.address, amount, jusdAmount);
    });

    it("should revert for address with no tokens", async () => {
      const stranger = (await ethers.getSigners())[10];
      await expect(
        teamMinter.connect(stranger)["redeem()"](),
      ).to.be.revertedWithCustomError(teamMinter, "NothingToRedeem");
    });

    it("should revert after already redeemed", async () => {
      await teamMinter.connect(alice)["redeem()"]();
      await expect(
        teamMinter.connect(alice)["redeem()"](),
      ).to.be.revertedWithCustomError(teamMinter, "NothingToRedeem");
    });
  });

  describe("redeem(amount) — partial redeem", () => {
    it("should allow partial redeem", async () => {
      const half = TEAM_SUPPLY / 2n;
      const jusdBefore = await JUSD.balanceOf(owner.address);
      const expectedJusd = await teamMinter.redeemValue(half);

      await teamMinter["redeem(uint256)"](half);

      expect(await teamMinter.balanceOf(owner.address)).to.equal(TEAM_SUPPLY - half);
      expect(await JUSD.balanceOf(owner.address)).to.equal(jusdBefore + expectedJusd);
    });

    it("should revert if amount is 0", async () => {
      await expect(
        teamMinter["redeem(uint256)"](0),
      ).to.be.revertedWithCustomError(teamMinter, "NothingToRedeem");
    });

    it("should revert if amount > balance", async () => {
      const balance = await teamMinter.balanceOf(owner.address);
      await expect(
        teamMinter["redeem(uint256)"](balance + 1n),
      ).to.be.reverted; // ERC20 burn reverts
    });
  });

  describe("sequential redemption", () => {
    it("second redeemer gets less per token (equity reduced)", async () => {
      await teamMinter.transfer(alice.address, TEAM_SUPPLY / 2n);
      await teamMinter.transfer(bob.address, TEAM_SUPPLY / 2n);

      const jusdBeforeAlice = await JUSD.balanceOf(alice.address);
      await teamMinter.connect(alice)["redeem()"]();
      const aliceGot = (await JUSD.balanceOf(alice.address)) - jusdBeforeAlice;

      const jusdBeforeBob = await JUSD.balanceOf(bob.address);
      await teamMinter.connect(bob)["redeem()"]();
      const bobGot = (await JUSD.balanceOf(bob.address)) - jusdBeforeBob;

      // Both had the same number of tokens
      // Alice redeemed first → got more (equity was higher)
      expect(aliceGot).to.be.gt(bobGot);
    });

    it("total payout is less than 50% of original equity", async () => {
      await teamMinter.transfer(alice.address, TEAM_SUPPLY / 2n);
      await teamMinter.transfer(bob.address, TEAM_SUPPLY / 2n);

      const equityBefore = await JUSD.equity();

      const jusdBeforeAlice = await JUSD.balanceOf(alice.address);
      await teamMinter.connect(alice)["redeem()"]();
      const aliceGot = (await JUSD.balanceOf(alice.address)) - jusdBeforeAlice;

      const jusdBeforeBob = await JUSD.balanceOf(bob.address);
      await teamMinter.connect(bob)["redeem()"]();
      const bobGot = (await JUSD.balanceOf(bob.address)) - jusdBeforeBob;

      const totalPayout = aliceGot + bobGot;
      expect(totalPayout).to.be.lt(equityBefore / 2n);
    });
  });

  describe("value grows with equity", () => {
    it("redeem value increases when more JUSD is invested", async () => {
      const valueBefore = await teamMinter.redeemValue(floatToDec18(1));

      // More investment → equity grows
      await equity.invest(floatToDec18(100000), 0);

      const valueAfter = await teamMinter.redeemValue(floatToDec18(1));
      expect(valueAfter).to.be.gt(valueBefore);
    });
  });
});
