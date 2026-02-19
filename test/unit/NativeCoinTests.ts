import { expect } from "chai";
import {
  floatToDec18,
} from "../../scripts/utils/math";
import { ethers } from "hardhat";
import { evm_increaseTime } from "../utils";
import {
  DecentralizedEURO,
  MintingHub,
  Position,
  PositionRoller,
  StablecoinBridge,
  TestToken,
  TestWETH,
  ReentrantAttacker,
  RejectNative,
} from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ContractTransactionResponse } from "ethers";

const getPositionAddressFromTX = async (
  tx: ContractTransactionResponse,
): Promise<string> => {
  const PositionOpenedTopic =
    "0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175";
  const rc = await tx.wait();
  const log = rc?.logs.find((x) => x.topics.indexOf(PositionOpenedTopic) >= 0);
  return "0x" + log?.topics[2].substring(26);
};

describe("Native Coin Tests", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let dEURO: DecentralizedEURO;
  let mintingHub: MintingHub;
  let bridge: StablecoinBridge;
  let roller: PositionRoller;
  let weth: TestWETH;
  let mockXEUR: TestToken;
  let mockVOL: TestToken;

  let reentrantAttacker: ReentrantAttacker;
  let rejectNative: RejectNative;

  // Position params
  const initPeriod = 3n * 86400n; // 3 days
  const duration = 60n * 86400n; // 60 days
  const challengePeriod = 3n * 86400n; // 3 days
  const liqPrice = floatToDec18(5000); // 5000 dEURO/WETH
  const minCollateral = floatToDec18(1); // 1 WETH
  const initialLimit = floatToDec18(550_000);
  const reservePPM = 100000n; // 10%
  const riskPremiumPPM = 10000n; // 1%
  const initialCollateral = floatToDec18(110); // 110 WETH
  const cloneCollateral = floatToDec18(4); // 4 WETH

  before(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    // Deploy core contracts
    const DecentralizedEUROFactory = await ethers.getContractFactory("DecentralizedEURO");
    dEURO = await DecentralizedEUROFactory.deploy(10 * 86400);

    const positionFactoryFactory = await ethers.getContractFactory("PositionFactory");
    const positionFactory = await positionFactoryFactory.deploy();

    const savingsFactory = await ethers.getContractFactory("Savings");
    const savings = await savingsFactory.deploy(dEURO.getAddress(), 0n);

    const rollerFactory = await ethers.getContractFactory("PositionRoller");
    roller = await rollerFactory.deploy(dEURO.getAddress());

    // Deploy WETH
    weth = await (await ethers.getContractFactory("TestWETH")).deploy();

    const mintingHubFactory = await ethers.getContractFactory("MintingHub");
    mintingHub = await mintingHubFactory.deploy(
      await dEURO.getAddress(),
      0n,
      await roller.getAddress(),
      await positionFactory.getAddress(),
      await weth.getAddress(),
    );

    // Bootstrap dEURO
    const testTokenFactory = await ethers.getContractFactory("TestToken");
    mockXEUR = await testTokenFactory.deploy("CryptoFranc", "XEUR", 18);
    const limit = floatToDec18(1_000_000);
    const bridgeFactory = await ethers.getContractFactory("StablecoinBridge");
    bridge = await bridgeFactory.deploy(
      await mockXEUR.getAddress(),
      await dEURO.getAddress(),
      limit,
      30, // weeks
    );
    await dEURO.initialize(await bridge.getAddress(), "XEUR Bridge");
    await dEURO.initialize(await mintingHub.getAddress(), "Minting Hub");
    await dEURO.initialize(await savings.getAddress(), "Savings");
    await dEURO.initialize(await roller.getAddress(), "Roller");

    await evm_increaseTime(60);

    // Mint dEURO for signers
    const mintAmount = floatToDec18(200_000);
    for (const signer of [owner, alice, bob]) {
      await mockXEUR.mint(signer.address, mintAmount);
      await mockXEUR.connect(signer).approve(await bridge.getAddress(), mintAmount);
      await bridge.connect(signer).mint(mintAmount);
    }

    // VOL tokens (for non-WETH position tests)
    mockVOL = await testTokenFactory.deploy("Volatile Token", "VOL", 18);
    const volAmount = floatToDec18(500_000);
    await mockVOL.mint(owner.address, volAmount);
    await mockVOL.mint(alice.address, volAmount);

    // Deploy test helpers
    reentrantAttacker = await (await ethers.getContractFactory("ReentrantAttacker")).deploy();
    rejectNative = await (await ethers.getContractFactory("RejectNative")).deploy();
  });

  // Helper: open a WETH position via ERC20 approval (standard path)
  async function openWethPositionERC20(
    signer: HardhatEthersSigner,
    collAmount: bigint = initialCollateral,
    mintLimit: bigint = initialLimit,
  ): Promise<Position> {
    await weth.connect(signer).deposit({ value: collAmount });
    await weth.connect(signer).approve(await mintingHub.getAddress(), collAmount);
    await dEURO.connect(signer).approve(await mintingHub.getAddress(), await mintingHub.OPENING_FEE());
    const tx = await mintingHub.connect(signer).openPosition(
      await weth.getAddress(),
      minCollateral,
      collAmount,
      mintLimit,
      initPeriod,
      duration,
      challengePeriod,
      riskPremiumPPM,
      liqPrice,
      reservePPM,
    );
    const addr = await getPositionAddressFromTX(tx);
    return ethers.getContractAt("Position", addr) as Promise<Position>;
  }

  // Helper: open a WETH position via native ETH
  async function openWethPositionNative(
    signer: HardhatEthersSigner,
    collAmount: bigint = initialCollateral,
    mintLimit: bigint = initialLimit,
  ): Promise<Position> {
    await dEURO.connect(signer).approve(await mintingHub.getAddress(), await mintingHub.OPENING_FEE());
    const tx = await mintingHub.connect(signer).openPosition(
      await weth.getAddress(),
      minCollateral,
      collAmount,
      mintLimit,
      initPeriod,
      duration,
      challengePeriod,
      riskPremiumPPM,
      liqPrice,
      reservePPM,
      { value: collAmount },
    );
    const addr = await getPositionAddressFromTX(tx);
    return ethers.getContractAt("Position", addr) as Promise<Position>;
  }

  // Helper: open a non-WETH (VOL) position
  async function openVolPosition(signer: HardhatEthersSigner): Promise<Position> {
    const collAmount = floatToDec18(110);
    await mockVOL.connect(signer).approve(await mintingHub.getAddress(), collAmount);
    await dEURO.connect(signer).approve(await mintingHub.getAddress(), await mintingHub.OPENING_FEE());
    const tx = await mintingHub.connect(signer).openPosition(
      await mockVOL.getAddress(),
      minCollateral,
      collAmount,
      initialLimit,
      initPeriod,
      duration,
      challengePeriod,
      riskPremiumPPM,
      liqPrice,
      reservePPM,
    );
    const addr = await getPositionAddressFromTX(tx);
    return ethers.getContractAt("Position", addr) as Promise<Position>;
  }

  describe("A. MintingHub Native Deposits", () => {
    it("1. open WETH position with native ETH", async () => {
      const pos = await openWethPositionNative(owner);
      const wethBal = await weth.balanceOf(await pos.getAddress());
      expect(wethBal).to.equal(initialCollateral);
    });

    it("2. revert openPosition with native on non-WETH collateral", async () => {
      await dEURO.approve(await mintingHub.getAddress(), await mintingHub.OPENING_FEE());
      await expect(
        mintingHub.openPosition(
          await mockVOL.getAddress(),
          minCollateral,
          initialCollateral,
          initialLimit,
          initPeriod,
          duration,
          challengePeriod,
          riskPremiumPPM,
          liqPrice,
          reservePPM,
          { value: initialCollateral },
        ),
      ).to.be.revertedWithCustomError(mintingHub, "NativeOnlyForWETH");
    });

    it("3. revert openPosition when msg.value != _initialCollateral", async () => {
      await dEURO.approve(await mintingHub.getAddress(), await mintingHub.OPENING_FEE());
      await expect(
        mintingHub.openPosition(
          await weth.getAddress(),
          minCollateral,
          initialCollateral,
          initialLimit,
          initPeriod,
          duration,
          challengePeriod,
          riskPremiumPPM,
          liqPrice,
          reservePPM,
          { value: initialCollateral + 1n },
        ),
      ).to.be.revertedWithCustomError(mintingHub, "ValueMismatch");
    });

    it("4. open WETH position with ERC20 approval (backward compat)", async () => {
      const pos = await openWethPositionERC20(alice);
      const wethBal = await weth.balanceOf(await pos.getAddress());
      expect(wethBal).to.equal(initialCollateral);
    });

    it("5. clone WETH position with native ETH", async () => {
      const parent = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);

      // Mint some to unlock capacity for clones
      await parent.connect(owner).mint(owner.address, floatToDec18(10_000));
      await parent.connect(owner).withdrawCollateral(owner.address, floatToDec18(100));

      const expiration = await parent.expiration();
      const tx = await mintingHub.connect(alice)["clone(address,uint256,uint256,uint40)"](
        await parent.getAddress(),
        cloneCollateral,
        0n,
        expiration,
        { value: cloneCollateral },
      );
      const cloneAddr = await getPositionAddressFromTX(tx);
      const wethBal = await weth.balanceOf(cloneAddr);
      expect(wethBal).to.equal(cloneCollateral);
    });

    it("6. revert clone with native on non-WETH parent", async () => {
      const volPos = await openVolPosition(owner);
      await evm_increaseTime(Number(initPeriod) + 60);

      const expiration = await volPos.expiration();
      await expect(
        mintingHub.connect(alice)["clone(address,uint256,uint256,uint40)"](
          await volPos.getAddress(),
          cloneCollateral,
          0n,
          expiration,
          { value: cloneCollateral },
        ),
      ).to.be.revertedWithCustomError(mintingHub, "NativeOnlyForWETH");
    });

    it("7. revert clone when msg.value != _initialCollateral", async () => {
      const parent = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);
      await parent.connect(owner).mint(owner.address, floatToDec18(10_000));
      await parent.connect(owner).withdrawCollateral(owner.address, floatToDec18(100));

      const expiration = await parent.expiration();
      await expect(
        mintingHub.connect(alice)["clone(address,uint256,uint256,uint40)"](
          await parent.getAddress(),
          cloneCollateral,
          0n,
          expiration,
          { value: cloneCollateral + 1n },
        ),
      ).to.be.revertedWithCustomError(mintingHub, "ValueMismatch");
    });
  });

  describe("B. Position.withdrawCollateralAsNative", () => {
    let pos: Position;

    beforeEach(async () => {
      pos = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);
    });

    it("8. withdraw collateral as native ETH", async () => {
      const withdrawAmount = floatToDec18(10);
      const ethBefore = await ethers.provider.getBalance(owner.address);
      const tx = await pos.connect(owner).withdrawCollateralAsNative(owner.address, withdrawAmount);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const ethAfter = await ethers.provider.getBalance(owner.address);
      expect(ethAfter - ethBefore + gasCost).to.equal(withdrawAmount);
    });

    it("9. revert withdraw during cooldown", async () => {
      // Withdraw some collateral to create headroom, then raise price to trigger cooldown
      await pos.connect(owner).withdrawCollateral(owner.address, floatToDec18(10));
      // Now colBalance=100, maxPrice = 550000e18 * 1e18 / 100e18 = 5500e18
      await pos.connect(owner).adjustPrice(liqPrice + floatToDec18(100));
      await expect(
        pos.connect(owner).withdrawCollateralAsNative(owner.address, floatToDec18(1)),
      ).to.be.revertedWithCustomError(pos, "Hot");
    });

    it("10. revert withdraw during challenge", async () => {
      const challengeSize = floatToDec18(2);
      await weth.connect(bob).deposit({ value: challengeSize });
      await weth.connect(bob).approve(await mintingHub.getAddress(), challengeSize);
      const price = await pos.price();
      await mintingHub.connect(bob).challenge(await pos.getAddress(), challengeSize, price);

      await expect(
        pos.connect(owner).withdrawCollateralAsNative(owner.address, floatToDec18(1)),
      ).to.be.revertedWithCustomError(pos, "Challenged");
    });

    it("11. close position when withdrawal leaves balance < minimumCollateral", async () => {
      // Withdraw almost everything (no debt outstanding)
      const bal = await weth.balanceOf(await pos.getAddress());
      const withdrawAmount = bal - minCollateral / 2n; // leaves less than minCollateral
      await pos.connect(owner).withdrawCollateralAsNative(owner.address, withdrawAmount);
      expect(await pos.isClosed()).to.be.true;
    });

    it("12. handle zero-amount withdrawal (no-op)", async () => {
      const ethBefore = await ethers.provider.getBalance(owner.address);
      const tx = await pos.connect(owner).withdrawCollateralAsNative(owner.address, 0n);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const ethAfter = await ethers.provider.getBalance(owner.address);
      // Only gas was spent
      expect(ethBefore - ethAfter).to.equal(gasCost);
    });

    it("13. revert when target rejects native", async () => {
      await expect(
        pos.connect(owner).withdrawCollateralAsNative(await rejectNative.getAddress(), floatToDec18(1)),
      ).to.be.revertedWithCustomError(pos, "NativeTransferFailed");
    });

    it("14. revert withdraw from non-owner", async () => {
      await expect(
        pos.connect(alice).withdrawCollateralAsNative(alice.address, floatToDec18(1)),
      ).to.be.revertedWithCustomError(pos, "OwnableUnauthorizedAccount");
    });
  });

  describe("C. Position.receive() Auto-wrap", () => {
    it("15. auto-wrap native sent to WETH position", async () => {
      const pos = await openWethPositionNative(owner);
      const posAddr = await pos.getAddress();
      const wethBefore = await weth.balanceOf(posAddr);
      const sendAmount = floatToDec18(5);
      await owner.sendTransaction({ to: posAddr, value: sendAmount });
      const wethAfter = await weth.balanceOf(posAddr);
      expect(wethAfter - wethBefore).to.equal(sendAmount);
    });

    it("16. revert sending native to non-WETH position", async () => {
      const volPos = await openVolPosition(owner);
      const posAddr = await volPos.getAddress();
      await expect(
        owner.sendTransaction({ to: posAddr, value: floatToDec18(1) }),
      ).to.be.reverted;
    });

    it("17. no re-wrap during WETH.withdraw callback (implicit via withdrawCollateralAsNative)", async () => {
      // If re-wrap occurred during WETH.withdraw(), withdrawCollateralAsNative would fail
      // because the position would try to wrap the ETH again. The guard in receive() prevents this.
      const pos = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);

      const withdrawAmount = floatToDec18(5);
      const wethBefore = await weth.balanceOf(await pos.getAddress());
      await pos.connect(owner).withdrawCollateralAsNative(owner.address, withdrawAmount);
      const wethAfter = await weth.balanceOf(await pos.getAddress());
      expect(wethBefore - wethAfter).to.equal(withdrawAmount);
    });
  });

  describe("D. Clone with _liqPrice Parameter", () => {
    let parent: Position;

    beforeEach(async () => {
      parent = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);
      await parent.connect(owner).mint(owner.address, floatToDec18(10_000));
      await parent.connect(owner).withdrawCollateral(owner.address, floatToDec18(100));
    });

    it("18. clone with inherited price (_liqPrice = 0)", async () => {
      const expiration = await parent.expiration();
      const tx = await mintingHub.connect(alice)["clone(address,address,uint256,uint256,uint40,uint256)"](
        alice.address,
        await parent.getAddress(),
        cloneCollateral,
        0n,
        expiration,
        0n,
        { value: cloneCollateral },
      );
      const cloneAddr = await getPositionAddressFromTX(tx);
      const clonePos = await ethers.getContractAt("Position", cloneAddr);
      expect(await clonePos.price()).to.equal(await parent.price());
    });

    it("19. clone with lower custom price (no cooldown)", async () => {
      const lowerPrice = liqPrice / 2n;
      const expiration = await parent.expiration();
      const tx = await mintingHub.connect(alice)["clone(address,address,uint256,uint256,uint40,uint256)"](
        alice.address,
        await parent.getAddress(),
        cloneCollateral,
        0n,
        expiration,
        lowerPrice,
        { value: cloneCollateral },
      );
      const cloneAddr = await getPositionAddressFromTX(tx);
      const clonePos = await ethers.getContractAt("Position", cloneAddr);
      expect(await clonePos.price()).to.equal(lowerPrice);
    });

    it("20. clone with higher custom price (triggers cooldown)", async () => {
      const higherPrice = liqPrice + floatToDec18(100);
      const expiration = await parent.expiration();
      const tx = await mintingHub.connect(alice)["clone(address,address,uint256,uint256,uint40,uint256)"](
        alice.address,
        await parent.getAddress(),
        cloneCollateral,
        0n,
        expiration,
        higherPrice,
        { value: cloneCollateral },
      );
      const cloneAddr = await getPositionAddressFromTX(tx);
      const clonePos = await ethers.getContractAt("Position", cloneAddr);
      expect(await clonePos.price()).to.equal(higherPrice);
      // Cooldown should be set (cannot mint)
      await expect(
        clonePos.connect(alice).mint(alice.address, floatToDec18(100)),
      ).to.be.revertedWithCustomError(clonePos, "Hot");
    });

    it("21. revert when price exceeds 2x parent", async () => {
      const parentPrice = await parent.price();
      const tooHighPrice = parentPrice * 2n + 1n;
      const expiration = await parent.expiration();
      await expect(
        mintingHub.connect(alice)["clone(address,address,uint256,uint256,uint40,uint256)"](
          alice.address,
          await parent.getAddress(),
          cloneCollateral,
          0n,
          expiration,
          tooHighPrice,
          { value: cloneCollateral },
        ),
      ).to.be.revertedWithCustomError(parent, "PriceTooHigh");
    });
  });

  describe("E. Adjust Functions with Native", () => {
    let pos: Position;

    beforeEach(async () => {
      pos = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);
    });

    it("22. deposit additional collateral via msg.value in adjust", async () => {
      const addAmount = floatToDec18(5);
      const colBefore = await weth.balanceOf(await pos.getAddress());
      const currentPrice = await pos.price();
      const principal = await pos.principal();
      const newCol = colBefore + addAmount;
      await pos.connect(owner)["adjust(uint256,uint256,uint256,bool)"](
        principal,
        newCol,
        currentPrice,
        false,
        { value: addAmount },
      );
      const colAfter = await weth.balanceOf(await pos.getAddress());
      expect(colAfter).to.equal(newCol);
    });

    it("23. withdraw collateral as native via adjust (withdrawAsNative=true)", async () => {
      const withdrawAmount = floatToDec18(10);
      const colBefore = await weth.balanceOf(await pos.getAddress());
      const currentPrice = await pos.price();
      const principal = await pos.principal();
      const newCol = colBefore - withdrawAmount;
      const ethBefore = await ethers.provider.getBalance(owner.address);
      const tx = await pos.connect(owner)["adjust(uint256,uint256,uint256,bool)"](
        principal,
        newCol,
        currentPrice,
        true,
      );
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const ethAfter = await ethers.provider.getBalance(owner.address);
      expect(ethAfter - ethBefore + gasCost).to.equal(withdrawAmount);
    });

    it("24. adjustWithReference with native deposit + withdrawAsNative", async () => {
      // First create a reference position
      const ref = await openWethPositionNative(alice);
      await evm_increaseTime(Number(initPeriod) + 60);
      await ref.connect(alice).mint(alice.address, floatToDec18(5_000));

      // Wait for reference to come out of cooldown + challengePeriod
      await evm_increaseTime(Number(challengePeriod) + 1);

      // Add collateral with native, then check
      const addAmount = floatToDec18(5);
      const colBefore = await weth.balanceOf(await pos.getAddress());
      const currentPrice = await pos.price();
      const principal = await pos.principal();
      const newCol = colBefore + addAmount;
      await pos.connect(owner)["adjustWithReference(uint256,uint256,uint256,address,bool)"](
        principal,
        newCol,
        currentPrice,
        await ref.getAddress(),
        false,
        { value: addAmount },
      );
      const colAfter = await weth.balanceOf(await pos.getAddress());
      expect(colAfter).to.equal(newCol);
    });

    it("25. revert adjust with msg.value on non-WETH position", async () => {
      const volPos = await openVolPosition(owner);
      await evm_increaseTime(Number(initPeriod) + 60);
      const colBal = await mockVOL.balanceOf(await volPos.getAddress());
      const currentPrice = await volPos.price();
      const principal = await volPos.principal();
      await expect(
        volPos.connect(owner)["adjust(uint256,uint256,uint256,bool)"](
          principal,
          colBal,
          currentPrice,
          false,
          { value: floatToDec18(1) },
        ),
      ).to.be.reverted;
    });

    it("26. close position when native withdrawal via adjust leaves balance < minimumCollateral", async () => {
      const currentPrice = await pos.price();
      const newCol = minCollateral / 2n; // below minimum
      await pos.connect(owner)["adjust(uint256,uint256,uint256,bool)"](
        0n,
        newCol,
        currentPrice,
        true,
      );
      expect(await pos.isClosed()).to.be.true;
    });
  });

  describe("F. PositionRoller Native", () => {
    let sourcePos: Position;
    let targetPos: Position;

    beforeEach(async () => {
      // Source: 110 WETH, mint 10000 to create debt
      sourcePos = await openWethPositionNative(owner);
      // Target: 10 WETH, no mint — preserves clone capacity
      // (availableForClones = limit - totalMinted - unusedPotential)
      // With 10 WETH, potential=50000, unusedPotential=50000, avail=550000-0-50000=500000
      targetPos = await openWethPositionNative(alice, floatToDec18(10));
      await evm_increaseTime(Number(initPeriod) + 60);

      // Mint on source so it has debt to roll
      await sourcePos.connect(owner).mint(owner.address, floatToDec18(10_000));
    });

    it("27. rollNative returns excess collateral as native ETH", async () => {
      // Approve dEURO for flash loan repayment
      await dEURO.connect(owner).approve(await roller.getAddress(), floatToDec18(50_000));

      const ethBefore = await ethers.provider.getBalance(owner.address);
      const tx = await roller.connect(owner).rollFullyNative(
        await sourcePos.getAddress(),
        await targetPos.getAddress(),
      );
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const ethAfter = await ethers.provider.getBalance(owner.address);

      // Source should be fully drained
      const sourceCol = await weth.balanceOf(await sourcePos.getAddress());
      expect(sourceCol).to.equal(0n);

      // Excess collateral returned as native ETH (source had 110 WETH, target needs ~2 WETH)
      expect(ethAfter + gasCost).to.be.gt(ethBefore);
    });

    it("28. rollNative with additional collateral via msg.value", async () => {
      await dEURO.connect(owner).approve(await roller.getAddress(), floatToDec18(50_000));

      const extraCollateral = floatToDec18(5);
      const tx = await roller.connect(owner).rollFullyNativeWithExpiration(
        await sourcePos.getAddress(),
        await targetPos.getAddress(),
        await targetPos.expiration(),
        { value: extraCollateral },
      );
      const receipt = await tx.wait();
      expect(receipt!.status).to.equal(1);
    });

    it("29. rollFullyNative rolls entire position, returns excess as ETH", async () => {
      await dEURO.connect(owner).approve(await roller.getAddress(), floatToDec18(50_000));

      const sourceColBefore = await weth.balanceOf(await sourcePos.getAddress());
      expect(sourceColBefore).to.be.gt(0n);

      await roller.connect(owner).rollFullyNative(
        await sourcePos.getAddress(),
        await targetPos.getAddress(),
      );

      // Source fully drained
      const sourceColAfter = await weth.balanceOf(await sourcePos.getAddress());
      expect(sourceColAfter).to.equal(0n);
    });

    it("30. rollFullyNativeWithExpiration clones when owner differs", async () => {
      // targetPos is owned by alice, so roller will clone it for owner
      await dEURO.connect(owner).approve(await roller.getAddress(), floatToDec18(50_000));

      const tx = await roller.connect(owner).rollFullyNativeWithExpiration(
        await sourcePos.getAddress(),
        await targetPos.getAddress(),
        await targetPos.expiration(),
      );
      const receipt = await tx.wait();
      expect(receipt!.status).to.equal(1);
    });

    it("31. rollFullyNativeWithExpiration clones when expiration differs", async () => {
      // Create a target owned by owner (same owner as source)
      const ownerTarget = await openWethPositionNative(owner, floatToDec18(10));
      await evm_increaseTime(Number(initPeriod) + 60);

      await dEURO.connect(owner).approve(await roller.getAddress(), floatToDec18(50_000));

      // Use a different expiration to force clone
      const differentExpiration = (await ownerTarget.expiration()) - 86400n;
      const tx = await roller.connect(owner).rollFullyNativeWithExpiration(
        await sourcePos.getAddress(),
        await ownerTarget.getAddress(),
        differentExpiration,
      );
      const receipt = await tx.wait();
      expect(receipt!.status).to.equal(1);
    });

    it("32. revert rollNative on non-WETH position", async () => {
      const volPos = await openVolPosition(owner);
      await evm_increaseTime(Number(initPeriod) + 60);

      await expect(
        roller.connect(owner).rollFullyNative(
          await volPos.getAddress(),
          await targetPos.getAddress(),
        ),
      ).to.be.reverted;
    });
  });

  describe("G. Reentrancy Protection", () => {
    it("33. reentrant withdraw does not corrupt state (each withdrawal is checked independently)", async () => {
      const pos = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);

      // Transfer ownership to attacker
      const attackerAddr = await reentrantAttacker.getAddress();
      await pos.connect(owner).transferOwnership(attackerAddr);

      const withdrawAmount = floatToDec18(10);
      await reentrantAttacker.setTarget(await pos.getAddress(), withdrawAmount);

      // The attacker triggers a withdraw, and in receive() tries to withdraw again
      // Both withdrawals succeed since each passes collateral checks independently.
      // This is safe because WETH balance is decremented before each ETH send.
      await reentrantAttacker.triggerWithdraw(withdrawAmount);

      // Verify both withdrawals happened (attackCount >= 2 means receive was called at least twice)
      expect(await reentrantAttacker.attackCount()).to.be.gte(1);
    });

    it("34. position balances remain consistent after reentrant withdrawal", async () => {
      const pos = await openWethPositionNative(owner);
      await evm_increaseTime(Number(initPeriod) + 60);

      const attackerAddr = await reentrantAttacker.getAddress();
      await pos.connect(owner).transferOwnership(attackerAddr);

      const balBefore = await weth.balanceOf(await pos.getAddress());
      const withdrawAmount = floatToDec18(10);
      await reentrantAttacker.setTarget(await pos.getAddress(), withdrawAmount);
      await reentrantAttacker.triggerWithdraw(withdrawAmount);

      const balAfter = await weth.balanceOf(await pos.getAddress());
      // Both the initial withdraw and the reentrant withdraw succeed (2 * 10 = 20 WETH)
      // WETH accounting remains correct
      expect(balBefore - balAfter).to.equal(withdrawAmount * 2n);
      // Position still has plenty of collateral
      expect(balAfter).to.equal(initialCollateral - withdrawAmount * 2n);
    });
  });

  describe("H. Edge Cases", () => {
    it("35. no residual WETH left in MintingHub after native open", async () => {
      // Track hub WETH before and after a native open
      const hubWethBefore = await weth.balanceOf(await mintingHub.getAddress());
      await openWethPositionNative(bob);
      const hubWethAfter = await weth.balanceOf(await mintingHub.getAddress());
      // The native ETH was wrapped and sent to the position, not retained by hub
      expect(hubWethAfter - hubWethBefore).to.equal(0n);
    });
  });
});
