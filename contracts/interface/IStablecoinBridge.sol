// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IStablecoinBridge {
    function mint(uint256 amount) external;
    function mintTo(address target, uint256 amount) external;
    function burn(uint256 amount) external;
    function burnAndSend(address target, uint256 amount) external;
}
