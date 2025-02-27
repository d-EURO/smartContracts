// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {Test} from "forge-std/Test.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {console} from "forge-std/Test.sol";

abstract contract TestHelper is Test {
    function max(uint a, uint b) internal pure returns (uint) {
        return a > b ? a : b;
    }

    function min(uint a, uint b) internal pure returns (uint) {
        return a < b ? a : b;
    }

    //////////// EVM Helpers ////////////

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

    //////////// Log Helpers ////////////
    function logFormattedUint256(string memory message, uint256 value, uint256 decimals) internal pure {
        console.log(message, formatUint256(value, decimals));
    }

    /// @dev Given a uint256 value, format it as a string with the given number of decimals
    function formatUint256(uint256 value, uint256 decimals) internal pure returns (string memory) {
        return string(abi.encodePacked(Strings.toString(value / 10 ** decimals), ".", Strings.toString(value % 10 ** decimals)));
    }
}