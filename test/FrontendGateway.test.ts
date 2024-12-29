import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  DecentralizedEURO,
  DEPSWrapper,
  Equity,
  FrontendGateway,
  StablecoinBridge,
  TestToken
} from "../typechain";
import { floatToDec18 } from "../scripts/math";


const oneETH = ethers.parseEther("1");

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
    wrapper = await wrapperFactory.deploy(await equity.getAddress());

    let supply = floatToDec18(1000_000);
    const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
    bridge = await bridgeFactory.deploy(
      await XEUR.getAddress(),
      await dEURO.getAddress(),
      floatToDec18(100_000_000_000),
      30
    );
    await dEURO.initialize(await bridge.getAddress(), "");

    const FrontendGatewayFactory = await ethers.getContractFactory("FrontendGateway");
    frontendGateway = await FrontendGatewayFactory.deploy(await dEURO.getAddress(), await wrapper.getAddress());
    await dEURO.initialize(await frontendGateway.getAddress(), "");

    await XEUR.mint(owner.address, supply);
    await XEUR.approve(await bridge.getAddress(), supply);
    await bridge.mint(supply);
  });


  it("Should add to the code balance", async () => {
    const frontendCode = ethers.randomBytes(32);
    const expected = await equity.calculateShares(floatToDec18(1000));
    await dEURO.approve(await frontendGateway.getAddress(), floatToDec18(100000000));
    await dEURO.approve(equity, floatToDec18(1000));
    await frontendGateway.invest(floatToDec18(1000), expected, frontendCode);

    let balance = await equity.balanceOf(owner.address);
    expect(balance).to.be.equal(floatToDec18(1000000));
    let claimableBalance = await frontendGateway.frontendCodesBalances(frontendCode);
    expect(claimableBalance).to.be.equal(floatToDec18(10));

    await frontendGateway.connect(alice).registerFrontendCode(frontendCode);
    await frontendGateway.connect(alice).withdrawRewards(frontendCode);
    balance = await dEURO.balanceOf(alice);
    expect(balance).to.be.equal(floatToDec18(10));
    claimableBalance = await frontendGateway.frontendCodesBalances(frontendCode);
    expect(claimableBalance).to.be.equal(0);
  });

  it("Should fail to invest for", async () => {
    const expected = await equity.calculateShares(floatToDec18(1000));

    await expect(equity.investFor(owner.address, floatToDec18(1000), expected)).revertedWithCustomError(equity, "NotMinter");
  });
});

