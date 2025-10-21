import { expect } from 'chai';
import { ethers } from 'hardhat';
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ContractTransactionResponse } from "ethers";
import { floatToDec18 } from '../../scripts/utils/math';
import { evm_increaseTime } from '../utils';
import {
  CoinLendingGateway,
  DecentralizedEURO,
  MintingHubGateway,
  Position,
  TestWETH,
  FrontendGateway,
  Savings,
  PositionRoller,
  PositionFactory,
  TestToken,
  StablecoinBridge,
} from "../../typechain";

describe('CoinLendingGateway Tests', () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let coinLendingGateway: CoinLendingGateway;
  let dEURO: DecentralizedEURO;
  let mintingHub: MintingHubGateway;
  let testWETH: TestWETH;
  let gateway: FrontendGateway;
  let savings: Savings;
  let roller: PositionRoller;
  let positionFactory: PositionFactory;
  let bridge: StablecoinBridge;
  let mockXEUR: TestToken;

  let parentPosition: string;
  let parentPositionContract: Position;

  const frontendCode = ethers.randomBytes(32);
  const initialLimit = floatToDec18(1_000_000);
  const minCollateral = floatToDec18(3);
  const liqPrice = floatToDec18(2000); // 1 ETH = 2000 dEURO
  const reservePPM = 100_000; // 10%
  const riskPremiumPPM = 10_000; // 1%
  const duration = 365n * 86_400n; // 1 year
  const challengePeriod = 3n * 86_400n; // 3 days
  const initPeriod = 7n * 86_400n; // 7 days

  const getPositionAddressFromTX = async (tx: ContractTransactionResponse): Promise<string> => {
    const PositionOpenedTopic = '0xc9b570ab9d98bdf3e38a40fd71b20edafca42449f23ca51f0bdcbf40e8ffe175';
    const rc = await tx.wait();
    const log = rc?.logs.find((x) => x.topics.indexOf(PositionOpenedTopic) >= 0);
    return '0x' + log?.topics[2].substring(26);
  };

  before(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    // Deploy dEURO
    const DecentralizedEUROFactory = await ethers.getContractFactory('DecentralizedEURO');
    dEURO = await DecentralizedEUROFactory.deploy(10 * 86400);

    // Deploy TestWETH
    const TestWETHFactory = await ethers.getContractFactory('TestWETH');
    testWETH = await TestWETHFactory.deploy();

    // Deploy FrontendGateway
    const GatewayFactory = await ethers.getContractFactory('FrontendGateway');
    gateway = await GatewayFactory.deploy(dEURO.getAddress(), '0x0000000000000000000000000000000000000000');

    // Deploy PositionFactory
    const PositionFactoryFactory = await ethers.getContractFactory('PositionFactory');
    positionFactory = await PositionFactoryFactory.deploy();

    // Deploy Savings
    const SavingsFactory = await ethers.getContractFactory('Savings');
    savings = await SavingsFactory.deploy(dEURO.getAddress(), 0n);

    // Deploy PositionRoller
    const RollerFactory = await ethers.getContractFactory('PositionRoller');
    roller = await RollerFactory.deploy(dEURO.getAddress());

    // Deploy MintingHubGateway
    const MintingHubFactory = await ethers.getContractFactory('MintingHubGateway');
    mintingHub = await MintingHubFactory.deploy(
      dEURO.getAddress(),
      savings.getAddress(),
      roller.getAddress(),
      positionFactory.getAddress(),
      gateway.getAddress(),
    );

    // Initialize gateway
    await gateway.init('0x0000000000000000000000000000000000000000', mintingHub.getAddress());

    // Create mockXEUR and bridge to bootstrap dEURO
    const TestTokenFactory = await ethers.getContractFactory('TestToken');
    mockXEUR = await TestTokenFactory.deploy('CryptoFranc', 'XEUR', 18);

    const bridgeLimit = floatToDec18(1_000_000);
    const BridgeFactory = await ethers.getContractFactory('StablecoinBridge');
    bridge = await BridgeFactory.deploy(mockXEUR.getAddress(), dEURO.getAddress(), bridgeLimit, 30);

    // Initialize dEURO
    await dEURO.initialize(bridge.getAddress(), 'XEUR Bridge');
    await dEURO.initialize(mintingHub.getAddress(), 'Minting Hub');
    await dEURO.initialize(savings.getAddress(), 'Savings');
    await dEURO.initialize(roller.getAddress(), 'Roller');

    // Wait for initialization
    await evm_increaseTime(60);

    // Bootstrap dEURO by minting through bridge
    await mockXEUR.mint(owner.address, floatToDec18(100_000));
    await mockXEUR.approve(bridge.getAddress(), floatToDec18(100_000));
    await bridge.mint(floatToDec18(50_000));

    // Deploy CoinLendingGateway
    const CoinLendingGatewayFactory = await ethers.getContractFactory('CoinLendingGateway');
    coinLendingGateway = await CoinLendingGatewayFactory.deploy(
      mintingHub.getAddress(),
      testWETH.getAddress(),
      dEURO.getAddress(),
    );

    // Create a parent position for cloning
    await testWETH.deposit({ value: floatToDec18(100) });
    await testWETH.approve(mintingHub.getAddress(), floatToDec18(100));
    await dEURO.approve(mintingHub.getAddress(), await mintingHub.OPENING_FEE());

    const tx = await mintingHub[
      'openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24,bytes32)'
    ](
      testWETH.getAddress(),
      minCollateral,
      floatToDec18(50),
      initialLimit,
      initPeriod,
      duration,
      challengePeriod,
      riskPremiumPPM,
      liqPrice,
      reservePPM,
      frontendCode,
    );

    parentPosition = await getPositionAddressFromTX(tx);
    parentPositionContract = await ethers.getContractAt('Position', parentPosition);

    // Wait for initialization period
    await evm_increaseTime(Number(initPeriod) + 100);
  });

  describe('Core Functionality', () => {
    it('create position with lendWithCoin', async () => {
      const ethAmount = floatToDec18(10);
      const mintAmount = floatToDec18(5000);
      const liquidationPrice = floatToDec18(1500);
      const expiration = (await parentPositionContract.expiration()) - 86400n;

      const gatewayETHBefore = await ethers.provider.getBalance(coinLendingGateway.getAddress());
      const gatewayWETHBefore = await testWETH.balanceOf(coinLendingGateway.getAddress());
      const gatewayDEUROBefore = await dEURO.balanceOf(coinLendingGateway.getAddress());
      const aliceDEUROBefore = await dEURO.balanceOf(alice.address);

      // Execute lendWithCoin
      const tx = await coinLendingGateway.connect(alice).lendWithCoin(
        parentPosition,
        mintAmount,
        Number(expiration),
        frontendCode,
        liquidationPrice,
        { value: ethAmount }
      );

      const positionAddress = await getPositionAddressFromTX(tx);
      const position = await ethers.getContractAt('Position', positionAddress);

      expect(await position.owner()).to.equal(alice.address);

      const aliceDEUROAfter = await dEURO.balanceOf(alice.address);
      const expectedAmount = (mintAmount * 900_000n) / 1_000_000n;
      expect(aliceDEUROAfter - aliceDEUROBefore).to.equal(expectedAmount);

      const gatewayETHAfter = await ethers.provider.getBalance(coinLendingGateway.getAddress());
      const gatewayWETHAfter = await testWETH.balanceOf(coinLendingGateway.getAddress());
      const gatewayDEUROAfter = await dEURO.balanceOf(coinLendingGateway.getAddress());

      expect(gatewayETHAfter).to.equal(gatewayETHBefore);
      expect(gatewayWETHAfter).to.equal(gatewayWETHBefore);
      expect(gatewayDEUROAfter).to.equal(gatewayDEUROBefore);

      expect(await position.price()).to.equal(liquidationPrice);

      const gatewayApproval = await testWETH.allowance(coinLendingGateway.getAddress(), mintingHub.getAddress());
      expect(gatewayApproval).to.equal(0);
    });

    it('create position for another owner', async () => {
      const ethAmount = floatToDec18(5);
      const mintAmount = floatToDec18(2000);
      const expiration = (await parentPositionContract.expiration()) - 86400n;

      const bobDEUROBefore = await dEURO.balanceOf(bob.address);

      const tx = await coinLendingGateway.connect(alice).lendWithCoinFor(
        bob.address,
        parentPosition,
        mintAmount,
        Number(expiration),
        frontendCode,
        0,
        { value: ethAmount }
      );

      const positionAddress = await getPositionAddressFromTX(tx);
      const position = await ethers.getContractAt('Position', positionAddress);

      expect(await position.owner()).to.equal(bob.address);

      const bobDEUROAfter = await dEURO.balanceOf(bob.address);
      const expectedAmount = (mintAmount * 900_000n) / 1_000_000n;
      expect(bobDEUROAfter - bobDEUROBefore).to.equal(expectedAmount);

      expect(await ethers.provider.getBalance(coinLendingGateway.getAddress())).to.equal(0);
      expect(await testWETH.balanceOf(coinLendingGateway.getAddress())).to.equal(0);
      expect(await dEURO.balanceOf(coinLendingGateway.getAddress())).to.equal(0);
    });

    it('handle liquidationPrice = 0', async () => {
      const ethAmount = floatToDec18(8);
      const mintAmount = floatToDec18(3000);
      const expiration = (await parentPositionContract.expiration()) - 86400n;

      const tx = await coinLendingGateway.connect(alice).lendWithCoin(
        parentPosition,
        mintAmount,
        Number(expiration),
        frontendCode,
        0,
        { value: ethAmount }
      );

      const positionAddress = await getPositionAddressFromTX(tx);
      const position = await ethers.getContractAt('Position', positionAddress);

      expect(await position.price()).to.equal(await parentPositionContract.price());
    });

    it('handle liquidationPrice equals current price', async () => {
      const ethAmount = floatToDec18(7);
      const mintAmount = floatToDec18(2500);
      const expiration = (await parentPositionContract.expiration()) - 86400n;
      const currentPrice = await parentPositionContract.price();

      const tx = await coinLendingGateway.connect(alice).lendWithCoin(
        parentPosition,
        mintAmount,
        Number(expiration),
        frontendCode,
        currentPrice,
        { value: ethAmount }
      );

      const positionAddress = await getPositionAddressFromTX(tx);
      const position = await ethers.getContractAt('Position', positionAddress);

      expect(await position.price()).to.equal(currentPrice);
    });

    it('handle liquidationPrice higher than parent (triggers cooldown)', async () => {
      const ethAmount = floatToDec18(6);
      const mintAmount = floatToDec18(2000);
      const expiration = (await parentPositionContract.expiration()) - 86400n;
      const parentPrice = await parentPositionContract.price();
      const higherPrice = floatToDec18(3000); // 1.5x parent price (2000 -> 3000)

      expect(higherPrice).to.be.gt(parentPrice);
      expect(higherPrice).to.be.lt(parentPrice * 2n);

      const tx = await coinLendingGateway.connect(alice).lendWithCoin(
        parentPosition,
        mintAmount,
        Number(expiration),
        frontendCode,
        higherPrice,
        { value: ethAmount }
      );

      const positionAddress = await getPositionAddressFromTX(tx);
      const position = await ethers.getContractAt('Position', positionAddress);

      expect(await position.price()).to.equal(higherPrice);

      // Verify cooldown is triggered (3 days from now)
      const cooldownTimestamp = await position.cooldown();
      const blockTimestamp = (await ethers.provider.getBlock('latest'))!.timestamp;
      const threeDaysInSeconds = 3n * 24n * 60n * 60n;

      expect(cooldownTimestamp).to.be.gte(blockTimestamp);
      expect(cooldownTimestamp).to.be.lte(blockTimestamp + Number(threeDaysInSeconds));
    });
  });

  describe('Edge Cases and Failures', () => {
    it('reject direct ETH transfers', async () => {
      await expect(
        owner.sendTransaction({
          to: coinLendingGateway.getAddress(),
          value: floatToDec18(1)
        })
      ).to.be.revertedWithCustomError(coinLendingGateway, 'DirectETHNotAccepted');
    });

    it('revert when msg.value is 0', async () => {
      await expect(
        coinLendingGateway.lendWithCoin(
          parentPosition,
          floatToDec18(100),
          Number(await parentPositionContract.expiration()) - 86400,
          frontendCode,
          0,
          { value: 0 }
        )
      ).to.be.revertedWithCustomError(coinLendingGateway, 'InsufficientCoin');
    });

    it('revert with zero address owner', async () => {
      await expect(
        coinLendingGateway.lendWithCoinFor(
          ethers.ZeroAddress,
          parentPosition,
          floatToDec18(100),
          Number(await parentPositionContract.expiration()) - 86400,
          frontendCode,
          0,
          { value: floatToDec18(1) }
        )
      ).to.be.revertedWithCustomError(coinLendingGateway, 'InvalidPosition');
    });

    it('revert with invalid parent', async () => {
      await expect(
        coinLendingGateway.lendWithCoin(
          ethers.ZeroAddress, // Invalid parent
          floatToDec18(100),
          Number(await parentPositionContract.expiration()) - 86400,
          frontendCode,
          0,
          { value: floatToDec18(1) }
        )
      ).to.be.reverted; // Will revert in MintingHub
    });

    it('revert when price adjustment fails', async () => {
      const ethAmount = floatToDec18(0.001);
      const mintAmount = floatToDec18(1000);
      const expiration = (await parentPositionContract.expiration()) - 86400n;
      const liquidationPrice = floatToDec18(100);

      await expect(
        coinLendingGateway.connect(alice).lendWithCoin(
          parentPosition,
          mintAmount,
          Number(expiration),
          frontendCode,
          liquidationPrice,
          { value: ethAmount }
        )
      ).to.be.reverted;
    });

    it('revert when liquidationPrice > 2x current price', async () => {
      const ethAmount = floatToDec18(5);
      const mintAmount = floatToDec18(1000);
      const expiration = (await parentPositionContract.expiration()) - 86400n;
      const currentPrice = await parentPositionContract.price();
      const tooHighPrice = currentPrice * 2n + 1n;

      await expect(
        coinLendingGateway.connect(alice).lendWithCoin(
          parentPosition,
          mintAmount,
          Number(expiration),
          frontendCode,
          tooHighPrice,
          { value: ethAmount }
        )
      ).to.be.revertedWithCustomError(coinLendingGateway, 'PriceAdjustmentFailed');
    });
  });

  describe('Admin Functions', () => {
    it('pause and unpause', async () => {
      await coinLendingGateway.connect(owner).pause();

      await expect(
        coinLendingGateway.connect(alice).lendWithCoin(
          parentPosition,
          floatToDec18(100),
          Number(await parentPositionContract.expiration()) - 86400,
          frontendCode,
          0,
          { value: floatToDec18(1) }
        )
      ).to.be.revertedWithCustomError(coinLendingGateway, 'EnforcedPause');

      await expect(
        coinLendingGateway.connect(alice).lendWithCoinFor(
          bob.address,
          parentPosition,
          floatToDec18(100),
          Number(await parentPositionContract.expiration()) - 86400,
          frontendCode,
          0,
          { value: floatToDec18(1) }
        )
      ).to.be.revertedWithCustomError(coinLendingGateway, 'EnforcedPause');

      await coinLendingGateway.connect(owner).unpause();

      const tx = await coinLendingGateway.connect(alice).lendWithCoin(
        parentPosition,
        floatToDec18(100),
        Number(await parentPositionContract.expiration()) - 86400,
        frontendCode,
        0,
        { value: floatToDec18(3) }
      );
      expect(tx).to.not.be.reverted;
    });

    it('rescue ETH and verify direct transfers rejected', async () => {
      // Verify direct ETH transfers are rejected
      await expect(
        owner.sendTransaction({
          to: coinLendingGateway.getAddress(),
          value: floatToDec18(1)
        })
      ).to.be.revertedWithCustomError(coinLendingGateway, 'DirectETHNotAccepted');

      // Test rescueCoin works (even with 0 balance)
      // Note: In production, ETH could be stuck via selfdestruct from another contract
      await expect(
        coinLendingGateway.connect(owner).rescueCoin()
      ).to.not.be.reverted;

      // Verify gateway has no ETH
      expect(await ethers.provider.getBalance(coinLendingGateway.getAddress())).to.equal(0);
    });

    it('rescue tokens', async () => {
      const TestTokenFactory = await ethers.getContractFactory('TestToken');
      const testToken = await TestTokenFactory.deploy('Test', 'TST', 18);
      await testToken.mint(coinLendingGateway.getAddress(), floatToDec18(100));

      const bobBalBefore = await testToken.balanceOf(bob.address);

      await expect(
        coinLendingGateway.connect(owner).rescueToken(
          testToken.getAddress(),
          bob.address,
          floatToDec18(100)
        )
      ).to.emit(coinLendingGateway, 'TokenRescued')
        .withArgs(testToken.getAddress(), bob.address, floatToDec18(100));

      const bobBalAfter = await testToken.balanceOf(bob.address);
      expect(bobBalAfter - bobBalBefore).to.equal(floatToDec18(100));
    });

    it('revert rescue token with zero address', async () => {
      const TestTokenFactory = await ethers.getContractFactory('TestToken');
      const testToken = await TestTokenFactory.deploy('Test', 'TST', 18);

      await expect(
        coinLendingGateway.connect(owner).rescueToken(
          testToken.getAddress(),
          ethers.ZeroAddress,
          floatToDec18(100)
        )
      ).to.be.revertedWithCustomError(coinLendingGateway, 'TransferFailed');
    });

    it('enforce onlyOwner', async () => {
      await expect(
        coinLendingGateway.connect(alice).pause()
      ).to.be.revertedWithCustomError(coinLendingGateway, 'OwnableUnauthorizedAccount');

      await expect(
        coinLendingGateway.connect(alice).unpause()
      ).to.be.revertedWithCustomError(coinLendingGateway, 'OwnableUnauthorizedAccount');

      await expect(
        coinLendingGateway.connect(alice).rescueCoin()
      ).to.be.revertedWithCustomError(coinLendingGateway, 'OwnableUnauthorizedAccount');

      await expect(
        coinLendingGateway.connect(alice).rescueToken(testWETH.getAddress(), alice.address, 0)
      ).to.be.revertedWithCustomError(coinLendingGateway, 'OwnableUnauthorizedAccount');
    });
  });

  describe('Security and Atomicity', () => {
    it('atomic transactions', async () => {
      const ethAmount = floatToDec18(0.01);
      const mintAmount = floatToDec18(10000);

      await expect(
        coinLendingGateway.connect(alice).lendWithCoin(
          parentPosition,
          mintAmount,
          Number(await parentPositionContract.expiration()) - 86400,
          frontendCode,
          0,
          { value: ethAmount }
        )
      ).to.be.reverted;

      expect(await ethers.provider.getBalance(coinLendingGateway.getAddress())).to.equal(0);
      expect(await testWETH.balanceOf(coinLendingGateway.getAddress())).to.equal(0);
      expect(await dEURO.balanceOf(coinLendingGateway.getAddress())).to.equal(0);
    });

    it('multiple sequential transactions leave no funds', async () => {
      for (let i = 0; i < 3; i++) {
        const ethAmount = floatToDec18(5 + i);
        const mintAmount = floatToDec18(1000 * (i + 1));

        await coinLendingGateway.connect(alice).lendWithCoin(
          parentPosition,
          mintAmount,
          Number(await parentPositionContract.expiration()) - (86400 * (i + 1)),
          frontendCode,
          0,
          { value: ethAmount }
        );

        expect(await ethers.provider.getBalance(coinLendingGateway.getAddress())).to.equal(0);
        expect(await testWETH.balanceOf(coinLendingGateway.getAddress())).to.equal(0);
        expect(await dEURO.balanceOf(coinLendingGateway.getAddress())).to.equal(0);
        expect(await testWETH.allowance(coinLendingGateway.getAddress(), mintingHub.getAddress())).to.equal(0);
      }
    });

    it('handle donated dEURO', async () => {
      await dEURO.transfer(coinLendingGateway.getAddress(), floatToDec18(1000));

      const bobDEUROBefore = await dEURO.balanceOf(bob.address);

      await coinLendingGateway.connect(alice).lendWithCoinFor(
        bob.address,
        parentPosition,
        floatToDec18(500),
        Number(await parentPositionContract.expiration()) - 86400,
        frontendCode,
        0,
        { value: floatToDec18(3) }
      );

      const bobDEUROAfter = await dEURO.balanceOf(bob.address);
      const expectedMinted = (floatToDec18(500) * 900_000n) / 1_000_000n;
      expect(bobDEUROAfter - bobDEUROBefore).to.equal(expectedMinted + floatToDec18(1000));

      expect(await dEURO.balanceOf(coinLendingGateway.getAddress())).to.equal(0);
    });
  });

  describe('Event Emissions', () => {
    it('emit PositionCreatedWithCoin', async () => {
      const ethAmount = floatToDec18(3);
      const mintAmount = floatToDec18(1000);
      const liquidationPrice = floatToDec18(1800);

      await expect(
        coinLendingGateway.connect(alice).lendWithCoin(
          parentPosition,
          mintAmount,
          Number(await parentPositionContract.expiration()) - 86400,
          frontendCode,
          liquidationPrice,
          { value: ethAmount }
        )
      ).to.emit(coinLendingGateway, 'PositionCreatedWithCoin');
    });
  });
});