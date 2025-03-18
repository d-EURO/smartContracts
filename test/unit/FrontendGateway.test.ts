import { expect } from 'chai';
import { ethers } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import {
  DecentralizedEURO,
  DEPSWrapper,
  Equity,
  FrontendGateway,
  SavingsGateway,
  StablecoinBridge,
  TestToken,
} from '../../typechain';
import { dec18ToFloat, floatToDec18 } from '../../scripts/utils/math';
import { evm_increaseTime } from '../utils';

describe('FrontendGateway Tests', () => {
  let dEURO: DecentralizedEURO;
  let XEUR: TestToken;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let frontendGateway: FrontendGateway;
  let bridge: StablecoinBridge;
  let equity: Equity;
  let wrapper: DEPSWrapper;

  before(async () => {
    [owner, alice, bob] = await ethers.getSigners();
  });

  before(async () => {
    const XEURFactory = await ethers.getContractFactory('TestToken');
    XEUR = await XEURFactory.deploy('CryptoFranc', 'XEUR', 18);

    const decentralizedEUROFactory = await ethers.getContractFactory('DecentralizedEURO');
    dEURO = await decentralizedEUROFactory.deploy(10 * 86400);
    equity = await ethers.getContractAt('Equity', await dEURO.reserve());

    const wrapperFactory = await ethers.getContractFactory('DEPSWrapper');
    wrapper = await wrapperFactory.deploy(equity.getAddress());

    let supply = floatToDec18(1000_000);
    const bridgeFactory = await ethers.getContractFactory('StablecoinBridge');
    bridge = await bridgeFactory.deploy(XEUR.getAddress(), dEURO.getAddress(), floatToDec18(100_000_000_000), 30);
    await dEURO.initialize(bridge.getAddress(), '');

    const FrontendGatewayFactory = await ethers.getContractFactory('FrontendGateway');
    frontendGateway = await FrontendGatewayFactory.deploy(dEURO.getAddress(), wrapper.getAddress());
    await dEURO.initialize(frontendGateway.getAddress(), '');

    await XEUR.mint(owner.address, supply);
    await XEUR.approve(await bridge.getAddress(), supply);
    await bridge.mint(supply);
  });

  it('Should add to the code balance', async () => {
    const frontendCode = ethers.randomBytes(32);
    const expected = await equity.calculateShares(floatToDec18(1000));
    await dEURO.approve(await frontendGateway.getAddress(), floatToDec18(100000000));
    await dEURO.approve(equity, floatToDec18(1000));
    await frontendGateway.invest(floatToDec18(1000), expected, frontendCode);

    let balance = await equity.balanceOf(owner.address);
    expect(balance).to.be.equal(floatToDec18(10000000));
    let claimableBalance = (await frontendGateway.frontendCodes(frontendCode)).balance;
    expect(claimableBalance).to.be.equal(floatToDec18(10));

    await frontendGateway.connect(alice).registerFrontendCode(frontendCode);
    await frontendGateway.connect(alice).withdrawRewards(frontendCode);
    balance = await dEURO.balanceOf(alice);
    expect(balance).to.be.equal(floatToDec18(10));
    claimableBalance = (await frontendGateway.frontendCodes(frontendCode)).balance;
    expect(claimableBalance).to.be.equal(0);
  });

  it('Should fail to transfer code ownership if triggered by non-owner', async () => {
    const frontendCode = ethers.randomBytes(32);
    await frontendGateway.connect(alice).registerFrontendCode(frontendCode);
    await expect(frontendGateway.transferFrontendCode(frontendCode, owner.address)).to.revertedWithCustomError(
      frontendGateway,
      'NotFrontendCodeOwner',
    );
  });

  it('Should successfully transfer code ownership if triggered by owner', async () => {
    const frontendCode = ethers.randomBytes(32);
    await frontendGateway.connect(alice).registerFrontendCode(frontendCode);
    let frontendCodeBefore = await frontendGateway.frontendCodes(frontendCode);
    await frontendGateway.connect(alice).transferFrontendCode(frontendCode, owner.address);
    let frontendCodeAfter = await frontendGateway.frontendCodes(frontendCode);
    expect(frontendCodeBefore.owner).to.be.equal(alice.address);
    expect(frontendCodeAfter.owner).to.be.equal(owner.address);
  });

  it('Should fail to add empty code', async () => {
    const frontendCode = ethers.ZeroHash;

    await expect(frontendGateway.registerFrontendCode(frontendCode)).to.be.revertedWithCustomError(
      frontendGateway,
      'FrontendCodeAlreadyExists',
    );
  });

  it('Should not add to empty code balance', async () => {
    const frontendCode = ethers.ZeroHash;
    const expected = await equity.calculateShares(floatToDec18(1000));
    await dEURO.approve(frontendGateway.getAddress(), floatToDec18(100000000));
    await dEURO.approve(equity, floatToDec18(1000));
    await frontendGateway.invest(floatToDec18(1000), expected, frontendCode);

    const claimableBalance = (await frontendGateway.frontendCodes(frontendCode)).balance;
    expect(claimableBalance).to.be.equal(0);
  });

  describe('Redeeming Tests', () => {
    const MIN_HOLDING_DURATION = 90 * 86400; // 90 days

    let frontendCode: Uint8Array;
    let investAmount: bigint;
    let expectedShares: bigint;
    let balanceBefore: bigint;
    let balanceAfter: bigint;

    beforeEach(async () => {
      frontendCode = ethers.randomBytes(32);
      investAmount = floatToDec18(1000);
      expectedShares = await equity.calculateShares(investAmount);
      await frontendGateway.registerFrontendCode(frontendCode);
      await dEURO.approve(frontendGateway.getAddress(), floatToDec18(100000000));
      await dEURO.approve(equity, investAmount);
      balanceBefore = await equity.balanceOf(owner.address);
      await frontendGateway.invest(investAmount, expectedShares, frontendCode);
      balanceAfter = await equity.balanceOf(owner.address);
      let frontendCodeStruct = await frontendGateway.frontendCodes(frontendCode);

      expect(balanceAfter - balanceBefore).to.be.equal(expectedShares);
      expect(frontendCodeStruct.balance).to.be.equal(floatToDec18(10));
      expect(frontendCodeStruct.owner).to.be.equal(owner.address);
    });

    it('Should fail to redeem if not enough time has passed', async () => {
      // This test requires a large block time increase, breaking other unit tests.
      // Therefore, we snapshot the state of the blockchain before running the test
      // and revert to that state after the test is done.
      const snapshotId = await ethers.provider.send('evm_snapshot', []);

      try {
        await evm_increaseTime(MIN_HOLDING_DURATION - 86400); // 89 days

        await expect(frontendGateway.redeem(owner.getAddress(), expectedShares, 0, frontendCode)).to.be.reverted;

        await evm_increaseTime(86400); // 1 additional day for 90 days total

        await equity.approve(frontendGateway.getAddress(), expectedShares);
        await expect(frontendGateway.redeem(owner.getAddress(), expectedShares, 0, frontendCode)).to.emit(
          equity,
          'Trade',
        );
      } finally {
        // Revert to the original blockchain state
        await ethers.provider.send('evm_revert', [snapshotId]);
      }
    });

    it('Should allow to unwrapAndSell DEPS prior to 90 day minimum average holding period (allows for arbitrage)', async () => {
      // This test requires a large block time increase, breaking other unit tests.
      // Therefore, we snapshot the state of the blockchain before running the test
      // and revert to that state after the test is done.
      const snapshotId = await ethers.provider.send('evm_snapshot', []);

      try {
        // 1000 dEURO to Alice, 1 dEURO to Bob
        const amountAlice = floatToDec18(1000);
        const amountBob = floatToDec18(10);
        await dEURO.transfer(await alice.getAddress(), amountAlice);
        await dEURO.transfer(await bob.getAddress(), amountBob);

        // Alice invests 1000 nDEPS and wraps them
        await dEURO.connect(alice).approve(equity, amountAlice);
        await equity.connect(alice).invest(amountAlice, 0);
        const aliceShares = await equity.calculateShares(amountAlice);
        await equity.connect(alice).approve(wrapper.getAddress(), aliceShares);
        await wrapper.connect(alice).wrap(aliceShares);

        // Increase time by 90 days
        await evm_increaseTime(MIN_HOLDING_DURATION);

        // Bob invests 10 nDEPS and wraps them
        const frontendCodeBob = ethers.randomBytes(32);
        await dEURO.connect(bob).approve(equity, amountBob);
        await dEURO.connect(bob).approve(await frontendGateway.getAddress(), amountBob);
        await frontendGateway.connect(bob).invest(amountBob, 0, frontendCodeBob);
        const bobShares = await equity.calculateShares(amountBob);
        await equity.connect(bob).approve(wrapper.getAddress(), bobShares);
        await wrapper.connect(bob).wrap(bobShares);

        // Increase time by 1 day
        await evm_increaseTime(86400);

        // At this point Bob's holding duration (equity.holdingDuration) is ~86_400 seconds (1 day)
        // on the other hand, the wrapper's holding duration is just above 7776000 seconds (90 days)
        // As a result, Bob is able to redeem and their nDEPS proceeds using the `unwrapAndSell` function
        // after only 1 day of holding, instead of the required 90 days.
        await wrapper.connect(bob).approve(frontendGateway.getAddress(), bobShares);
        expect(await equity.canRedeem(await bob.getAddress())).to.be.false;
        const bobBalanceBefore = await dEURO.balanceOf(await bob.getAddress());
        await frontendGateway.connect(bob).unwrapAndSell(bobShares, frontendCodeBob);
        const bobBalanceAfter = await dEURO.balanceOf(await bob.getAddress());
        expect(bobBalanceAfter).to.be.gt(bobBalanceBefore);
      } finally {
        // Revert to the original blockchain state
        await ethers.provider.send('evm_revert', [snapshotId]);
      }
    });

    it('Should successfully redeem', async () => {
      const snapshotId = await ethers.provider.send('evm_snapshot', []);

      try {
        await evm_increaseTime(MIN_HOLDING_DURATION);
        const redeemAmount = expectedShares / 2n;
        const expectedRedeemAmount = await equity.calculateProceeds(redeemAmount);
        const balanceBeforeAlice = await dEURO.balanceOf(alice.getAddress());
        const nDEPSbalanceBeforeOwner = await equity.balanceOf(owner.getAddress());
        await equity.approve(frontendGateway.getAddress(), redeemAmount);
        const tx = frontendGateway.redeem(alice.getAddress(), redeemAmount, expectedRedeemAmount, frontendCode);
        const expPrice =
          ((await equity.VALUATION_FACTOR()) * (await dEURO.equity()) * floatToDec18(1)) / (await equity.totalSupply());
        expect(await equity.price()).to.be.eq(expPrice);
        await expect(tx)
          .to.emit(equity, 'Trade')
          .withArgs(owner.getAddress(), -redeemAmount, expectedRedeemAmount, expPrice);
        const balanceAfterAlice = await dEURO.balanceOf(alice.getAddress());
        const nDEPSbalanceAfterOwner = await equity.balanceOf(owner.getAddress());

        expect(balanceAfterAlice - balanceBeforeAlice).to.be.equal(expectedRedeemAmount);
        expect(nDEPSbalanceBeforeOwner - nDEPSbalanceAfterOwner).to.be.equal(redeemAmount);
      } finally {
        // Revert to the original blockchain state
        await ethers.provider.send('evm_revert', [snapshotId]);
      }
    });

    it('Should successfully unwrap and sell', async () => {
      const snapshotId = await ethers.provider.send('evm_snapshot', []);

      try {
        await equity.approve(wrapper.getAddress(), expectedShares);
        await wrapper.wrap(expectedShares);
        const initWrappedBalance = await equity.balanceOf(wrapper.getAddress());
        const initWrappednDEPSbalance = await wrapper.balanceOf(owner.getAddress());
        expect(initWrappedBalance).to.be.equal(expectedShares);
        expect(initWrappednDEPSbalance).to.be.equal(expectedShares);

        await evm_increaseTime(MIN_HOLDING_DURATION);
        const unwrapAmount = initWrappedBalance / 2n;
        const frontendCodeBalanceBefore = (await frontendGateway.frontendCodes(frontendCode)).balance;
        const balanceBefore1 = await dEURO.balanceOf(owner.getAddress());
        await wrapper.approve(frontendGateway.getAddress(), unwrapAmount);
        const tx = frontendGateway.unwrapAndSell(unwrapAmount, frontendCode);
        const expectedRedeemAmount = await equity.calculateProceeds(unwrapAmount);

        await expect(tx)
          .to.emit(equity, 'Trade')
          .withArgs(wrapper.getAddress(), -unwrapAmount, expectedRedeemAmount, await equity.price());

        const wrappedBalanceAfter = await equity.balanceOf(wrapper.getAddress());
        const wrappednDEPSbalanceAfter = await wrapper.balanceOf(owner.getAddress());
        const balanceAfter1 = await dEURO.balanceOf(await owner.getAddress());
        const frontendCodeBalanceAfter = (await frontendGateway.frontendCodes(frontendCode)).balance;
        const frontendGatewayFee = await frontendGateway.feeRate();
        expect(balanceAfter1 - balanceBefore1).to.be.equal(expectedRedeemAmount);
        expect(initWrappedBalance - wrappedBalanceAfter).to.be.equal(unwrapAmount);
        expect(initWrappednDEPSbalance - wrappednDEPSbalanceAfter).to.be.equal(unwrapAmount);
        expect(frontendCodeBalanceAfter - frontendCodeBalanceBefore).to.be.equal(
          (expectedRedeemAmount * frontendGatewayFee) / 1_000_000n,
        );
      } finally {
        // Revert to the original blockchain state
        await ethers.provider.send('evm_revert', [snapshotId]);
      }
    });

    it('Should fail to withdraw rewards to if non-owner', async () => {
      expect(await frontendGateway.withdrawRewardsTo(frontendCode, alice.getAddress())).to.be.revertedWithCustomError(
        frontendGateway,
        'NotFrontendCodeOwner',
      );
    });

    it('Should successfully withdraw rewards to', async () => {
      const balanceBeforeAlice = await dEURO.balanceOf(alice.getAddress());
      const balanceBeforeEquity = await dEURO.balanceOf(equity.getAddress());
      const frontendCodeBalance = (await frontendGateway.frontendCodes(frontendCode)).balance;
      const tx = frontendGateway.withdrawRewardsTo(frontendCode, alice.getAddress());
      await expect(tx).to.emit(dEURO, 'ProfitDistributed').withArgs(alice.getAddress(), frontendCodeBalance);
      const balanceAfterAlice = await dEURO.balanceOf(alice.getAddress());
      const balanceAfterEquity = await dEURO.balanceOf(equity.getAddress());

      expect(balanceAfterAlice - balanceBeforeAlice).to.be.equal(frontendCodeBalance);
      expect(balanceBeforeEquity - balanceAfterEquity).to.be.equal(frontendCodeBalance);
    });
  });

  describe('Saving Frontend Rewards', () => {
    let savings: SavingsGateway;

    before(async () => {
      const savingsFactory = await ethers.getContractFactory('SavingsGateway');
      savings = await savingsFactory.deploy(dEURO.getAddress(), 20000n, frontendGateway.getAddress());

      await frontendGateway.init(savings.getAddress(), '0x0000000000000000000000000000000000000000');
      const applicationPeriod = await dEURO.MIN_APPLICATION_PERIOD();
      const applicationFee = await dEURO.MIN_FEE();

      await dEURO.approve(dEURO.getAddress(), floatToDec18(1000));
      await dEURO.suggestMinter(savings.getAddress(), applicationPeriod, applicationFee, '');
      await evm_increaseTime(86400 * 11);
    });

    it('Should initially have no savings', async () => {
      const account = await savings.savings(owner.address);
      expect(account.saved).to.be.equal(0);
    });

    it('any interests after 365days', async () => {
      const i0 = await dEURO.balanceOf(owner.address);
      const amount = floatToDec18(10_000);

      const frontendCode = ethers.randomBytes(32);
      await dEURO.approve(savings.getAddress(), amount);
      await savings.connect(owner)['save(uint192,bytes32)'](amount, frontendCode);
      await evm_increaseTime(365 * 86_400);

      await savings['withdraw(address,uint192)'](owner.address, 2n * amount); // as much as possible, 2x amount is enough

      const c0 = (await frontendGateway.frontendCodes(frontendCode)).balance;
      const i1 = await dEURO.balanceOf(owner.address);

      expect(dec18ToFloat(i1 - i0)).to.be.equal(200); // Because 20% of 10_000 dEURO are 200 dEURO
      expect(dec18ToFloat(c0)).to.be.equal(10); // Because 1% of 10_000 dEURO are 10 dEURO
    });

    it('save with different owner', async () => {
      const amount = floatToDec18(10_000);

      const frontendCode = ethers.randomBytes(32);
      const balanceBeforeOwner = await dEURO.balanceOf(owner.address);

      await dEURO.approve(savings.getAddress(), amount);
      const tx = savings.connect(owner)['save(address,uint192,bytes32)'](alice, amount, frontendCode);
      await expect(tx).to.emit(savings, 'Saved').withArgs(alice.address, amount);

      const balanceAfterOwner = await dEURO.balanceOf(owner.address);
      const account = await savings.savings(alice.address);

      expect(balanceBeforeOwner - balanceAfterOwner).to.be.equal(amount);
      expect(account.saved).to.be.equal(amount);
      // const lastUsedFrontendCodeAlice = await frontendGateway.lastUsedFrontendCode(alice.address);
      // expect(lastUsedFrontendCodeAlice).to.be.equal(frontendCode);
    });

    it('adjust saving amount', async () => {
      await savings.refreshBalance(owner.address);
      const savings1 = (await savings.savings(owner.address)).saved;

      // save some initial amount
      const amount = floatToDec18(10_000);
      const frontendCode = ethers.randomBytes(32);
      await dEURO.approve(savings.getAddress(), amount);
      await savings.connect(owner)['save(uint192,bytes32)'](amount, frontendCode);
      await savings.refreshBalance(owner.address);
      const savings2 = (await savings.savings(owner.address)).saved;

      expect(savings2).to.be.approximately(amount + savings1, 10n ** 15n);

      // adjust upwards
      const targetAmount = savings2 + floatToDec18(20_000);
      const balanceBefore1 = await dEURO.balanceOf(owner.address);
      await dEURO.approve(savings.getAddress(), targetAmount);
      const tx = await savings.connect(owner)['adjust(uint192,bytes32)'](targetAmount, frontendCode);
      const receipt = await tx.wait();
      const event = receipt?.logs
        .map((log) => savings.interface.parseLog(log))
        .find((parsedLog) => parsedLog?.name === 'Saved');
      const [eOwner, eAmount] = event?.args ?? [];
      const balanceAfter1 = await dEURO.balanceOf(owner.address);
      const savings3 = (await savings.savings(owner.address)).saved;

      expect(eOwner).to.be.equal(owner.address);
      expect(eAmount).to.be.approximately(targetAmount - savings2, 10n ** 15n);
      expect(savings3).to.be.equal(targetAmount);
      expect(balanceBefore1 - balanceAfter1).to.be.equal(eAmount);

      // adjust downwards
      const targetAmount2 = floatToDec18(12_000);
      const balanceBefore2 = await dEURO.balanceOf(owner.address);
      const tx2 = await savings.connect(owner)['adjust(uint192,bytes32)'](targetAmount2, frontendCode);
      const receipt2 = await tx2.wait();
      const event2 = receipt2?.logs
        .map((log) => savings.interface.parseLog(log))
        .find((parsedLog) => parsedLog?.name === 'Withdrawn');
      const [eOwner2, eAmount2] = event2?.args ?? [];
      const balanceAfter2 = await dEURO.balanceOf(owner.address);
      const savings4 = (await savings.savings(owner.address)).saved;

      expect(eOwner2).to.be.equal(owner.address);
      expect(eAmount2).to.be.approximately(savings3 - targetAmount2, 10n ** 15n);
      expect(savings4).to.be.equal(targetAmount2);
      expect(balanceAfter2 - balanceBefore2).to.be.equal(eAmount2);

      await evm_increaseTime(86400 * 3);
      const refreshTx = await savings.refreshBalance(owner.address);
      const savings5 = (await savings.savings(owner.address)).saved;
      await expect(refreshTx).to.emit(dEURO, 'ProfitDistributed').withArgs(savings, savings5 - savings4);
    });

    it('Should withdraw full amount and delete savings entry', async () => {
      const amount = floatToDec18(10_000);
      const frontendCode = ethers.randomBytes(32);
      await dEURO.approve(savings.getAddress(), amount);
      await savings.connect(owner)['save(uint192,bytes32)'](amount, frontendCode);
      const savedAmount = (await savings.savings(owner.address)).saved;

      expect(savedAmount).to.be.gt(0);

      const balanceBefore = await dEURO.balanceOf(owner.address);
      const tx = await savings
        .connect(owner)
        ['withdraw(address,uint192,bytes32)'](owner.address, savedAmount * 2n, frontendCode);
      const receipt = await tx.wait();
      const event = receipt?.logs
        .map((log) => savings.interface.parseLog(log))
        .find((parsedLog) => parsedLog?.name === 'Withdrawn');
      const [eAccount, eAmount] = event?.args ?? [];
      const savingsObj = await savings.savings(owner.address);
      const balanceAfter = await dEURO.balanceOf(owner.address);

      expect(eAccount).to.be.equal(owner.address);
      expect(eAmount).to.be.approximately(savedAmount, 10n ** 15n);
      expect(balanceAfter - balanceBefore).to.be.equal(eAmount);
      expect(savingsObj.saved).to.be.equal(0);
      expect(savingsObj.ticks).to.be.equal(0);
    });
  });

  describe('Governance Tests', () => {
    it('should be able to propose a change', async () => {
      await frontendGateway.proposeChanges(100, 20, 20, []);

      expect(await frontendGateway.nextFeeRate()).to.be.equal(100);
    });

    it('should be able to execute a change', async () => {
      await frontendGateway.proposeChanges(20_000, 20_000, 20_000, []);

      expect(await frontendGateway.feeRate()).to.be.equal(10_000);

      await evm_increaseTime(7 * 86_400);

      await frontendGateway.executeChanges();
      expect(await frontendGateway.feeRate()).to.be.equal(20_000);
    });

    it('should be unable to propose a change', async () => {
      await expect(
        frontendGateway.connect(alice).proposeChanges(20_000, 20_000, 20_000, []),
      ).to.revertedWithCustomError(equity, 'NotQualified');
    });

    it('should be unable to execute a change because there is none', async () => {
      await expect(frontendGateway.executeChanges()).to.revertedWithCustomError(frontendGateway, 'NoOpenChanges');
    });

    it('should be unable to execute a change before 7 days', async () => {
      await frontendGateway.proposeChanges(100, 100, 100, []);

      await expect(frontendGateway.executeChanges()).to.revertedWithCustomError(frontendGateway, 'NotDoneWaiting');
    });

    it('should be unable to propose to high changes', async () => {
      await expect(frontendGateway.proposeChanges(20_001, 0, 0, [])).to.revertedWithCustomError(
        frontendGateway,
        'ProposedChangesToHigh',
      );

      await expect(frontendGateway.proposeChanges(0, 1_000_001, 0, [])).to.revertedWithCustomError(
        frontendGateway,
        'ProposedChangesToHigh',
      );

      await expect(frontendGateway.proposeChanges(0, 0, 1_000_001, [])).to.revertedWithCustomError(
        frontendGateway,
        'ProposedChangesToHigh',
      );
    });
  });
});
