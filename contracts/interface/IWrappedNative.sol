// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IWrappedNative {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}
