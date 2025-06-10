import { expect } from "chai";
import { floatToDec18 } from "../../scripts/utils/math";
import { ethers } from "hardhat";
import {
  Equity,
  DecentralizedEURO,
  Savings,
  LiquidSavings
} from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { evm_increaseTime } from "../utils";

describe("LiquidSavings Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let deuro: DecentralizedEURO;
  let equity: Equity;
  let savings: Savings;
  let liquidSavings: LiquidSavings;

  const getTimeStamp = async () => {
    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    return blockBefore?.timestamp ?? null;
  };

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    const DecentralizedEUROFactory =
      await ethers.getContractFactory("DecentralizedEURO");
    deuro = await DecentralizedEUROFactory.deploy(10 * 86400);

    const equityAddr = await deuro.reserve();
    equity = await ethers.getContractAt("Equity", equityAddr);

    const savingsFactory = await ethers.getContractFactory("Savings");
    savings = await savingsFactory.deploy(deuro.getAddress(), 20000n);

    const liquidSavingsFactory = await ethers.getContractFactory("LiquidSavings");
    liquidSavings = await liquidSavingsFactory.deploy(alice.address, deuro.getAddress(), savings.getAddress());

    // jumpstart ecosystem
    await deuro.initialize(owner.address, "owner");
    await deuro.initialize(savings.getAddress(), "savings");
    await deuro.initialize(liquidSavings.getAddress(), "liquidSavings");

    await deuro.mint(owner.address, floatToDec18(2_000_000));
    await deuro.transfer(alice.address, floatToDec18(100_000));
    await deuro.transfer(bob.address, floatToDec18(100_000));

    // jumpstart deps
    await equity.invest(floatToDec18(1000), 0);
    await equity.invest(floatToDec18(1_000_000), 0);
  });

  describe("Exchange saves deuro", () => {
    it("any interests after 365days", async () => {
      const i0 = await deuro.balanceOf(alice.address);
      console.log(i0);
      await evm_increaseTime(365 * 86_400);
      await liquidSavings.refresh();
      const i1 = await deuro.balanceOf(alice.address);
      console.log(i1);
      expect(i1).to.be.greaterThan(i0 + floatToDec18(2_000));
    });
  });
});
