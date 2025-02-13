// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {Test} from "forge-std/Test.sol";

abstract contract TestHelper is Test {
    function max(uint a, uint b) internal pure returns (uint) {
        return a > b ? a : b;
    }

    function increaseTime(uint _seconds) internal {
        vm.warp(block.timestamp + _seconds);
    }

    function increaseBlock(uint _blocks) internal {
        vm.roll(block.number + _blocks);
    }

    modifier prank(address from) {
        vm.startPrank(from);
        _;
        vm.stopPrank();
    }
}