import { expect } from "chai";
import { floatToDec18 } from "../../scripts/math";
import { ethers } from "hardhat";
import {
  Equity,
  DecentralizedEURO,
  MintingHub,
  Position,
  PositionFactory,
  PositionRoller,
  Savings,
  TestToken,
} from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { evm_increaseTime } from "../utils";

describe("Savings Tests - Save without Compounding", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let deuro: DecentralizedEURO;
  let equity: Equity;
  let roller: PositionRoller;
  let savings: Savings;

  let positionFactory: PositionFactory;
  let mintingHub: MintingHub;

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    const DecentralizedEUROFactory =
      await ethers.getContractFactory("DecentralizedEURO");
    deuro = await DecentralizedEUROFactory.deploy(10 * 86400);

    const equityAddr = await deuro.reserve();
    equity = await ethers.getContractAt("Equity", equityAddr);

    const positionFactoryFactory =
      await ethers.getContractFactory("PositionFactory");
    positionFactory = await positionFactoryFactory.deploy();

    const savingsFactory = await ethers.getContractFactory("Savings");
    savings = await savingsFactory.deploy(deuro.getAddress(), 20000n); // 2% interest rate

    const rollerFactory = await ethers.getContractFactory("PositionRoller");
    roller = await rollerFactory.deploy(deuro.getAddress());

    const mintingHubFactory = await ethers.getContractFactory("MintingHub");
    mintingHub = await mintingHubFactory.deploy(
      await deuro.getAddress(),
      await savings.getAddress(),
      await roller.getAddress(),
      await positionFactory.getAddress(),
    );

    // jump start ecosystem
    await deuro.initialize(owner.address, "owner");
    await deuro.initialize(await mintingHub.getAddress(), "mintingHub");
    await deuro.initialize(await savings.getAddress(), "savings");

    await deuro.mint(owner.address, floatToDec18(2_000_000));
    await deuro.transfer(alice.address, floatToDec18(100_000));
    await deuro.transfer(bob.address, floatToDec18(100_000));

    // jump start fps
    await equity.invest(floatToDec18(1000), 0);
    await deuro.connect(alice).approve(await equity.getAddress(), floatToDec18(10_000));
    await equity.connect(alice).invest(floatToDec18(10_000), 0);
    await deuro.connect(bob).approve(await equity.getAddress(), floatToDec18(10_000));
    await equity.connect(bob).invest(floatToDec18(10_000), 0);
    await equity.invest(floatToDec18(1_000_000), 0);
  });

  describe("Save function (without compounding)", () => {
    it("should save without adding accrued interest to principal using save()", async () => {
      const amount = floatToDec18(1000);
      
      // First save without compounding
      await deuro.approve(savings.getAddress(), amount * 3n);
      await savings["save(uint192)"](amount);
      
      // Check initial balance
      let account = await savings.savings(owner.address);
      expect(account.saved).to.equal(amount);
      
      // Advance time by 1 year to accrue interest
      await evm_increaseTime(365 * 24 * 60 * 60);
      
      // Since we saved without compounding, no interest should accrue
      const expectedInterest = await savings.accruedInterest(owner.address);
      expect(expectedInterest).to.be.closeTo(0, floatToDec18(0.1));
      
      // Save additional amount without compounding
      await savings["save(uint192)"](amount);
      
      // Check that saved amount increased
      account = await savings.savings(owner.address);
      expect(account.saved).to.equal(amount * 2n); // Should be 2000
      
      // Interest should still be 0 as all was saved without compounding
      const stillAccruingInterest = await savings.accruedInterest(owner.address);
      expect(stillAccruingInterest).to.be.closeTo(0, floatToDec18(0.1));
    });

    it("should allow multiple saves without compounding using save()", async () => {
      const amount = floatToDec18(1000);
      
      // Approve enough for all transactions
      await deuro.approve(savings.getAddress(), amount * 5n);
      
      // First save with compound
      await savings["saveAndCompound(uint192)"](amount);
      
      // Advance time by 6 months
      await evm_increaseTime(182 * 24 * 60 * 60);
      
      // Save without compounding
      await savings["save(uint192)"](amount);
      
      // Advance another 6 months
      await evm_increaseTime(183 * 24 * 60 * 60);
      
      // Save without compounding again
      await savings["save(uint192)"](amount);
      
      // Check final state
      const account = await savings.savings(owner.address);
      expect(account.saved).to.equal(amount * 3n); // 3000 dEURO without compounding
      
      // Interest should be calculated on original amount only
      const accruedInterest = await savings.accruedInterest(owner.address);
      // ~2% of 1000 for 1 year = 20 dEURO (interest only on first 1000)
      expect(accruedInterest).to.be.closeTo(floatToDec18(20), floatToDec18(1));
    });

    it("should work correctly for new accounts", async () => {
      const amount = floatToDec18(500);
      
      // Alice saves without any prior balance
      await deuro.connect(alice).approve(savings.getAddress(), amount);
      await savings.connect(alice)["save(uint192)"](amount);
      
      // Check Alice's balance
      const account = await savings.savings(alice.address);
      expect(account.saved).to.equal(amount);
      expect(account.ticks).to.be.gt(0); // Ticks should be initialized
    });

    it("should allow saveAndCompound with compounding", async () => {
      const amount = floatToDec18(1000);
      
      await deuro.approve(savings.getAddress(), amount * 3n);
      
      // First save with compound
      await savings["saveAndCompound(uint192)"](amount);
      
      // Advance time by 1 year
      await evm_increaseTime(365 * 24 * 60 * 60);
      
      // SaveAndCompound should compound interest
      await savings["saveAndCompound(uint192)"](amount);
      
      // Check that interest was compounded
      const account = await savings.savings(owner.address);
      // Should be ~2020 (1000 + 20 interest + 1000 new)
      expect(account.saved).to.be.closeTo(floatToDec18(2020), floatToDec18(1));
    });

    it("should emit correct events", async () => {
      const amount = floatToDec18(1000);
      
      await deuro.approve(savings.getAddress(), amount);
      
      // Check that Saved event is emitted
      await expect(savings["save(uint192)"](amount))
        .to.emit(savings, "Saved")
        .withArgs(owner.address, amount);
    });

    it("should revert when module is disabled", async () => {
      // Propose rate change to 0
      await savings.proposeChange(0, []);
      
      // Advance time by 7 days to apply change
      await evm_increaseTime(7 * 24 * 60 * 60);
      await savings.applyChange();
      
      const amount = floatToDec18(1000);
      await deuro.approve(savings.getAddress(), amount);
      
      // Should revert with ModuleDisabled error
      await expect(
        savings["save(uint192)"](amount)
      ).to.be.revertedWithCustomError(savings, "ModuleDisabled");
    });
  });

  describe("Save for another address (without compounding)", () => {
    it("should allow saving for another address without compounding", async () => {
      const amount = floatToDec18(1000);
      
      // First save with compound for Alice to establish a base
      await deuro.approve(savings.getAddress(), amount * 3n);
      await savings["saveAndCompound(address,uint192)"](alice.address, amount);
      
      // Check Alice's initial balance
      let account = await savings.savings(alice.address);
      expect(account.saved).to.equal(amount);
      
      // Advance time
      await evm_increaseTime(365 * 24 * 60 * 60);
      
      // Save more for Alice without compounding
      await savings["save(address,uint192)"](alice.address, amount);
      
      // Check that Alice's balance increased without compounding
      account = await savings.savings(alice.address);
      expect(account.saved).to.equal(amount * 2n);
      
      // Interest should still be accruing on the original amount only
      const accruedInterest = await savings.accruedInterest(alice.address);
      expect(accruedInterest).to.be.closeTo(floatToDec18(20), floatToDec18(1));
    });
  });
});