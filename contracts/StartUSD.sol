// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title StartUSD
 * @notice A minimal genesis stablecoin used to bootstrap the JuiceDollar protocol.
 * @dev Mints 10,000 SUSD to the deployer. Used to initialize the protocol with initial
 * JUSD supply through a StablecoinBridge, which then creates the initial JUICE tokens.
 */
contract StartUSD is ERC20 {
    constructor() ERC20("StartUSD", "SUSD") {
        _mint(msg.sender, 10_000 * 10 ** 18);
    }
}
