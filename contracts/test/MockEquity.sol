// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Equity} from "../Equity.sol";
import {JuiceDollar} from "../JuiceDollar.sol";

contract MockEquity is Equity {
    constructor(JuiceDollar JUSD_) Equity(JUSD_) {
        require(block.chainid == 31337, "MockEquity: TEST ONLY");
    }

    function mintForTesting(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
