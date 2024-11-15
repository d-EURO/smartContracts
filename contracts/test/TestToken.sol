// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
    constructor(
        string memory name,
        string memory symbol,
        uint8 dec
    ) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000 * 1e18);
    }

    function mint(address _account, uint256 _amount) external {
        _mint(_account, _amount);
    }
}
