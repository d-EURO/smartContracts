import { expect } from 'chai';
import { floatToDec18 } from '../../scripts/utils/math';
import { ethers } from 'hardhat';
import { DecentralizedEURO, Equity, LiquidMultiSavings, Savings } from '../../typechain';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { evm_increaseTime } from '../utils';

describe('LiquidSavings Tests', () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let deuro: DecentralizedEURO;
  let equity: Equity;
  let savings: Savings;
  let liquidSavings: LiquidMultiSavings;

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    const DecentralizedEUROFactory = await ethers.getContractFactory('DecentralizedEURO');
    deuro = await DecentralizedEUROFactory.deploy(10 * 86400);

    const equityAddr = await deuro.reserve();
    equity = await ethers.getContractAt('Equity', equityAddr);

    const savingsFactory = await ethers.getContractFactory('Savings');
    savings = await savingsFactory.deploy(deuro.getAddress(), 20000n);

    const liquidSavingsFactory = await ethers.getContractFactory('LiquidMultiSavings');
    liquidSavings = await liquidSavingsFactory.deploy(deuro.getAddress(), savings.getAddress());

    // jumpstart ecosystem
    await deuro.initialize(owner.address, 'owner');
    await deuro.initialize(savings.getAddress(), 'savings');
    await deuro.initialize(liquidSavings.getAddress(), 'liquidSavings');

    await deuro.mint(owner.address, floatToDec18(2_000_000));
    await deuro.transfer(alice.address, floatToDec18(100_000));
    await deuro.transfer(bob.address, floatToDec18(100_000));

    // jumpstart deps
    await equity.invest(floatToDec18(1000), 0);
    await equity.invest(floatToDec18(1_000_000), 0);
  });

  describe('Exchange saves deuro', () => {
    it('register new liquid saver', async () => {
      await liquidSavings.proposeLiquidSaver(alice.address, false, []);
      await evm_increaseTime(7 * 86_400);
      await liquidSavings.enableLiquidSaver(alice.address);

      const i0 = await deuro.balanceOf(alice.address);
      console.log(i0);
      await evm_increaseTime(7 * 86_400);
      await liquidSavings.refresh(alice.address);
      const i1 = await deuro.balanceOf(alice.address);
      console.log(i1);
      expect(i1).to.be.greaterThan(i0 + floatToDec18(30));
    });

    it('any interests after 365days', async () => {
      await liquidSavings.proposeLiquidSaver(alice.address, false, []);
      await evm_increaseTime(7 * 86_400);
      await liquidSavings.enableLiquidSaver(alice.address);

      const i0 = await deuro.balanceOf(alice.address);
      console.log(i0);
      await evm_increaseTime(365 * 86_400);
      await liquidSavings.refresh(alice.address);
      const i1 = await deuro.balanceOf(alice.address);
      console.log(i1);
      expect(i1).to.be.greaterThan(i0 + floatToDec18(2_000));
    });

    it('not a valid account', async () => {
      await expect(liquidSavings.refresh(alice.address)).to.revertedWith(
        '[LiquidMultiSavings] This account is not eligible for liquid Savings',
      );
    });

    it('disabled account', async () => {
      await liquidSavings.proposeLiquidSaver(alice.address, false, []);
      await evm_increaseTime(7 * 86_400);
      await liquidSavings.enableLiquidSaver(alice.address);

      await liquidSavings.proposeLiquidSaver(alice.address, true, []);
      await evm_increaseTime(7 * 86_400);
      await liquidSavings.disableLiquidSaver(alice.address);

      await expect(liquidSavings.refresh(alice.address)).to.revertedWith(
        '[LiquidMultiSavings] This account is not eligible for liquid Savings',
      );
    });
  });

  describe('Governance', () => {
    it('register new liquid saver', async () => {
      await liquidSavings.proposeLiquidSaver(alice.address, false, []);

      expect((await liquidSavings.accounts(alice.address))[0]).to.be.equal(BigInt(0));
      await evm_increaseTime(7 * 86_400);
      await liquidSavings.enableLiquidSaver(alice.address);
    });

    it('unable to enable a new liquid saver before wait period', async () => {
      await liquidSavings.proposeLiquidSaver(alice.address, false, []);

      expect((await liquidSavings.accounts(alice.address))[0]).to.be.equal(BigInt(0));
      await expect(liquidSavings.enableLiquidSaver(alice.address)).to.revertedWith(
        '[LiquidMultiSavings] No action possible',
      );
    });

    it('unable to enable a new liquid saver without proposal', async () => {
      await expect(liquidSavings.enableLiquidSaver(alice.address)).to.revertedWith(
        '[LiquidMultiSavings] No action possible',
      );
    });

    it('unable to enable a already enabled liquid saver', async () => {
      await liquidSavings.proposeLiquidSaver(alice.address, false, []);

      expect((await liquidSavings.accounts(alice.address))[0]).to.be.equal(BigInt(0));
      await evm_increaseTime(7 * 86_400);
      await liquidSavings.enableLiquidSaver(alice.address);

      await expect(liquidSavings.enableLiquidSaver(alice.address)).to.revertedWith(
        '[LiquidMultiSavings] No action possible',
      );
    });

    it('unable to propose a already enabled liquid saver', async () => {
      await liquidSavings.proposeLiquidSaver(alice.address, false, []);

      expect((await liquidSavings.accounts(alice.address))[0]).to.be.equal(BigInt(0));
      await evm_increaseTime(7 * 86_400);
      await liquidSavings.enableLiquidSaver(alice.address);

      await expect(liquidSavings.proposeLiquidSaver(alice.address, false, [])).to.revertedWith(
        '[LiquidMultiSavings] No action required',
      );
    });
  });
});
