// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TestWETH
 * @notice Test WETH implementation for testing CoinLendingGateway
 */
contract TestWETH is ERC20 {
    error InsufficientBalance();
    error ETHTransferFailed();

    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    constructor() ERC20("Wrapped Ether", "WETH") {}

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) external {
        if (balanceOf(msg.sender) < wad) revert InsufficientBalance();
        _burn(msg.sender, wad);
        (bool success, ) = msg.sender.call{value: wad}("");
        if (!success) revert ETHTransferFailed();
        emit Withdrawal(msg.sender, wad);
    }
}