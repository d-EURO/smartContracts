// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {IMintingHubGateway} from "./interface/IMintingHubGateway.sol";
import {ICoinLendingGateway} from "./interface/ICoinLendingGateway.sol";
import {IPosition} from "../MintingHubV2/interface/IPosition.sol";
import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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
contract CoinLendingGateway is ICoinLendingGateway, Ownable, ReentrancyGuard, Pausable {
    IMintingHubGateway public immutable MINTING_HUB;
    IWETH public immutable WETH;
    IDecentralizedEURO public immutable DEURO;

    error InsufficientCoin();
    error InvalidPosition();
    error TransferFailed();
    error PriceAdjustmentFailed();
    error DirectETHNotAccepted();

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

        return _lendWithCoin(
            _msgSender(),
            parent,
            initialMint,
            expiration,
            frontendCode,
            liquidationPrice
        );
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

        return _lendWithCoin(
            owner,
            parent,
            initialMint,
            expiration,
            frontendCode,
            liquidationPrice
        );
    }

    /**
     * @dev Internal function containing the core lending logic
     * @param owner The address that will own the position
     * @param parent The parent position to clone from
     * @param initialMint The amount of dEURO to mint
     * @param expiration The expiration timestamp for the position
     * @param frontendCode The frontend referral code
     * @param liquidationPrice The desired liquidation price (0 to skip adjustment)
     * @return position The address of the newly created position
     */
    function _lendWithCoin(
        address owner,
        address parent,
        uint256 initialMint,
        uint40 expiration,
        bytes32 frontendCode,
        uint256 liquidationPrice
    ) internal returns (address position) {
        WETH.deposit{value: msg.value}();

        WETH.approve(address(MINTING_HUB), msg.value);

        // This contract must be initial owner to call adjustPrice before transferring ownership
        position = MINTING_HUB.clone(
            address(this),   // temporary owner (this contract)
            parent,          // parent position
            msg.value,       // collateral amount
            initialMint,     // mint amount
            expiration,
            frontendCode
        );

        if (position == address(0)) revert InvalidPosition();

        if (liquidationPrice > 0) {
            uint256 currentPrice = IPosition(position).price();

            if (liquidationPrice != currentPrice) {
                try IPosition(position).adjustPrice(liquidationPrice) {
                    // Price adjustment succeeded
                } catch {
                    revert PriceAdjustmentFailed();
                }
            }
        }

        uint256 deuroBalance = DEURO.balanceOf(address(this));
        if (deuroBalance > 0) {
            DEURO.transfer(owner, deuroBalance);
        }

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
     * @dev Reject direct ETH transfers to prevent stuck funds
     */
    receive() external payable {
        revert DirectETHNotAccepted();
    }
}