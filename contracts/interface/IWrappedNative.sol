// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @notice Interface for wrapped native tokens (e.g., WcBTC, WETH)
 */
interface IWrappedNative {
    function deposit() external payable;
    function withdraw(uint256) external;
}
