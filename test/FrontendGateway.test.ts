import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  DecentralizedEURO,
  DEPSWrapper,
  Equity,
  FrontendGateway,
  SavingsGateway,
  StablecoinBridge,
  TestToken,
} from "../typechain";
import { dec18ToFloat, floatToDec18 } from "../scripts/math";
import { evm_increaseTime } from "./helper";

describe("FrontendGateway Tests", () => {
  let dEURO: DecentralizedEURO;
  let XEUR: TestToken;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let frontendGateway: FrontendGateway;
  let bridge: StablecoinBridge;
  let equity: Equity;
  let wrapper: DEPSWrapper;

  before(async () => {
    [owner, alice] = await ethers.getSigners();
  });

  before(async () => {
    const XEURFactory = await ethers.getContractFactory("TestToken");
    XEUR = await XEURFactory.deploy("CryptoFranc", "XEUR", 18);

    const decentralizedEUROFactory =
      await ethers.getContractFactory("DecentralizedEURO");
    dEURO = await decentralizedEUROFactory.deploy(10 * 86400);
    equity = await ethers.getContractAt("Equity", await dEURO.reserve());

    const wrapperFactory = await ethers.getContractFactory("DEPSWrapper");
    wrapper = await wrapperFactory.deploy(equity.getAddress());

    let supply = floatToDec18(1000_000);
    const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
    bridge = await bridgeFactory.deploy(
      XEUR.getAddress(),
      dEURO.getAddress(),
      floatToDec18(100_000_000_000),
      30,
    );
    await dEURO.initialize(bridge.getAddress(), "");

    const FrontendGatewayFactory =
      await ethers.getContractFactory("FrontendGateway");
    frontendGateway = await FrontendGatewayFactory.deploy(
      dEURO.getAddress(),
      wrapper.getAddress(),
    );
    await dEURO.initialize(frontendGateway.getAddress(), "");

    await XEUR.mint(owner.address, supply);
    await XEUR.approve(await bridge.getAddress(), supply);
    await bridge.mint(supply);
  });

  it("Should add to the code balance", async () => {
    const frontendCode = ethers.randomBytes(32);
    const expected = await equity.calculateShares(floatToDec18(1000));
    await dEURO.approve(frontendGateway.getAddress(), floatToDec18(100000000));
    await frontendGateway.invest(floatToDec18(1000), expected, frontendCode);

    let balance = await equity.balanceOf(owner.address);
    expect(balance).to.be.equal(floatToDec18(1000000));
    let claimableBalance = (await frontendGateway.frontendCodes(frontendCode))
      .balance;
    expect(claimableBalance).to.be.equal(floatToDec18(10));

    await frontendGateway.connect(alice).registerFrontendCode(frontendCode);
    await frontendGateway.connect(alice).withdrawRewards(frontendCode);
    balance = await dEURO.balanceOf(alice);
    expect(balance).to.be.equal(floatToDec18(10));
    claimableBalance = (await frontendGateway.frontendCodes(frontendCode))
      .balance;
    expect(claimableBalance).to.be.equal(0);
  });

  describe("Saving Frontend Rewards", () => {
    let savings: SavingsGateway;

    before(async () => {
      const savingsFactory = await ethers.getContractFactory("SavingsGateway");
      savings = await savingsFactory.deploy(
        dEURO.getAddress(),
        20000n,
        frontendGateway.getAddress(),
      );

      await frontendGateway.initSavings(savings.getAddress());
      const applicationPeriod = await dEURO.MIN_APPLICATION_PERIOD();
      const applicationFee = await dEURO.MIN_FEE();

      await dEURO.suggestMinter(
        savings.getAddress(),
        applicationPeriod,
        applicationFee,
        "",
      );
      await evm_increaseTime(86400 * 11);
    });

    it("any interests after 365days", async () => {
      const i0 = await dEURO.balanceOf(owner.address);
      const amount = floatToDec18(10_000);

      const frontendCode = ethers.randomBytes(32);
      await frontendGateway.save(owner, amount, frontendCode);
      await evm_increaseTime(365 * 86_400);

      await savings.withdraw(owner.address, 2n * amount); // as much as possible, 2x amount is enough

      const c0 = (await frontendGateway.frontendCodes(frontendCode)).balance;
      const i1 = await dEURO.balanceOf(owner.address);

      expect(dec18ToFloat(i1 - i0)).to.be.equal(200); // Because 20% of 10_000 dEURO are 200 dEURO
      expect(dec18ToFloat(c0)).to.be.equal(10); // Because 1% of 10_000 dEURO are 10 dEURO
    });
  });

  describe("Governance Tests", () => {
    it("should be able to propose a change", async () => {
      await frontendGateway.proposeChanges(100, 20, []);

      expect(await frontendGateway.nextFeeRate()).to.be.equal(100);
    });

    it("should be able to execute a change", async () => {
      await frontendGateway.proposeChanges(100, 20, []);

      expect(await frontendGateway.feeRate()).to.be.equal(10);

      await evm_increaseTime(7 * 86_400);

      await frontendGateway.executeChanges();
      expect(await frontendGateway.feeRate()).to.be.equal(100);
    });

    it("should be unable to propose a change", async () => {
      await expect(
        frontendGateway.connect(alice).proposeChanges(100, 20, []),
      ).to.revertedWithCustomError(equity, "NotQualified");
    });

    it("should be unable to execute a change because there is none", async () => {
      await expect(frontendGateway.executeChanges()).to.revertedWithCustomError(
        frontendGateway,
        "NoOpenChanges",
      );
    });

    it("should be unable to execute a change before 7 days", async () => {
      await frontendGateway.proposeChanges(100, 100, []);

      await expect(frontendGateway.executeChanges()).to.revertedWithCustomError(
        frontendGateway,
        "NotDoneWaiting",
      );
    });
  });
});
