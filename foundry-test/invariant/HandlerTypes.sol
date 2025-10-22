// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

/**
 * @title HandlerTypes
 * @notice Contains common type definitions for the invariant testing framework
 */

/**
 * @dev Enum representing possible states of a Position
 */
enum PositionState {
    ACTIVE,      // Position is active and not in any special state
    COOLDOWN,    // Position is in cooldown after price adjustment
    CHALLENGED,  // Position is currently being challenged
    EXPIRED,     // Position has expired
    CLOSED       // Position has been closed
}

/**
 * @dev Comprehensive state data for a position and its owner
 */
struct SystemState {
    // Position state
    uint256 debt;
    uint256 interest;
    uint256 principal;
    uint256 collateral;
    uint256 price;
    bool isCooldown;
    bool isExpired;
    uint256 availableForMinting;
    uint256 challengedAmount;
    // Owner balances
    uint256 ownerJUSDBalance;
    uint256 ownerCollateralBalance;
    address owner;
    // JUSD balances
    uint256 JUSDBalance;
    uint256 minterReserve;
}

/**
 * @dev State data for the MintingHub
 */
struct MintingHubState {
    uint256 collateral;
    uint256 challengerCollateral;
    uint256 bidderCollateral;
}