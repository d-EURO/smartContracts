import { expect } from "chai";
import { floatToDec, floatToDec18 } from "../../scripts/utils/math";
import { ethers } from "hardhat";
import { evm_increaseTime, evm_mineBlocks } from "../utils";
import {
  Equity,
  JuiceDollar,
  StablecoinBridge,
  TestToken,
  Savings,
} from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Equity Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let equity: Equity;
  let bridge: StablecoinBridge;
  let savings: Savings;
  let JUSD: JuiceDollar;
  let XUSD: TestToken;

  before(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    const XUSDFactory = await ethers.getContractFactory("TestToken");
    XUSD = await XUSDFactory.deploy("CryptoFranc", "XUSD", 18);
  });

  beforeEach(async () => {
    const juiceDollarFactory =
      await ethers.getContractFactory("JuiceDollar");
    JUSD = await juiceDollarFactory.deploy(10 * 86400);

    let supply = floatToDec18(1000_000);
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
    await JUSD.transfer(bob.address, floatToDec18(5000));
    equity = await ethers.getContractAt("Equity", await JUSD.reserve());
    const savingsFactory = await ethers.getContractFactory("Savings");
    savings = await savingsFactory.deploy(JUSD.getAddress(), 20000n);
  });

  describe("basic initialization", () => {
    it("should have symbol JUSD", async () => {
      let symbol = await JUSD.symbol();
      expect(symbol).to.be.equal("JUSD");
    });

    it("should have symbol JUICE", async () => {
      let symbol = await equity.symbol();
      expect(symbol).to.be.equal("JUICE");
    });

    it("should support permit interface", async () => {
      let supportsInterface = await equity.supportsInterface("0x9d8ff7da");
      expect(supportsInterface).to.be.true;
    });

    it("should have the right name", async () => {
      let symbol = await equity.name();
      expect(symbol).to.be.equal("Juice Protocol");
    });

    it("should have initial price 0.001 JUSD / JUICE", async () => {
      let price = await equity.price();
      expect(price).to.be.equal(BigInt(1e14));
    });

    it("should have some coins", async () => {
      let balance = await JUSD.balanceOf(owner.address);
      expect(balance).to.be.equal(floatToDec18(1000_000 - 5000));
    });
  });

  describe("minting shares", () => {
    it("equity does not require approval", async () => {
      const allowance = await JUSD.allowance(owner.address, equity);
      const maxAllowance = 2n ** 256n - 1n;
      expect(allowance).to.equal(maxAllowance);
      let balanceBefore = await equity.balanceOf(owner.address);
      await equity.invest(floatToDec18(1000), 0);
      let balanceAfter = await equity.balanceOf(owner.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("should revert minting less than minimum equity amount", async () => {
      await JUSD.approve(equity, floatToDec18(1000));
      await expect(
        equity.invest(floatToDec18(999), 0),
      ).to.be.revertedWithCustomError(equity, "InsufficientEquity");
    });

    // TODO: Check this again, compare to the original
    it("should revert minting when minted less than expected", async () => {
      await JUSD.approve(equity, floatToDec18(1000));
      await expect(
        equity.invest(floatToDec18(1000), floatToDec18(99999999)),
      ).to.be.revertedWithoutReason();
    });

    it("should revert minting when total supply exceeds max of uint96", async () => {
      await equity.invest(floatToDec18(1000), 0);
      const maxUint96 = floatToDec18(2n ** 96n - 1n);
      await XUSD.mint(owner.address, maxUint96);
      await XUSD.approve(await bridge.getAddress(), maxUint96);
      await bridge.mint(maxUint96);
      await expect(equity.invest(maxUint96, 0)).to.be.revertedWithCustomError(
        equity, "TotalSupplyExceeded"
      );
    });

    it("should create an initial share", async () => {
      const expected = await equity.calculateShares(floatToDec18(1000));
      await JUSD.transfer(await equity.getAddress(), 1);
      const price = await equity.price();
      expect(price).to.be.equal(floatToDec(1, 14));
      await equity.calculateShares(floatToDec18(1000));

      await JUSD.approve(equity, floatToDec18(1000));
      await equity.invest(floatToDec18(1000), expected);
      let balance = await equity.balanceOf(owner.address);
      expect(balance).to.be.equal(floatToDec18(10000000));
    });

    it("should create 1000 more shares when adding seven capital plus fees", async () => {
      await JUSD.approve(equity, floatToDec18(1000));
      await equity.invest(floatToDec18(1000), 0);
      let expected = await equity.calculateShares(floatToDec18(31000 / 0.98));
      expect(expected).to.be.approximately(
        floatToDec18(10000000),
        floatToDec18(0.01),
      );
      await JUSD.approve(equity, floatToDec18(31000 / 0.98));
      await equity.invest(floatToDec18(31000 / 0.98), expected);
      let balance = await equity.balanceOf(owner.address);
      expect(balance).to.be.approximately(
        floatToDec18(20000000),
        floatToDec18(0.01),
      );
    });

    it("should fail to investFor a different user", async () => {
      const expected = await equity.calculateShares(floatToDec18(7000 / 0.98));
      await expect(
        equity
          .connect(alice)
          .investFor(owner.address, floatToDec18(7000 / 0.98), expected),
      ).to.be.revertedWithCustomError(equity, "NotMinter");
    });
  });

  describe("voting power for savings module", () => {
    beforeEach(async () => {
      await JUSD.approve(equity, floatToDec18(1000));
      await equity.invest(floatToDec18(1000), 0);
    });

    it("Proposes a different rate", async () => {
      await savings.proposeChange(21000n, []);
      const nextRate = await savings.nextRatePPM();
      expect(nextRate).to.be.equal(21000n);
    });

    it("Proposes a different rate, without votes", async () => {
      const r = savings.connect(alice).proposeChange(21000n, []);
      await expect(r).to.be.revertedWithCustomError(equity, "NotQualified");
    });

    it("Proposes and reverts rate changes", async () => {
      await savings.proposeChange(21000n, []);
      await savings.proposeChange(20000n, []);
      expect(await savings.nextRatePPM()).to.be.equal(20000n);
    });

    it("Proposes and trying to revert without votes", async () => {
      await savings.proposeChange(21000n, []);
      const r = savings.connect(alice).proposeChange(20000n, []);
      await expect(r).to.be.revertedWithCustomError(equity, "NotQualified");
    });

    it("Proposes and apply without waiting", async () => {
      await savings.proposeChange(21000n, []);
      expect(savings.applyChange()).to.be.revertedWithCustomError(
        savings,
        "ChangeNotReady",
      );
    });

    it("Proposes, wait and apply", async () => {
      const prevRate = await savings.currentRatePPM();
      const newRate = BigInt(23123n);
      await savings.proposeChange(newRate, []);
      await evm_increaseTime(7 * 86_400 + 60);
      expect(await savings.currentRatePPM()).to.be.eq(prevRate);
      await savings.applyChange();
      expect(await savings.currentRatePPM()).to.be.eq(newRate);
    });
  });

  describe("redeem shares", () => {
    beforeEach(async () => {
      await JUSD.approve(equity, floatToDec18(1000));
      await equity.invest(floatToDec18(1000), 0);
      const expected = await equity.calculateShares(floatToDec18(7000 / 0.997));
      await JUSD.approve(equity, floatToDec18(7000 / 0.997));
      await equity.invest(floatToDec18(7000 / 0.997), expected);
    });

    it("should refuse redemption before time passed", async () => {
      expect(await equity.canRedeem(owner.address)).to.be.false;
      await expect(
        equity.redeem(owner.address, floatToDec18(0.1)),
      ).to.be.revertedWithCustomError(equity, "BelowMinimumHoldingPeriod")
    });

    it("should allow redemption after time passed", async () => {
      await evm_increaseTime(90 * 86_400 + 60);
      expect(await equity.canRedeem(owner.address)).to.be.true;
      expect(await equity.holdingDuration(owner.address)).to.be.approximately(90 * 86_400 + 60, 60);

      await expect(
        equity.calculateProceeds((await equity.totalSupply()) * 2n),
      ).to.be.revertedWithCustomError(equity, "TooManyShares");

      const redemptionAmount =
        (await equity.balanceOf(owner.address)) - floatToDec18(10000000.0);
      const equityCapital = await JUSD.balanceOf(await equity.getAddress());
      const proceeds = await equity.calculateProceeds(redemptionAmount);
      expect(proceeds).to.be.approximately(
        (equityCapital * 7n) / 8n,
        (equityCapital * 20n) / 1000n,
      );
      expect(proceeds).to.be.below((equityCapital * 7n) / 8n);
    });

    it("should be able to redeem more than expected amounts", async () => {
      await evm_increaseTime(90 * 86_400 + 60);
      expect(await equity.canRedeem(owner.address)).to.be.true;

      const redemptionAmount =
        (await equity.balanceOf(owner.address)) - floatToDec18(1000.0);
      const proceeds = await equity.calculateProceeds(redemptionAmount);
      await expect(
        equity.redeemExpected(owner.address, redemptionAmount, proceeds * 2n),
      ).to.be.revertedWithoutReason();

      const beforeBal = await JUSD.balanceOf(alice.address);
      await expect(
        equity.redeemExpected(alice.address, redemptionAmount, proceeds),
      ).to.be.emit(equity, "Trade");
      const afterBal = await JUSD.balanceOf(alice.address);
      expect(afterBal - beforeBal).to.be.equal(proceeds);
    });

    it("should be able to redeem allowed shares for share holder", async () => {
      await evm_increaseTime(90 * 86_400 + 60);

      const redemptionAmount =
        (await equity.balanceOf(owner.address)) - floatToDec18(1000.0);
      await equity.approve(alice.address, redemptionAmount);

      const proceeds = await equity.calculateProceeds(redemptionAmount);
      const beforeBal = await JUSD.balanceOf(bob.address);
      await expect(
        equity
          .connect(alice)
          .redeemFrom(
            owner.address,
            bob.address,
            redemptionAmount,
            proceeds * 2n,
          ),
      ).to.be.revertedWithoutReason();
      await equity
        .connect(alice)
        .redeemFrom(owner.address, bob.address, redemptionAmount, proceeds);
      const afterBal = await JUSD.balanceOf(bob.address);
      expect(afterBal - beforeBal).to.be.equal(proceeds);
    });
  });

  describe("transfer shares", () => {
    beforeEach(async () => {
      await JUSD.approve(equity, floatToDec18(1000));
      await equity.invest(floatToDec18(1000), 0);
      await JUSD.connect(bob).approve(equity, floatToDec18(1000));
      await equity.connect(bob).invest(floatToDec18(1000), 0);
    });
    it("total votes==sum of owner votes", async () => {
      let other = bob.address;
      let totVotesBefore = await equity.totalVotes();
      let votesBefore = [
        await equity.votes(owner.address),
        await equity.votes(other),
      ];
      let isEqual = totVotesBefore == votesBefore[0];
      if (!isEqual) {
        console.log(`1) total votes before = ${totVotesBefore}`);
        console.log(`1) sum votes before = ${votesBefore}`);
      }
      expect(isEqual).to.be.true;
      let relVotes = await equity.relativeVotes(owner.address);
      expect(relVotes).to.be.eq(BigInt(1e18));
    });

    it("total votes correct after transfer", async () => {
      let amount = 0.1;
      let other = bob.address;
      let totVotesBefore = await equity.totalVotes();
      let votesBefore = [
        await equity.votes(owner.address),
        await equity.votes(other),
      ];
      let balancesBefore = [
        await equity.balanceOf(owner.address),
        await equity.balanceOf(other),
      ];
      await equity.transfer(other, 0);
      await equity.transfer(other, floatToDec18(amount));
      let balancesAfter = [
        await equity.balanceOf(owner.address),
        await equity.balanceOf(other),
      ];
      expect(balancesAfter[1] > balancesBefore[1]).to.be.true;
      let totVotesAfter = await equity.totalVotes();
      let votesAfter = [
        await equity.votes(owner.address),
        await equity.votes(other),
      ];
      let isEqual1 = totVotesBefore == votesBefore[0];
      let isEqual2 = totVotesAfter == votesAfter[0] + votesAfter[1];
      if (!isEqual1 || !isEqual2) {
        console.log(`2) total votes before = ${totVotesBefore}`);
        console.log(`2) votes before = ${votesBefore}`);
        console.log(`2) total votes after = ${totVotesAfter}`);
        console.log(`2) votes after = ${votesAfter}`);
      }
      expect(isEqual1 && isEqual2).to.be.true;
    });

    it("total votes correct after mine", async () => {
      await evm_mineBlocks(2);
      let other = bob.address;
      let totVotesAfter = await equity.totalVotes();
      let votesAfter = [
        await equity.votes(owner.address),
        await equity.votes(other),
      ];
      let isEqual = totVotesAfter == votesAfter[0] + votesAfter[1];
      let isZero = votesAfter[1] == 0n;
      if (!isEqual || isZero) {
        console.log(`3) total votes after = ${totVotesAfter}`);
        console.log(`3) votes after = ${votesAfter}`);
      }
      expect(isEqual && !isZero).to.be.true;
    });

    it("kamikaze", async () => {
      let tx = equity
        .connect(alice)
        .kamikaze([bob.address, bob.address], 1000000n);
      await expect(tx).to.be.reverted; // account 2 has no votes

      await evm_increaseTime(80);
      let balance0 = await equity.balanceOf(owner.address);
      let balance5 = await equity.balanceOf(bob.address);
      let totalSupply = await equity.totalSupply();
      expect(balance0 + balance5).to.be.eq(totalSupply);
      let votesBefore0 = await equity.votes(owner.address);
      let votesBefore5 = await equity.votes(bob.address);
      let totalVotesBefore = await equity.totalVotes();
      expect(votesBefore0 + votesBefore5).to.be.eq(totalVotesBefore);
      await equity.kamikaze(
        [bob.address],
        votesBefore5 + balance5 * BigInt(2 ** 20),
      );
      let votesAfter0 = await equity.votes(owner.address);
      let votesAfter5 = await equity.votes(bob.address);
      expect(votesAfter5).to.be.eq(0);
      let totalVotesA = await equity.totalVotes();
      expect(totalVotesA).to.be.eq(votesAfter0);
    });
  });

  describe("delegate voting power", () => {
    beforeEach(async () => {
      await JUSD.approve(equity, floatToDec18(1000));
      await equity.invest(floatToDec18(1000), 0);
      await JUSD.connect(bob).approve(equity, floatToDec18(1000));
      await equity.connect(bob).invest(floatToDec18(1000), 0);
    });

    it("delegate vote", async () => {
      await equity.connect(bob).delegateVoteTo(alice.address);
      await equity.connect(alice).delegateVoteTo(owner.address);
      let qualified1 = await equity.votesDelegated(owner.address, [
        bob.address,
        alice.address,
      ]);
      let qualified2 = await equity.votesDelegated(owner.address, []);
      expect(qualified1 > qualified2).to.be.true;
      await expect(
        equity.votesDelegated(bob.address, [alice.address]),
      ).to.be.revertedWithoutReason();
      await expect(
        equity.votesDelegated(bob.address, [bob.address]),
      ).to.be.revertedWithoutReason();
      await expect(
        equity.votesDelegated(owner.address, [alice.address, bob.address]),
      ).to.be.revertedWithoutReason();
    });

    it("should revert qualified check when not meet quorum", async () => {
      await JUSD.transfer(alice.address, 1);
      await JUSD.connect(alice).approve(equity, 1);
      await equity.connect(alice).invest(1, 0);
      await expect(
        equity.checkQualified(alice.address, []),
      ).to.be.revertedWithCustomError(equity, "NotQualified");
    });
  });
  describe("restructure cap table", () => {
    it("should revert restructure when have enough equity", async () => {
      await JUSD.transfer(await equity.getAddress(), floatToDec18(1000));
      await expect(
        equity.restructureCapTable([], []),
      ).to.be.revertedWithoutReason();
    });

    it("should burn equity balances of given users", async () => {
      await JUSD.transfer(await equity.getAddress(), floatToDec18(100));
      await equity.restructureCapTable([], [alice.address, bob.address]);
    });
  });

  describe("StablecoinBridge Tests", () => {
    let usd: TestToken;
    let bridge: StablecoinBridge;

    beforeEach(async () => {
      const JUSDFactory = await ethers.getContractFactory("JuiceDollar");
      JUSD = await JUSDFactory.deploy(10 * 86400);

      const TokenFactory = await ethers.getContractFactory("TestToken");
      usd = await TokenFactory.deploy("Dollar Stablecoin", "USD", 6);

      const StablecoinBridgeFactory =
        await ethers.getContractFactory("StablecoinBridge");
      bridge = await StablecoinBridgeFactory.deploy(
        await usd.getAddress(),
        await JUSD.getAddress(),
        ethers.parseEther("5000"),
        30,
      );

      await JUSD.initialize(await bridge.getAddress(), "");
    });

    describe("Decimal conversion in mintTo, burn, and burnAndSend", () => {
      it("should correctly handle mintTo, burn, and burnAndSend when sourceDecimals < targetDecimals", async () => {
        const amount = ethers.parseUnits("1000", 6);
        const expectedMintAmount = ethers.parseUnits("1000", 18);

        // Mint USD and approve
        await usd.mint(alice.address, amount);
        await usd.connect(alice).approve(await bridge.getAddress(), amount);

        // Mint JUSD
        await bridge.connect(alice).mintTo(alice.address, amount);
        const aliceBalanceAfterMint = await JUSD.balanceOf(alice.address);
        expect(aliceBalanceAfterMint).to.equal(expectedMintAmount);

        // Approve JUSD for burning
        await JUSD
          .connect(alice)
          .approve(await bridge.getAddress(), expectedMintAmount);

        // Burn JUSD back to USD
        await bridge.connect(alice).burn(expectedMintAmount);
        const aliceUSDBalance = await usd.balanceOf(alice.address);
        expect(aliceUSDBalance).to.equal(amount);

        // Mint JUSD again
        await usd.connect(alice).approve(await bridge.getAddress(), amount);
        await bridge.connect(alice).mintTo(alice.address, amount);

        // Burn JUSD and send USD to owner
        const ownerUSDBalanceBefore = await usd.balanceOf(owner.address);
        await JUSD
          .connect(alice)
          .approve(await bridge.getAddress(), expectedMintAmount);
        await bridge
          .connect(alice)
          .burnAndSend(owner.address, expectedMintAmount);
        const ownerUSDBalance = await usd.balanceOf(owner.address);
        expect(ownerUSDBalance - ownerUSDBalanceBefore).to.equal(amount);
      });

      it("should correctly handle mintTo, burn, and burnAndSend when sourceDecimals > targetDecimals", async () => {
        const JUSDFactory = await ethers.getContractFactory("TestToken");
        const newJUSD = await JUSDFactory.deploy(
          "JuiceDollar",
          "JUSD",
          2,
        );

        const StablecoinBridgeFactory =
          await ethers.getContractFactory("StablecoinBridge");
        const newBridge = await StablecoinBridgeFactory.deploy(
          await usd.getAddress(),
          await newJUSD.getAddress(),
          ethers.parseEther("5000"),
          30,
        );

        await newJUSD.mint(
          newBridge.getAddress(),
          ethers.parseUnits("1000", 2),
        );

        const amount = ethers.parseUnits("1000", 6);
        const expectedMintAmount = ethers.parseUnits("1000", 2);

        await usd.mint(alice.address, amount);

        await usd.connect(alice).approve(await newBridge.getAddress(), amount);
        await newBridge.connect(alice).mintTo(alice.address, amount);
        const aliceBalanceAfterMint = await newJUSD.balanceOf(alice.address);
        expect(aliceBalanceAfterMint).to.equal(expectedMintAmount);

        await newJUSD
          .connect(alice)
          .approve(await newBridge.getAddress(), expectedMintAmount);
        await newBridge.connect(alice).burn(expectedMintAmount);
        const aliceUSDBalance = await usd.balanceOf(alice.address);
        expect(aliceUSDBalance).to.equal(amount);

        await usd.approve(await newBridge.getAddress(), amount);
        await newBridge.mintTo(alice.address, amount);
        const ownerUSDBalanceBefore = await usd.balanceOf(owner.address);

        await newJUSD
          .connect(alice)
          .approve(await newBridge.getAddress(), amount);
        await newBridge
          .connect(alice)
          .burnAndSend(owner.address, expectedMintAmount);
        const ownerUSDBalance = await usd.balanceOf(owner.address);
        expect(ownerUSDBalance - ownerUSDBalanceBefore).to.equal(amount);
      });

      it("should correctly handle mintTo, burn, and burnAndSend when sourceDecimals == targetDecimals", async () => {
        const identicalJUSD = await ethers.getContractFactory("TestToken");
        const newJUSD = await identicalJUSD.deploy("JUSD", "JUSD", 6);

        const BridgeFactory =
          await ethers.getContractFactory("StablecoinBridge");
        const identicalBridge = await BridgeFactory.deploy(
          await usd.getAddress(),
          await newJUSD.getAddress(),
          ethers.parseEther("5000"),
          30,
        );

        const amount = ethers.parseUnits("1000", 6);

        await usd.approve(await identicalBridge.getAddress(), amount);

        await identicalBridge.mintTo(alice.address, amount);
        const aliceBalanceAfterMint = await newJUSD.balanceOf(alice.address);
        expect(aliceBalanceAfterMint).to.equal(amount);

        await newJUSD
          .connect(alice)
          .approve(await identicalBridge.getAddress(), amount);
        await identicalBridge.connect(alice).burn(amount);
        const aliceUSDBalance = await usd.balanceOf(alice.address);
        expect(aliceUSDBalance).to.equal(amount);

        await usd.approve(await identicalBridge.getAddress(), amount);
        await identicalBridge.mintTo(alice.address, amount);
        const ownerUSDBalanceBefore = await usd.balanceOf(owner.address);
        await newJUSD
          .connect(alice)
          .approve(await identicalBridge.getAddress(), amount);
        await identicalBridge.connect(alice).burnAndSend(owner.address, amount);
        const ownerUSDBalance = await usd.balanceOf(owner.address);
        expect(ownerUSDBalance - ownerUSDBalanceBefore).to.equal(amount);
      });
    });
  });
});
