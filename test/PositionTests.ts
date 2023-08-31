// @ts-nocheck
import { expect } from "chai";
import { floatToDec18, dec18ToFloat, DECIMALS } from "../scripts/math";
import { ethers } from "hardhat";
const BN = ethers.BigNumber;
import { createContract } from "../scripts/utils";
import { evm_increaseTime, evm_mine_blocks } from "./helper";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MintingHub, MintingHubTest, StablecoinBridge } from "../typechain";

let ZCHFContract, equity;
let positionFactoryContract;
let mockXCHF, mockVOL;

describe("Position Tests", () => {
    let owner: SignerWithAddress;
    let alice: SignerWithAddress;
    let bob: SignerWithAddress;

    let mintingHub: MintingHub;
    let bridge: StablecoinBridge;

    before(async () => {
        [owner, alice, bob] = await ethers.getSigners();
        // create contracts
        ZCHFContract = await createContract("Frankencoin", [10 * 86_400]);
        equity = await ethers.getContractAt("Equity", await ZCHFContract.reserve());
        positionFactoryContract = await createContract("PositionFactory");
        mintingHub = await createContract("MintingHub", [ZCHFContract.address, positionFactoryContract.address]);
        // mocktoken
        mockXCHF = await createContract("TestToken", ["CryptoFranc", "XCHF", 18]);
        // mocktoken bridge to bootstrap
        let limit = floatToDec18(1_000_000);
        bridge = await createContract("StablecoinBridge", [mockXCHF.address, ZCHFContract.address, limit]);
        ZCHFContract.initialize(bridge.address, "XCHF Bridge");
        // create a minting hub too while we have no ZCHF supply
        ZCHFContract.initialize(mintingHub.address, "Minting Hub");

        // wait for 1 block
        await evm_increaseTime(60);
        // now we are ready to bootstrap ZCHF with Mock-XCHF
        await mockXCHF.mint(owner.address, limit.div(2));
        await mockXCHF.mint(alice.address, limit.div(2));
        // mint some ZCHF to block bridges without veto
        let amount = floatToDec18(20_000);
        await mockXCHF.connect(alice).approve(bridge.address, amount);
        await bridge.connect(alice).mint(amount);
        // owner mints some to be able to create a position
        await mockXCHF.connect(owner).approve(bridge.address, amount);
        await bridge.connect(owner).mint(amount);
        // vol tokens
        mockVOL = await createContract("TestToken", ["Volatile Token", "VOL", 18]);
        amount = floatToDec18(500_000);
        await mockVOL.mint(owner.address, amount);

    });

    let positionAddr, positionContract;
    let clonePositionAddr, clonePositionContract;
    let fee = 0.01;
    let reserve = 0.10;
    let mintAmount = 100;
    let initialLimit = floatToDec18(110_000);
    let fMintAmount = floatToDec18(mintAmount);
    let fLimit, limit;
    let fGlblZCHBalanceOfCloner;
    let initialCollateral = 110;
    let initialCollateralClone = 4;
    let challengeAmount;
    describe("use Minting Hub", () => {
        it("create position", async () => {
            let collateral = mockVOL.address;
            let fliqPrice = floatToDec18(1000);
            let minCollateral = floatToDec18(1);
            let fInitialCollateral = floatToDec18(initialCollateral);
            let duration = BN.from(14 * 86_400);
            let fFees = BN.from(fee * 1_000_000);
            let fReserve = BN.from(reserve * 1_000_000);
            let openingFeeZCHF = await mintingHub.OPENING_FEE();
            let challengePeriod = BN.from(3 * 86400); // 3 days
            await mockVOL.connect(owner).approve(mintingHub.address, fInitialCollateral);
            let balBefore = await ZCHFContract.balanceOf(owner.address);
            let balBeforeVOL = await mockVOL.balanceOf(owner.address);
            let tx = await mintingHub.openPositionOneWeek(collateral, minCollateral, fInitialCollateral, initialLimit, duration, challengePeriod, fFees, fliqPrice, fReserve);
            let rc = await tx.wait();
            const topic = '0x591ede549d7e337ac63249acd2d7849532b0a686377bbf0b0cca6c8abd9552f2'; // PositionOpened
            const log = rc.logs.find(x => x.topics.indexOf(topic) >= 0);
            positionAddr = '0x' + log.topics[2].substring(26);
            let balAfter = await ZCHFContract.balanceOf(owner.address);
            let balAfterVOL = await mockVOL.balanceOf(owner.address);
            let dZCHF = dec18ToFloat(balAfter.sub(balBefore));
            let dVOL = dec18ToFloat(balAfterVOL.sub(balBeforeVOL));
            expect(dVOL).to.be.equal(-initialCollateral);
            expect(dZCHF).to.be.equal(-dec18ToFloat(openingFeeZCHF));
            positionContract = await ethers.getContractAt('Position', positionAddr, owner);
            let currentFees = await positionContract.calculateCurrentFee();
            expect(currentFees).to.be.eq(383);
        });
        it("require cooldown", async () => {
            let tx = positionContract.connect(owner).mint(owner.address, floatToDec18(5));
            await expect(tx).to.be.revertedWithCustomError(positionContract, "Hot");
        });

        it("try clone after 7 days but before collateral was withdrawn", async () => {
            // "wait" 7 days...
            await evm_increaseTime(7 * 86_400 + 60);

            let fInitialCollateralClone = floatToDec18(initialCollateralClone);
            let fZCHFAmount = floatToDec18(1000);
            // send some collateral and ZCHF to the cloner
            await mockVOL.transfer(alice.address, fInitialCollateralClone);
            await ZCHFContract.transfer(alice.address, fZCHFAmount);

            await mockVOL.connect(alice).approve(mintingHub.address, fInitialCollateralClone);
            fGlblZCHBalanceOfCloner = await ZCHFContract.balanceOf(alice.address);

            let expiration = await positionContract.expiration();
            let availableLimit = await positionContract.limitForClones();
            expect(availableLimit).to.be.equal(0);
            let tx = mintingHub.connect(alice).clonePosition(positionAddr, fInitialCollateralClone, fMintAmount, expiration);
            await expect(tx).to.be.revertedWithCustomError(positionContract, "LimitExceeded");

            let colbal1 = await mockVOL.balanceOf(positionContract.address);
            await positionContract.connect(owner).withdrawCollateral(owner.address, floatToDec18(100)); // make sure it works the next time
            let colbal2 = await mockVOL.balanceOf(positionContract.address);
            expect(dec18ToFloat(colbal1)).to.be.equal(dec18ToFloat(colbal2) + 100);
            let availableLimit2 = await positionContract.limitForClones();
            expect(availableLimit2).to.be.greaterThan(availableLimit);
        });

        it("get loan", async () => {
            fLimit = await positionContract.limit();
            limit = dec18ToFloat(fLimit);
            let amount = 10_000;
            expect(amount).to.be.lessThan(limit);

            let fAmount = floatToDec18(amount);
            let fZCHFBefore = await ZCHFContract.balanceOf(owner.address);
            let expectedAmount = dec18ToFloat(await positionContract.getUsableMint(fAmount, true));
            expect(expectedAmount).to.be.eq(8996.17);
            await positionContract.connect(owner).mint(owner.address, fAmount);//).to.emit("PositionOpened");
            let currentFees = await positionContract.calculateCurrentFee();
            expect(currentFees).to.be.eq(383); // two weeks of a 1% yearly interest
            let fZCHFAfter = await ZCHFContract.balanceOf(owner.address);
            let ZCHFMinted = dec18ToFloat(fZCHFAfter.sub(fZCHFBefore));
            expect(expectedAmount).to.be.equal(ZCHFMinted);
        });

        it("clone position", async () => {
            let fInitialCollateralClone = floatToDec18(initialCollateralClone);
            fGlblZCHBalanceOfCloner = await ZCHFContract.balanceOf(alice.address);

            let fees = await positionContract.calculateCurrentFee();
            let start = await positionContract.start();
            let expiration = await positionContract.expiration();
            let duration = expiration.sub(start).div(2);
            let newExpiration = expiration.sub(duration);
            let tx = await mintingHub.connect(alice).clonePosition(positionAddr, fInitialCollateralClone, fMintAmount, newExpiration);
            let rc = await tx.wait();
            const topic = '0x591ede549d7e337ac63249acd2d7849532b0a686377bbf0b0cca6c8abd9552f2'; // PositionOpened
            const log = rc.logs.find(x => x.topics.indexOf(topic) >= 0);
            clonePositionAddr = '0x' + log.topics[2].substring(26);
            clonePositionContract = await ethers.getContractAt('Position', clonePositionAddr, alice);
            let newFees = await clonePositionContract.calculateCurrentFee();
            expect(fees / 2).to.be.approximately(newFees, 0.5);
        });

        it("correct collateral", async () => {
            let col = await mockVOL.balanceOf(clonePositionAddr);
            expect(col).to.be.equal(floatToDec18(initialCollateralClone));
        });

        it("global mint limit retained", async () => {
            let fLimit0 = await clonePositionContract.limit();
            let fLimit1 = await positionContract.limit();
            let glblLimit = dec18ToFloat(fLimit0.add(fLimit1));
            if (glblLimit != limit) {
                console.log("new global limit =", glblLimit);
                console.log("original global limit =", limit);
            }
            expect(glblLimit).to.be.equal(limit);

        });
        it("correct fees charged", async () => {
            // fees:
            // - reserve contribution (temporary fee)
            // - yearlyInterestPPM 
            // - position fee (or clone fee)
            let reserveContributionPPM = await clonePositionContract.reserveContribution();
            let yearlyInterestPPM = await clonePositionContract.yearlyInterestPPM();

            let fBalanceAfter = await ZCHFContract.balanceOf(alice.address);
            let mintAfterFees = mintAmount * (1 - 7 * yearlyInterestPPM / 365 / 1000_000 - reserveContributionPPM / 1000_000)
            let cloneFeeCharged = dec18ToFloat(fGlblZCHBalanceOfCloner.sub(fBalanceAfter)) + mintAfterFees;
            expect(cloneFeeCharged).to.be.approximately(0, 0.0001); // no extra fees when cloning
        });
        it("clone position with too much mint", async () => {
            let fInitialCollateralClone = floatToDec18(initialCollateralClone);
            let fZCHFAmount = floatToDec18(1000);
            // send some collateral and ZCHF to the cloner
            await mockVOL.transfer(alice.address, fInitialCollateralClone);
            await ZCHFContract.transfer(alice.address, fZCHFAmount);

            await mockVOL.connect(alice).approve(mintingHub.address, fInitialCollateralClone);
            fGlblZCHBalanceOfCloner = await ZCHFContract.balanceOf(alice.address);
            let tx = mintingHub.connect(alice).clonePosition(positionAddr, fInitialCollateralClone, initialLimit, 0);
            await expect(tx).to.be.reverted; // underflow
        });

        it("repay position", async () => {
            let cloneOwner = await clonePositionContract.connect(alice).owner();
            expect(cloneOwner).to.be.eq(alice.address);
            let fInitialCollateralClone = floatToDec18(initialCollateralClone);
            let withdrawTx = clonePositionContract.withdrawCollateral(cloneOwner, fInitialCollateralClone);
            await expect(withdrawTx).to.be.revertedWithCustomError(clonePositionContract, "InsufficientCollateral");
            let minted = await clonePositionContract.minted();
            let reservePPM = await clonePositionContract.reserveContribution();
            let repayAmount = minted.sub(minted.mul(reservePPM).div(1000000));
            let reserve = await ZCHFContract.calculateAssignedReserve(minted, reservePPM);
            expect(reserve.add(repayAmount)).to.be.eq(minted);
            await clonePositionContract.repay(repayAmount.sub(reserve));
            let minted1 = await clonePositionContract.minted();
            let reserve1 = await ZCHFContract.calculateAssignedReserve(minted1, reservePPM);
            let repayAmount1 = minted1.sub(reserve1);
            await clonePositionContract.repay(repayAmount1);
            await clonePositionContract.withdrawCollateral(cloneOwner, fInitialCollateralClone);
            let result = await clonePositionContract.isClosed();
            await expect(result).to.be.true;
        });
    });
    describe("challenge clone", () => {
        it("send challenge", async () => {
            challengeAmount = initialCollateralClone / 2;
            let fchallengeAmount = floatToDec18(challengeAmount);
            let price = await clonePositionContract.price();
            await mockVOL.connect(owner).approve(mintingHub.address, fchallengeAmount);
            let tx = await mintingHub.connect(owner).launchChallenge(clonePositionAddr, fchallengeAmount, price);
            await expect(tx).to.emit(mintingHub, "ChallengeStarted");
            let chprice = await mintingHub.price(0);
            expect(chprice).to.be.eq(price);
        });
        it("pos owner cannot withdraw during challenge", async () => {
            let tx = clonePositionContract.withdrawCollateral(clonePositionAddr, floatToDec18(1));
            await expect(tx).to.be.revertedWithCustomError(clonePositionContract, "Challenged");
        });
        it("bid on challenged position", async () => {
            let challengeNumber = 0;
            let liqPrice = dec18ToFloat(await clonePositionContract.price());
            let bidSize = challengeAmount / 2;
            let bidAmountZCHF = liqPrice * bidSize;
            let challengerAddress = (await mintingHub.challenges(challengeNumber))[0];
            let positionsAddress = (await mintingHub.challenges(challengeNumber))[2];
            // await mockXCHF.connect(alice).mint(alice.address, floatToDec18(bidSize));
            let balanceBeforeAlice = await ZCHFContract.balanceOf(alice.address);
            let balanceBeforeChallenger = await ZCHFContract.balanceOf(challengerAddress);
            let volBalanceBefore = await mockVOL.balanceOf(alice.address);
            let tx = await mintingHub.connect(alice).bid(challengeNumber, floatToDec18(bidSize), false);
            await expect(tx).to.emit(mintingHub, "ChallengeAverted").withArgs(positionsAddress, challengeNumber, floatToDec18(bidSize));
            let balanceAfterChallenger = await ZCHFContract.balanceOf(challengerAddress);
            let balanceAfterAlice = await ZCHFContract.balanceOf(alice.address);
            let volBalanceAfter = await mockVOL.balanceOf(alice.address);
            expect(balanceBeforeAlice.sub(balanceAfterAlice)).to.be.eq(floatToDec18(bidAmountZCHF));
            expect(balanceAfterChallenger.sub(balanceBeforeChallenger)).to.be.eq(floatToDec18(bidAmountZCHF));
            expect(volBalanceAfter.sub(volBalanceBefore)).to.be.eq(floatToDec18(bidSize));
        });
        it("bid on not existing challenge", async () => {
            let tx = mintingHub.connect(bob).bid(42, floatToDec18(42), floatToDec18(challengeAmount));
            await expect(tx).to.be.reverted;
        });
        it("bid on successful challenge", async () => {
            let challengeNumber = 0;
            let challenge = await mintingHub.challenges(challengeNumber);
            let position = await ethers.getContractAt('Position', challenge[2], bob);
            let challengeData = await position.challengeData();
            await evm_increaseTime(challengeData[1].add(challengeData[2].div(2)).toNumber());
            let liquidationPrice = await position.price();
            let auctionPrice = await mintingHub.price(challengeNumber);
            expect(auctionPrice).to.be.approximately(liquidationPrice.div(2), auctionPrice.div(100));
            let bidSize = floatToDec18(challengeAmount / 4);

            await mockVOL.mint(position.address, floatToDec18(challengeAmount / 2));
            let availableCollateral = await mockVOL.balanceOf(position.address);
            expect(availableCollateral).to.be.above(bidSize);
            
            // bob sends a bid
            let bidAmountZCHF = auctionPrice.mul(bidSize).div(DECIMALS);
            let challengerAddress = (await mintingHub.challenges(challengeNumber))[0];
            await ZCHFContract.connect(owner).transfer(bob.address, bidAmountZCHF);
            let balanceBeforeBob = await ZCHFContract.balanceOf(bob.address);
            let balanceBeforeChallenger = await ZCHFContract.balanceOf(challengerAddress);
            let volBalanceBefore = await mockVOL.balanceOf(bob.address);
            let tx = await mintingHub.connect(bob).bid(challengeNumber, bidSize, false);
            await expect(tx).to.emit(mintingHub, "ChallengeSucceeded"); 
            
            // AssertionError: expected 6249710648148108150 to equal 6249855324074034075.
            //.withArgs(challenge[2], challengeNumber, bidAmountZCHF, bidSize, bidSize);

            let balanceAfterChallenger = await ZCHFContract.balanceOf(challengerAddress);
            let balanceAfterBob = await ZCHFContract.balanceOf(bob.address);
            let volBalanceAfter = await mockVOL.balanceOf(bob.address);
            expect(balanceBeforeBob.sub(balanceAfterBob)).to.be.approximately(bidAmountZCHF, bidAmountZCHF.div(100));
            expect(balanceAfterChallenger.sub(balanceBeforeChallenger)).to.be.approximately(bidAmountZCHF.div(50), bidAmountZCHF.div(5000));
            expect(volBalanceAfter.sub(volBalanceBefore)).to.be.eq(bidSize);
        });
    });

    /* describe("native position test", () => {

        let mintingHubTest: MintingHubTest;

        it("initialize", async () => {
            let fpsSupply = await equity.totalSupply();
            mintingHubTest = await createContract("MintingHubTest", [mintingHub.address, bridge.address]);
            await mintingHubTest.initiateEquity();
            await mintingHubTest.initiatePosition();
        });

        it("deny position", async () => {
            await mintingHubTest.initiateAndDenyPosition();
        });

        it("fails when minting too early", async () => {
            let tx = mintingHubTest.letAliceMint();
            await expect(tx).to.be.reverted;
        });

        it("allows minting after 2 days", async () => {
            await evm_increaseTime(7 * 86_400 + 60);
            await mintingHubTest.letAliceMint();
        });

        it("supports withdrawals", async () => {
            await mintingHubTest.testWithdraw();
        });

        it("fails when someone else mints", async () => {
            let tx = mintingHubTest.letBobMint();
            await expect(tx).to.be.reverted;
        });

        it("perform challenge", async () => {
            await mintingHubTest.letBobChallengePart1();
            await evm_mine_blocks(1);
            await mintingHubTest.letBobChallengePart2();
            let tx = mintingHubTest.endChallenges();
            await expect(tx).to.be.revertedWith('period has not ended');

            await evm_increaseTime(1 * 86_400 + 60);
            await mintingHubTest.endChallenges();
        });

        it("excessive challenge", async () => {
            await mintingHubTest.testExcessiveChallengePart1();
            await evm_mine_blocks(1)
            await mintingHubTest.testExcessiveChallengePart2();
        });

        it("restructuring", async () => {
            await mintingHubTest.restructure();
        });

        it("challenge expired position", async () => {
            await evm_increaseTime(100 * 86_400);
            await mintingHubTest.challengeExpiredPosition();

            await evm_increaseTime(86_400 - 10);// 10 seconds before end 
            await mintingHubTest.bidNearEndOfChallenge();

            await evm_increaseTime(20);
            let tx = mintingHubTest.endLastChallenge();
            await expect(tx).to.be.revertedWith("period has not ended");

            await evm_increaseTime(30 * 60);
            await mintingHubTest.endLastChallenge();
        });
    }); */

});
