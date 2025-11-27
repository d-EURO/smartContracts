// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {IMintingHubGateway} from "./interface/IMintingHubGateway.sol";
import {ICoinLendingGateway} from "./interface/ICoinLendingGateway.sol";
import {IPosition} from "../MintingHubV2/interface/IPosition.sol";
import {IJuiceDollar} from "../interface/IJuiceDollar.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface IWrappedCBTC is IERC20 {
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
    IWrappedCBTC public immutable WCBTC;
    IJuiceDollar public immutable JUSD;

    error InsufficientCoin();
    error InvalidPosition();
    error TransferFailed();
    error PriceAdjustmentFailed();
    error DirectCBTCNotAccepted();
    error InsufficientWcBTC();

    event CoinRescued(address indexed to, uint256 amount);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    /**
     * @notice Initializes the Coin Lending Gateway
     * @param _mintingHub The address of the MintingHubGateway contract
     * @param _wcbtc The address of the Wrapped cBTC (WcBTC) token contract
     * @param _jusd The address of the JuiceDollar contract
     */
    constructor(address _mintingHub, address _wcbtc, address _jusd) Ownable(_msgSender()) {
        MINTING_HUB = IMintingHubGateway(_mintingHub);
        WCBTC = IWrappedCBTC(_wcbtc);
        JUSD = IJuiceDollar(_jusd);
    }

    /**
     * @notice Creates a lending position using native cBTC in a single transaction
     * @dev This improved version uses a two-step clone process to handle ownership and price adjustment correctly
     * @param parent The parent position to clone from
     * @param initialMint The amount of JUSD to mint
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
     * @notice Creates a lending position for another owner using native cBTC
     * @dev Same as lendWithCoin but allows specifying a different owner
     * @param owner The address that will own the position
     * @param parent The parent position to clone from
     * @param initialMint The amount of JUSD to mint
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
     * @param initialMint The amount of JUSD to mint
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
        WCBTC.deposit{value: msg.value}();

        WCBTC.approve(address(MINTING_HUB), msg.value);

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

        uint256 jusdBalance = JUSD.balanceOf(address(this));
        if (jusdBalance > 0) {
            JUSD.transfer(owner, jusdBalance);
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
     * @notice Adds collateral to an existing position using native cBTC
     * @dev Wraps cBTC to WcBTC and transfers it directly to the position
     * @param position The address of the position to add collateral to
     */
    function addCollateralWithCoin(address position) external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert InsufficientCoin();
        if (position == address(0)) revert InvalidPosition();

        // Wrap cBTC to WcBTC
        WCBTC.deposit{value: msg.value}();

        // Transfer WcBTC directly to the position
        bool success = WCBTC.transfer(position, msg.value);
        if (!success) revert TransferFailed();

        emit CollateralAddedWithCoin(position, msg.value);
    }

    /**
     * @notice Withdraws WcBTC and returns native cBTC to the caller
     * @dev User must first transfer WcBTC to this contract (e.g., via position.withdraw())
     *      then call this function to unwrap and receive native cBTC
     * @param amount The amount of WcBTC to unwrap and withdraw as native cBTC
     */
    function withdrawToCoin(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InsufficientCoin();

        // Transfer WcBTC from caller to this contract
        bool success = WCBTC.transferFrom(_msgSender(), address(this), amount);
        if (!success) revert TransferFailed();

        // Unwrap WcBTC to native cBTC
        WCBTC.withdraw(amount);

        // Send native cBTC to caller
        (bool sent, ) = _msgSender().call{value: amount}("");
        if (!sent) revert TransferFailed();

        emit CollateralWithdrawnToCoin(_msgSender(), amount);
    }

    /**
     * @notice Rescue function to withdraw accidentally sent native cBTC
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
     * @dev Accept cBTC only from WcBTC contract (for unwrapping), reject all others
     */
    receive() external payable {
        if (msg.sender != address(WCBTC)) {
            revert DirectCBTCNotAccepted();
        }
    }
}