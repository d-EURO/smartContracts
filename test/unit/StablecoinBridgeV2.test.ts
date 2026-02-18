import {
  DecentralizedEURO,
  StablecoinBridge,
  StablecoinBridgeV2,
  TestToken
} from "../../typechain";
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { floatToDec18 } from '../../scripts/utils/math';
import { expect } from 'chai';

let i = 0;
while (i < 10) {
  describe('StablecoinV2 Tests', () => {
    let dEURO: DecentralizedEURO;
    let XEUR: TestToken;
    let owner: HardhatEthersSigner;
    let alice: HardhatEthersSigner;
    let bridge: StablecoinBridgeV2;

    before(async () => {
      [owner, alice] = await ethers.getSigners();

      const XEURFactory = await ethers.getContractFactory('TestToken');
      XEUR = await XEURFactory.deploy('CryptoEuro', 'XEUR', 18);

      const decentralizedEUROFactory = await ethers.getContractFactory('DecentralizedEURO');
      dEURO = await decentralizedEUROFactory.deploy(10 * 86400);

      let supply = floatToDec18(1000_000);
      const bridgeFactory = await ethers.getContractFactory('StablecoinBridgeV2');
      bridge = await bridgeFactory.deploy(
        XEUR.getAddress(),
        dEURO.getAddress(),
        floatToDec18(100_000_000_000),
        30,
        10_000,
        10_000,
      );
      await dEURO.initialize(bridge.getAddress(), '');

      await XEUR.mint(owner.address, supply);
      await XEUR.approve(await bridge.getAddress(), supply);
      await dEURO.approve(await bridge.getAddress(), supply);
    });

    it('Should mint with the fee', async () => {
      await bridge.mint(floatToDec18(100));
      const balance = await dEURO.balanceOf(owner.address);

      expect(balance).to.equal(floatToDec18(99));
    });

    it('Should burn with the fee', async () => {
      await bridge.burnAndSend(alice.address, floatToDec18(10));
      const xEuroBalance = await XEUR.balanceOf(alice.address);
      expect(xEuroBalance).to.equal(9_900_000_000_000_000_000n);
    });
  });

  describe('StablecoinV1 Tests', () => {
    let dEURO: DecentralizedEURO;
    let XEUR: TestToken;
    let owner: HardhatEthersSigner;
    let alice: HardhatEthersSigner;
    let bridge: StablecoinBridge;

    before(async () => {
      [owner, alice] = await ethers.getSigners();

      const XEURFactory = await ethers.getContractFactory('TestToken');
      XEUR = await XEURFactory.deploy('CryptoEuro', 'XEUR', 18);

      const decentralizedEUROFactory = await ethers.getContractFactory('DecentralizedEURO');
      dEURO = await decentralizedEUROFactory.deploy(10 * 86400);

      let supply = floatToDec18(1000_000);
      const bridgeFactory = await ethers.getContractFactory('StablecoinBridge');
      bridge = await bridgeFactory.deploy(
        XEUR.getAddress(),
        dEURO.getAddress(),
        floatToDec18(100_000_000_000),
        30,
      );
      await dEURO.initialize(bridge.getAddress(), '');

      await XEUR.mint(owner.address, supply);
      await XEUR.approve(await bridge.getAddress(), supply);
      await dEURO.approve(await bridge.getAddress(), supply);
    });

    it('Should mint with the fee', async () => {
      await bridge.mint(floatToDec18(100));
      const balance = await dEURO.balanceOf(owner.address);

      expect(balance).to.equal(floatToDec18(100));
    });

    it('Should burn with the fee', async () => {
      await bridge.burnAndSend(alice.address, floatToDec18(10));
      const xEuroBalance = await XEUR.balanceOf(alice.address);
      expect(xEuroBalance).to.equal(floatToDec18(10));
    });
  });
  i++;
}
