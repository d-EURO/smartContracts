// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISavingsZCHF {

    /// @notice Account structure for savings information
    /// @param saved The amount of tokens saved
    /// @param ticks The tick value when funds were locked (used for unlock timing)
    struct Account {
        uint192 saved;
        uint64 ticks;
    }

    /// @notice Error thrown when attempting to withdraw locked funds
    /// @param unlockTime The time (in seconds or ticks) when funds will be unlocked
    error FundsLocked(uint40 unlockTime);

    /// @notice Get the savings account information for a specific address
    /// @param account The address to query
    /// @return Account struct containing savings information
    function savings(address account) external view returns (Account memory);

    /// @notice Get the current tick value in the savings system
    /// @return Current tick value
    function currentTicks() external view returns (uint64);

    /// @notice Get the accrued interest for a specific account
    /// @param account The address to query
    /// @return Amount of accrued interest
    function accruedInterest(address account) external view returns (uint256);

    /// @notice Save tokens to the savings account
    /// @param amount The amount to save
    function save(uint192 amount) external;

    /// @notice Withdraw tokens from the savings account
    /// @param receiver The address to receive the withdrawn tokens
    /// @param amount The amount to withdraw
    function withdraw(address receiver, uint192 amount) external;
}
