import { expect } from "chai";
import { ethers } from "hardhat";
import { BridgedToken, DecentralizedEURO } from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { floatToDec18 } from "../../scripts/utils/math";

describe("BridgedToken", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let bridge: HardhatEthersSigner; // Mock bridge account
  let notBridge: HardhatEthersSigner; // Account that is not the bridge

  let bridgedToken: BridgedToken;
  let dEURO: DecentralizedEURO; // Remote token

  const TOKEN_NAME = "Bridged Decentralized EURO";
  const TOKEN_SYMBOL = "dEURO.op";

  before(async () => {
    [owner, alice, bob, bridge, notBridge] = await ethers.getSigners();
    
    // Deploy DecentralizedEURO as the remote token
    const decentralizedEUROFactory = await ethers.getContractFactory("DecentralizedEURO");
    dEURO = await decentralizedEUROFactory.deploy(10 * 86400);
    
    // Deploy BridgedToken
    const bridgedTokenFactory = await ethers.getContractFactory("BridgedToken");
    bridgedToken = await bridgedTokenFactory.deploy(
      await bridge.getAddress(), // Bridge address
      await dEURO.getAddress(),  // Remote token address
      TOKEN_NAME,
      TOKEN_SYMBOL
    );
  });

  describe("Deployment", () => {
    it("should set the correct name and symbol", async () => {
      expect(await bridgedToken.name()).to.equal(TOKEN_NAME);
      expect(await bridgedToken.symbol()).to.equal(TOKEN_SYMBOL);
    });

    it("should set the correct remote token", async () => {
      expect(await bridgedToken.REMOTE_TOKEN()).to.equal(await dEURO.getAddress());
      expect(await bridgedToken.remoteToken()).to.equal(await dEURO.getAddress());
      expect(await bridgedToken.l1Token()).to.equal(await dEURO.getAddress());
    });

    it("should set the correct bridge", async () => {
      expect(await bridgedToken.BRIDGE()).to.equal(await bridge.getAddress());
      expect(await bridgedToken.bridge()).to.equal(await bridge.getAddress());
      expect(await bridgedToken.l2Bridge()).to.equal(await bridge.getAddress());
    });
  });

  describe("Interface Support", () => {
    it("should support all required interfaces", async () => {
      const IERC20_INTERFACE_ID = "0x36372b07";
      const ERC20PERMIT_INTERFACE_ID = "0x9d8ff7da";
      const ERC3009_INTERFACE_ID = "0xb9012196";
      const ILEGACY_MINTABLE_ERC20_INTERFACE_ID = "0x1d1d8b63";
      const IOPTIMISM_MINTABLE_ERC20_INTERFACE_ID = "0xec4fc8e3";
      const IERC165_INTERFACE_ID = "0x01ffc9a7";

      expect(await bridgedToken.supportsInterface(IERC20_INTERFACE_ID)).to.be.true;
      expect(await bridgedToken.supportsInterface(ERC20PERMIT_INTERFACE_ID)).to.be.true;
      expect(await bridgedToken.supportsInterface(ERC3009_INTERFACE_ID)).to.be.true;
      expect(await bridgedToken.supportsInterface(ILEGACY_MINTABLE_ERC20_INTERFACE_ID)).to.be.true;
      expect(await bridgedToken.supportsInterface(IOPTIMISM_MINTABLE_ERC20_INTERFACE_ID)).to.be.true;
      expect(await bridgedToken.supportsInterface(IERC165_INTERFACE_ID)).to.be.true;
    });
  });

  describe("Minting", () => {
    const mintAmount = floatToDec18(1000);

    it("should revert when non-bridge tries to mint", async () => {
      await expect(
        bridgedToken.connect(notBridge).mint(alice.address, mintAmount)
      ).to.be.revertedWithCustomError(bridgedToken, "OnlyBridge")
    });

    it("should mint tokens when called by bridge", async () => {
      const balanceBefore = await bridgedToken.balanceOf(alice.address);
      
      await expect(
        bridgedToken.connect(bridge).mint(alice.address, mintAmount)
      )
        .to.emit(bridgedToken, "Mint")
        .withArgs(alice.address, mintAmount);
      
      const balanceAfter = await bridgedToken.balanceOf(alice.address);
      expect(balanceAfter - balanceBefore).to.equal(mintAmount);
    });
  });

  describe("Burning", () => {
    const burnAmount = floatToDec18(400);

    before(async () => {
      // Ensure alice has enough tokens
      await bridgedToken.connect(bridge).mint(alice.address, floatToDec18(1000));
    });

    it("should revert when non-bridge tries to burn", async () => {
      await expect(
        bridgedToken.connect(notBridge).burn(alice.address, burnAmount)
      ).to.be.revertedWithCustomError(bridgedToken, "OnlyBridge");
    });

    it("should burn tokens when called by bridge", async () => {
      const balanceBefore = await bridgedToken.balanceOf(alice.address);
      
      await expect(
        bridgedToken.connect(bridge).burn(alice.address, burnAmount)
      )
        .to.emit(bridgedToken, "Burn")
        .withArgs(alice.address, burnAmount);
      
      const balanceAfter = await bridgedToken.balanceOf(alice.address);
      expect(balanceBefore - balanceAfter).to.equal(burnAmount);
    });
  });

  describe("Cross-Chain Scenario", () => {
    it("should simulate a complete cross-chain token transfer", async () => {
      // Initial mint to Bob (simulating L1->L2 bridge deposit)
      const initialAmount = floatToDec18(500);
      await bridgedToken.connect(bridge).mint(bob.address, initialAmount);
      expect(await bridgedToken.balanceOf(bob.address)).to.equal(initialAmount);
      
      // Bob burns tokens to bridge back to L1 (simulating L2->L1 withdrawal)
      const burnAmount = floatToDec18(200);
      await bridgedToken.connect(bridge).burn(bob.address, burnAmount);
      
      // Verify final balance
      expect(await bridgedToken.balanceOf(bob.address)).to.equal(initialAmount - burnAmount);
    });
  });

  describe("ERC20 Functionality", () => {
    const transferAmount = floatToDec18(50);

    before(async () => {
      // Ensure alice has enough tokens
      await bridgedToken.connect(bridge).mint(alice.address, floatToDec18(100));
    });

    it("should allow token transfers between users", async () => {
      const aliceBalanceBefore = await bridgedToken.balanceOf(alice.address);
      const bobBalanceBefore = await bridgedToken.balanceOf(bob.address);
      
      await bridgedToken.connect(alice).transfer(bob.address, transferAmount);
      
      const aliceBalanceAfter = await bridgedToken.balanceOf(alice.address);
      const bobBalanceAfter = await bridgedToken.balanceOf(bob.address);
      
      expect(aliceBalanceBefore - aliceBalanceAfter).to.equal(transferAmount);
      expect(bobBalanceAfter - bobBalanceBefore).to.equal(transferAmount);
    });

    it("should allow token approvals and transferFrom", async () => {
      const amount = floatToDec18(25);
      
      // Alice approves Bob to spend tokens
      await bridgedToken.connect(alice).approve(bob.address, amount);
      expect(await bridgedToken.allowance(alice.address, bob.address)).to.equal(amount);
      
      const aliceBalanceBefore = await bridgedToken.balanceOf(alice.address);
      const ownerBalanceBefore = await bridgedToken.balanceOf(owner.address);
      
      // Bob transfers Alice's tokens to owner
      await bridgedToken.connect(bob).transferFrom(alice.address, owner.address, amount);
      
      const aliceBalanceAfter = await bridgedToken.balanceOf(alice.address);
      const ownerBalanceAfter = await bridgedToken.balanceOf(owner.address);
      
      expect(aliceBalanceBefore - aliceBalanceAfter).to.equal(amount);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(amount);
      expect(await bridgedToken.allowance(alice.address, bob.address)).to.equal(0);
    });
  });
});