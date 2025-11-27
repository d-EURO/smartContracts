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
     * @notice Emitted when collateral is added to a position with native coins
     * @param position The address of the position
     * @param amount The amount of native coin added as collateral
     */
    event CollateralAddedWithCoin(address indexed position, uint256 amount);

    /**
     * @notice Emitted when WcBTC is withdrawn as native coins
     * @param to The recipient of the native coins
     * @param amount The amount of native coins withdrawn
     */
    event CollateralWithdrawnToCoin(address indexed to, uint256 amount);

    /**
     * @notice Adds collateral to an existing position using native coins
     * @param position The address of the position to add collateral to
     */
    function addCollateralWithCoin(address position) external payable;

    /**
     * @notice Withdraws WcBTC and returns native coins to the caller
     * @dev User must first approve WcBTC spending by this contract
     * @param amount The amount of WcBTC to unwrap and withdraw as native coins
     */
    function withdrawToCoin(uint256 amount) external;

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