// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {IMintingHubGateway} from "./interface/IMintingHubGateway.sol";
import {ICoinLendingGateway} from "./interface/ICoinLendingGateway.sol";
import {IPosition} from "../MintingHubV2/interface/IPosition.sol";
import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
}

/**
 * @title Coin Lending Gateway
 * @notice An improved gateway that enables true single-transaction native coin lending with custom liquidation prices
 * @dev This version handles the ownership transfer timing issue to allow price adjustments in the same transaction
 */
contract CoinLendingGateway is ICoinLendingGateway, Context, Ownable, ReentrancyGuard, Pausable {
    IMintingHubGateway public immutable MINTING_HUB;
    IWETH public immutable WETH;
    IDecentralizedEURO public immutable DEURO;

    error InsufficientCoin();
    error InvalidPosition();
    error TransferFailed();
    error PriceAdjustmentFailed();

    // Events are already defined in the interface
    event CoinRescued(address indexed to, uint256 amount);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    /**
     * @notice Initializes the Coin Lending Gateway
     * @param _mintingHub The address of the MintingHubGateway contract
     * @param _weth The address of the wrapped native token contract (WETH, WMATIC, etc.)
     * @param _deuro The address of the DecentralizedEURO contract
     */
    constructor(address _mintingHub, address _weth, address _deuro) Ownable(_msgSender()) {
        MINTING_HUB = IMintingHubGateway(_mintingHub);
        WETH = IWETH(_weth);
        DEURO = IDecentralizedEURO(_deuro);
    }

    /**
     * @notice Creates a lending position using native coins in a single transaction
     * @dev This improved version uses a two-step clone process to handle ownership and price adjustment correctly
     * @param parent The parent position to clone from
     * @param initialMint The amount of dEURO to mint
     * @param expiration The expiration timestamp for the position
     * @param frontendCode The frontend referral code
     * @param liquidationPrice The desired liquidation price (0 to skip adjustment)
     * @return position The address of the newly created position
     */
    function lendWithCoin(
        address parent,
        uint256 initialMint,
        uint40 expiration,
        bytes32 frontendCode,
        uint256 liquidationPrice
    ) external payable nonReentrant whenNotPaused returns (address position) {
        if (msg.value == 0) revert InsufficientCoin();

        address finalOwner = _msgSender();

        // Wrap native coin to wrapped token
        WETH.deposit{value: msg.value}();

        // Approve wrapped token for MintingHub
        WETH.approve(address(MINTING_HUB), msg.value);

        // Clone position with THIS contract as initial owner
        // This allows us to call adjustPrice before transferring ownership
        position = MINTING_HUB.clone(
            address(this),   // temporary owner (this contract)
            parent,          // parent position
            msg.value,       // collateral amount
            initialMint,     // mint amount
            expiration,
            frontendCode
        );

        if (position == address(0)) revert InvalidPosition();

        // Now we own the position and can adjust the price if needed
        if (liquidationPrice > 0) {
            uint256 currentPrice = IPosition(position).price();

            if (liquidationPrice != currentPrice) {
                // Add small buffer (0.01%) to account for potential interest accrual
                uint256 adjustedPrice = (liquidationPrice * 10001) / 10000;

                try IPosition(position).adjustPrice(adjustedPrice) {
                    // Price adjustment successful
                } catch {
                    revert PriceAdjustmentFailed();
                }
            }
        }

        // Transfer any minted dEURO to the final owner
        // The minted dEURO is sent to this contract initially
        uint256 deuroBalance = DEURO.balanceOf(address(this));
        if (deuroBalance > 0) {
            DEURO.transfer(finalOwner, deuroBalance);
        }

        // Finally, transfer ownership of the position to the user
        Ownable(position).transferOwnership(finalOwner);

        emit PositionCreatedWithCoin(
            finalOwner,
            position,
            msg.value,
            initialMint,
            liquidationPrice
        );

        return position;
    }

    /**
     * @notice Creates a lending position for another owner using native coins
     * @dev Same as lendWithCoin but allows specifying a different owner
     * @param owner The address that will own the position
     * @param parent The parent position to clone from
     * @param initialMint The amount of dEURO to mint
     * @param expiration The expiration timestamp for the position
     * @param frontendCode The frontend referral code
     * @param liquidationPrice The desired liquidation price (0 to skip adjustment)
     * @return position The address of the newly created position
     */
    function lendWithCoinFor(
        address owner,
        address parent,
        uint256 initialMint,
        uint40 expiration,
        bytes32 frontendCode,
        uint256 liquidationPrice
    ) external payable nonReentrant whenNotPaused returns (address position) {
        if (msg.value == 0) revert InsufficientCoin();
        if (owner == address(0)) revert InvalidPosition();

        // Wrap native coin to wrapped token
        WETH.deposit{value: msg.value}();

        // Approve wrapped token for MintingHub
        WETH.approve(address(MINTING_HUB), msg.value);

        // Clone position with THIS contract as initial owner
        position = MINTING_HUB.clone(
            address(this),   // temporary owner (this contract)
            parent,          // parent position
            msg.value,       // collateral amount
            initialMint,     // mint amount
            expiration,
            frontendCode
        );

        if (position == address(0)) revert InvalidPosition();

        // Adjust liquidation price if specified
        if (liquidationPrice > 0) {
            uint256 currentPrice = IPosition(position).price();

            if (liquidationPrice != currentPrice) {
                uint256 adjustedPrice = (liquidationPrice * 10001) / 10000;

                try IPosition(position).adjustPrice(adjustedPrice) {
                    // Price adjustment successful
                } catch {
                    revert PriceAdjustmentFailed();
                }
            }
        }

        // Transfer any minted dEURO to the specified owner
        uint256 deuroBalance = DEURO.balanceOf(address(this));
        if (deuroBalance > 0) {
            DEURO.transfer(owner, deuroBalance);
        }

        // Transfer ownership of the position to the specified owner
        Ownable(position).transferOwnership(owner);

        emit PositionCreatedWithCoin(
            owner,
            position,
            msg.value,
            initialMint,
            liquidationPrice
        );

        return position;
    }

    /**
     * @notice Rescue function to withdraw accidentally sent native coins
     * @dev Only owner can call this function
     */
    function rescueCoin() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success, ) = owner().call{value: balance}("");
            if (!success) revert TransferFailed();
            emit CoinRescued(owner(), balance);
        }
    }

    /**
     * @notice Rescue function to withdraw accidentally sent tokens
     * @dev Only owner can call this function
     * @param token The address of the token to rescue
     * @param to The address to send the tokens to
     * @param amount The amount of tokens to rescue
     */
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert TransferFailed();
        bool success = IERC20(token).transfer(to, amount);
        if (!success) revert TransferFailed();
        emit TokenRescued(token, to, amount);
    }

    /**
     * @notice Pause the contract (only owner)
     * @dev Prevents lendWithCoin functions from being called
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract (only owner)
     * @dev Re-enables lendWithCoin functions
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Receive function to accept native coins
     */
    receive() external payable {}
}