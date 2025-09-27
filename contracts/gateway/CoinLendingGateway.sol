// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {IMintingHubGateway} from "./interface/IMintingHubGateway.sol";
import {ICoinLendingGateway} from "./interface/ICoinLendingGateway.sol";
import {IPosition} from "../MintingHubV2/interface/IPosition.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
}

/**
 * @title Coin Lending Gateway
 * @notice A gateway contract that enables single-transaction native coin lending through the dEURO protocol
 * @dev This contract wraps native coins (ETH, MATIC, etc.) to their wrapped versions, approves them, and clones a position in a single transaction
 */
contract CoinLendingGateway is ICoinLendingGateway, Context {
    IMintingHubGateway public immutable MINTING_HUB;
    IWETH public immutable WETH;

    error InsufficientCoin();
    error InvalidPosition();
    error TransferFailed();
    error InvalidLiquidationPrice();

    event PositionCreatedWithCoin(
        address indexed owner,
        address indexed position,
        uint256 coinAmount,
        uint256 mintAmount,
        uint256 liquidationPrice
    );

    /**
     * @notice Initializes the Coin Lending Gateway
     * @param _mintingHub The address of the MintingHubGateway contract
     * @param _weth The address of the wrapped native token contract (WETH, WMATIC, etc.)
     */
    constructor(address _mintingHub, address _weth) {
        MINTING_HUB = IMintingHubGateway(_mintingHub);
        WETH = IWETH(_weth);
    }

    /**
     * @notice Creates a lending position using native coins in a single transaction
     * @dev Wraps native coins to wrapped tokens, approves them for the MintingHub, clones position, and optionally adjusts price
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
    ) external payable returns (address position) {
        if (msg.value == 0) revert InsufficientCoin();

        // Wrap native coin to wrapped token
        WETH.deposit{value: msg.value}();

        // Approve wrapped token for MintingHub
        WETH.approve(address(MINTING_HUB), msg.value);

        // Clone position through MintingHub
        position = MINTING_HUB.clone(
            _msgSender(),    // owner
            parent,          // parent position
            msg.value,       // collateral amount
            initialMint,     // mint amount
            expiration,
            frontendCode
        );

        if (position == address(0)) revert InvalidPosition();

        // Adjust liquidation price if specified
        if (liquidationPrice > 0) {
            _adjustPositionPrice(position, liquidationPrice);
        }

        emit PositionCreatedWithCoin(
            _msgSender(),
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
    ) external payable returns (address position) {
        if (msg.value == 0) revert InsufficientCoin();

        // Wrap native coin to wrapped token
        WETH.deposit{value: msg.value}();

        // Approve wrapped token for MintingHub
        WETH.approve(address(MINTING_HUB), msg.value);

        // Clone position through MintingHub
        position = MINTING_HUB.clone(
            owner,           // specified owner
            parent,          // parent position
            msg.value,       // collateral amount
            initialMint,     // mint amount
            expiration,
            frontendCode
        );

        if (position == address(0)) revert InvalidPosition();

        // Adjust liquidation price if specified
        if (liquidationPrice > 0) {
            _adjustPositionPrice(position, liquidationPrice);
        }

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
     * @dev Internal function to adjust the position's liquidation price
     * @param position The address of the position to adjust
     * @param liquidationPrice The new liquidation price
     */
    function _adjustPositionPrice(address position, uint256 liquidationPrice) internal {
        // Get current price from position
        uint256 currentPrice = IPosition(position).price();

        // Only adjust if the liquidation price is different from current
        if (liquidationPrice != currentPrice) {
            // Add small buffer (0.01%) to account for potential interest accrual
            uint256 adjustedPrice = (liquidationPrice * 10001) / 10000;

            // Since we just created the position, we should be the owner
            // and have the right to adjust the price
            IPosition(position).adjustPrice(adjustedPrice);
        }
    }

    /**
     * @notice Rescue function to withdraw accidentally sent native coins
     * @dev Only allows withdrawal if contract balance exists
     */
    function rescueCoin() external {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success, ) = _msgSender().call{value: balance}("");
            if (!success) revert TransferFailed();
        }
    }

    /**
     * @notice Rescue function to withdraw accidentally sent tokens
     * @param token The address of the token to rescue
     * @param to The address to send the tokens to
     * @param amount The amount of tokens to rescue
     */
    function rescueToken(address token, address to, uint256 amount) external {
        IERC20(token).transfer(to, amount);
    }

    /**
     * @dev Receive function to accept native coins
     */
    receive() external payable {}
}