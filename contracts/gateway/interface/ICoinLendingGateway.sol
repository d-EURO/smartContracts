// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

/**
 * @title ICoinLendingGateway
 * @notice Interface for the Coin Lending Gateway contract
 */
interface ICoinLendingGateway {
    /**
     * @notice Emitted when a position is created with native coins
     * @param owner The owner of the newly created position
     * @param position The address of the newly created position
     * @param coinAmount The amount of native coin used as collateral
     * @param mintAmount The amount of JUSD minted
     * @param liquidationPrice The liquidation price set for the position
     */
    event PositionCreatedWithCoin(
        address indexed owner,
        address indexed position,
        uint256 coinAmount,
        uint256 mintAmount,
        uint256 liquidationPrice
    );

    /**
     * @notice Creates a lending position using native coins in a single transaction
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
    ) external payable returns (address position);

    /**
     * @notice Creates a lending position for another owner using native coins
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
    ) external payable returns (address position);

    /**
     * @notice Rescue function to withdraw accidentally sent native coins
     */
    function rescueCoin() external;

    /**
     * @notice Rescue function to withdraw accidentally sent tokens
     * @param token The address of the token to rescue
     * @param to The address to send the tokens to
     * @param amount The amount of tokens to rescue
     */
    function rescueToken(address token, address to, uint256 amount) external;
}