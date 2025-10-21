// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ERC3009} from "../impl/ERC3009.sol";

contract TestToken is ERC20,  EIP712, ERC3009, ERC20Burnable {
    uint8 private _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_)  EIP712(name_, "1") ERC20(name_, symbol_) {
        _decimals = decimals_;
        _mint(msg.sender, 10_000_000 * 1e18);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address _account, uint256 _amount) external {
        _mint(_account, _amount);
    }

    // Note: Doesn't revert on failure, instead returns false (same as USDC token).
    // This behaviour is used in BasicTests.ts (SafeERC20 test).
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public override returns (bool) {
        uint256 currentAllowance = allowance(from, msg.sender);
        if (currentAllowance < amount) {
            return false;
        }

        if (balanceOf(from) < amount) {
            return false;
        }

        _approve(from, msg.sender, currentAllowance - amount); // Update allowance
        _transfer(from, to, amount); // Perform the transfer
        return true;
    }
}
