import { expect } from "chai";
import { ethers } from "hardhat";
import { BridgedDecentralizedEURO, DecentralizedEURO } from "../../typechain";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { floatToDec18 } from "../../scripts/utils/math";

describe("BridgedDecentralizedEURO", () => {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let bridge: HardhatEthersSigner; // Mock bridge account
  let notBridge: HardhatEthersSigner; // Account that is not the bridge

  let bridgedDEURO: BridgedDecentralizedEURO;
  let dEURO: DecentralizedEURO; // Remote token

  const TOKEN_NAME = "Bridged Decentralized EURO";
  const TOKEN_SYMBOL = "dEURO.op";

  before(async () => {
    [owner, alice, bob, bridge, notBridge] = await ethers.getSigners();
    
    // Deploy DecentralizedEURO as the remote token
    const decentralizedEUROFactory = await ethers.getContractFactory("DecentralizedEURO");
    dEURO = await decentralizedEUROFactory.deploy(10 * 86400);
    
    // Deploy BridgedDecentralizedEURO
    const bridgedDecentralizedEUROFactory = await ethers.getContractFactory("BridgedDecentralizedEURO");
    bridgedDEURO = await bridgedDecentralizedEUROFactory.deploy(
      await bridge.getAddress(), // Bridge address
      await dEURO.getAddress(),  // Remote token address
      TOKEN_NAME,
      TOKEN_SYMBOL
    );
  });

  describe("Deployment", () => {
    it("should set the correct name and symbol", async () => {
      expect(await bridgedDEURO.name()).to.equal(TOKEN_NAME);
      expect(await bridgedDEURO.symbol()).to.equal(TOKEN_SYMBOL);
    });

    it("should set the correct remote token", async () => {
      expect(await bridgedDEURO.REMOTE_TOKEN()).to.equal(await dEURO.getAddress());
      expect(await bridgedDEURO.remoteToken()).to.equal(await dEURO.getAddress());
      expect(await bridgedDEURO.l1Token()).to.equal(await dEURO.getAddress());
    });

    it("should set the correct bridge", async () => {
      expect(await bridgedDEURO.BRIDGE()).to.equal(await bridge.getAddress());
      expect(await bridgedDEURO.bridge()).to.equal(await bridge.getAddress());
      expect(await bridgedDEURO.l2Bridge()).to.equal(await bridge.getAddress());
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

      expect(await bridgedDEURO.supportsInterface(IERC20_INTERFACE_ID)).to.be.true;
      expect(await bridgedDEURO.supportsInterface(ERC20PERMIT_INTERFACE_ID)).to.be.true;
      expect(await bridgedDEURO.supportsInterface(ERC3009_INTERFACE_ID)).to.be.true;
      expect(await bridgedDEURO.supportsInterface(ILEGACY_MINTABLE_ERC20_INTERFACE_ID)).to.be.true;
      expect(await bridgedDEURO.supportsInterface(IOPTIMISM_MINTABLE_ERC20_INTERFACE_ID)).to.be.true;
      expect(await bridgedDEURO.supportsInterface(IERC165_INTERFACE_ID)).to.be.true;
    });
  });

  describe("Minting", () => {
    const mintAmount = floatToDec18(1000);

    it("should revert when non-bridge tries to mint", async () => {
      await expect(
        bridgedDEURO.connect(notBridge).mint(alice.address, mintAmount)
      ).to.be.revertedWith("DecentralizedEURO: only bridge can mint and burn");
    });

    it("should mint tokens when called by bridge", async () => {
      const balanceBefore = await bridgedDEURO.balanceOf(alice.address);
      
      await expect(
        bridgedDEURO.connect(bridge).mint(alice.address, mintAmount)
      )
        .to.emit(bridgedDEURO, "Mint")
        .withArgs(alice.address, mintAmount);
      
      const balanceAfter = await bridgedDEURO.balanceOf(alice.address);
      expect(balanceAfter - balanceBefore).to.equal(mintAmount);
    });
  });

  describe("Burning", () => {
    const burnAmount = floatToDec18(400);

    before(async () => {
      // Ensure alice has enough tokens
      await bridgedDEURO.connect(bridge).mint(alice.address, floatToDec18(1000));
    });

    it("should revert when non-bridge tries to burn", async () => {
      await expect(
        bridgedDEURO.connect(notBridge).burn(alice.address, burnAmount)
      ).to.be.revertedWith("DecentralizedEURO: only bridge can mint and burn");
    });

    it("should burn tokens when called by bridge", async () => {
      const balanceBefore = await bridgedDEURO.balanceOf(alice.address);
      
      await expect(
        bridgedDEURO.connect(bridge).burn(alice.address, burnAmount)
      )
        .to.emit(bridgedDEURO, "Burn")
        .withArgs(alice.address, burnAmount);
      
      const balanceAfter = await bridgedDEURO.balanceOf(alice.address);
      expect(balanceBefore - balanceAfter).to.equal(burnAmount);
    });
  });

  describe("Cross-Chain Scenario", () => {
    it("should simulate a complete cross-chain token transfer", async () => {
      // Initial mint to Bob (simulating L1->L2 bridge deposit)
      const initialAmount = floatToDec18(500);
      await bridgedDEURO.connect(bridge).mint(bob.address, initialAmount);
      expect(await bridgedDEURO.balanceOf(bob.address)).to.equal(initialAmount);
      
      // Bob burns tokens to bridge back to L1 (simulating L2->L1 withdrawal)
      const burnAmount = floatToDec18(200);
      await bridgedDEURO.connect(bridge).burn(bob.address, burnAmount);
      
      // Verify final balance
      expect(await bridgedDEURO.balanceOf(bob.address)).to.equal(initialAmount - burnAmount);
    });
  });

  describe("ERC20 Functionality", () => {
    const transferAmount = floatToDec18(50);

    before(async () => {
      // Ensure alice has enough tokens
      await bridgedDEURO.connect(bridge).mint(alice.address, floatToDec18(100));
    });

    it("should allow token transfers between users", async () => {
      const aliceBalanceBefore = await bridgedDEURO.balanceOf(alice.address);
      const bobBalanceBefore = await bridgedDEURO.balanceOf(bob.address);
      
      await bridgedDEURO.connect(alice).transfer(bob.address, transferAmount);
      
      const aliceBalanceAfter = await bridgedDEURO.balanceOf(alice.address);
      const bobBalanceAfter = await bridgedDEURO.balanceOf(bob.address);
      
      expect(aliceBalanceBefore - aliceBalanceAfter).to.equal(transferAmount);
      expect(bobBalanceAfter - bobBalanceBefore).to.equal(transferAmount);
    });

    it("should allow token approvals and transferFrom", async () => {
      const amount = floatToDec18(25);
      
      // Alice approves Bob to spend tokens
      await bridgedDEURO.connect(alice).approve(bob.address, amount);
      expect(await bridgedDEURO.allowance(alice.address, bob.address)).to.equal(amount);
      
      const aliceBalanceBefore = await bridgedDEURO.balanceOf(alice.address);
      const ownerBalanceBefore = await bridgedDEURO.balanceOf(owner.address);
      
      // Bob transfers Alice's tokens to owner
      await bridgedDEURO.connect(bob).transferFrom(alice.address, owner.address, amount);
      
      const aliceBalanceAfter = await bridgedDEURO.balanceOf(alice.address);
      const ownerBalanceAfter = await bridgedDEURO.balanceOf(owner.address);
      
      expect(aliceBalanceBefore - aliceBalanceAfter).to.equal(amount);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(amount);
      expect(await bridgedDEURO.allowance(alice.address, bob.address)).to.equal(0);
    });
  });
});