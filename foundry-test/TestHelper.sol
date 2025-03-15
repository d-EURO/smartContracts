// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {Test} from "forge-std/Test.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {console} from "forge-std/Test.sol";

abstract contract TestHelper is Test {
    //////////// Math Helpers ////////////

    function max(uint a, uint b) internal pure returns (uint) {
        return a > b ? a : b;
    }

    function min(uint a, uint b) internal pure returns (uint) {
        return a < b ? a : b;
    }

    //////////// EVM Helpers ////////////

    /// @dev Increase the time of the EVM in seconds
    function increaseTime(uint40 _seconds) internal {
        vm.warp(block.timestamp + _seconds);
    }

    /// @dev Increase the time of the EVM to a specific timestamp
    function increaseTimeTo(uint40 _timestamp) internal {
        vm.warp(_timestamp);
    }

    /// @dev Increase the block number of the EVM by a given number of blocks
    function increaseBlocks(uint8 _blocks) internal {
        vm.roll(block.number + _blocks);
    }

    //////////// Prank Helpers ////////////

    modifier prank(address from) {
        vm.startPrank(from);
        _;
        vm.stopPrank();
    }

    //////////// Misc Helpers ////////////

    /// @dev Check if action should execute based on a percentage chance
    function shouldExecute(uint256 percent) internal view returns (bool) {
        // Use more entropy sources to make the randomness more unpredictable
        return uint256(keccak256(abi.encodePacked(block.timestamp, block.number, msg.sender))) % 100 < percent;
    }

    //////////// Log Helpers ////////////

    function logFormattedUint256(string memory message, uint256 value, uint256 decimals) internal pure {
        console.log(message, formatUint256(value, decimals));
    }

    function logRow(string memory rowLabel, string[] memory columns) internal pure {
        string memory formattedRow = string(abi.encodePacked("  ", padString(rowLabel, 35)));
        for (uint256 i = 0; i < columns.length; i++) {
            formattedRow = string(abi.encodePacked(formattedRow, padString(columns[i], 25)));
        }
        console.log(formattedRow);
    }

    function logRow2(string memory rowLabel, string[2] memory columns) internal pure {
        string[] memory dynamicColumns = new string[](2);
        for (uint256 i = 0; i < 2; i++) dynamicColumns[i] = columns[i];
        logRow(rowLabel, dynamicColumns);
    }

    function logRow3(string memory rowLabel, string[3] memory columns) internal pure {
        string[] memory dynamicColumns = new string[](3);
        for (uint256 i = 0; i < 3; i++) dynamicColumns[i] = columns[i];
        logRow(rowLabel, dynamicColumns);
    }

    function logHorizontalDivider() internal pure {
        console.log("  ---------------------------------------------------------------------------------------------------------------------------------");
    }

    //////////// Formatting Helpers ////////////

    function uint256ToString(uint256 value) internal pure returns (string memory) {
        return Strings.toString(value);
    }

    /// @dev Given a uint256 value, format it as a string with the given number of decimals
    /// Adds proper formatting to make large numbers more readable
    function formatUint256(uint256 value, uint256 decimals) internal pure returns (string memory) {
        if (value == 0) return "0.0";
        
        // Split into integer and decimal parts
        uint256 integerPart = value / 10 ** decimals;
        uint256 decimalPart = value % 10 ** decimals;
        
        // Format integer part with commas every 3 digits for readability
        string memory integerStr = "";
        uint256 temp = integerPart;
        uint256 count = 0;
        
        if (temp == 0) {
            integerStr = "0";
        } else {
            while (temp > 0) {
                if (count > 0 && count % 3 == 0) {
                    integerStr = string(abi.encodePacked(",", integerStr));
                }
                uint256 digit = temp % 10;
                integerStr = string(abi.encodePacked(Strings.toString(digit), integerStr));
                temp = temp / 10;
                count++;
            }
        }
        
        // Format decimal part to show just the significant digits (up to 6)
        uint256 maxDecimalDigits = 6;
        string memory decimalStr = formatDecimalPart(decimalPart, decimals, maxDecimalDigits);
        
        // Combine parts with decimal point
        return string(abi.encodePacked(integerStr, ".", decimalStr));
    }
    
    /// @dev Helper to format the decimal part of a number, limiting to significant digits
    function formatDecimalPart(uint256 decimalPart, uint256 decimals, uint256 maxDigits) internal pure returns (string memory) {
        if (decimalPart == 0) return "0";
        
        // Calculate leading zeros
        uint256 leadingZeros = 0;
        uint256 temp = decimalPart;
        uint256 divisor = 10 ** (decimals - 1);
        
        while (temp > 0 && temp / divisor == 0) {
            leadingZeros++;
            divisor = divisor / 10;
        }
        
        // Convert decimal part to string
        string memory decimalStr = Strings.toString(decimalPart);
        
        // Add leading zeros
        string memory zeros = "";
        for (uint256 i = 0; i < leadingZeros; i++) {
            zeros = string(abi.encodePacked(zeros, "0"));
        }
        decimalStr = string(abi.encodePacked(zeros, decimalStr));
        
        // Pad with trailing zeros if needed
        while (bytes(decimalStr).length < decimals) {
            decimalStr = string(abi.encodePacked(decimalStr, "0"));
        }
        
        // Trim to maxDigits or remove trailing zeros
        uint256 significantDigits = 0;
        uint256 len = bytes(decimalStr).length;
        
        // Count significant digits (from the end until we hit a non-zero)
        bool foundNonZero = false;
        for (uint256 i = 0; i < len; i++) {
            uint256 pos = len - 1 - i;
            bytes memory strBytes = bytes(decimalStr);
            if (strBytes[pos] != bytes1("0")) {
                foundNonZero = true;
            }
            if (foundNonZero) {
                significantDigits++;
            }
            if (significantDigits >= maxDigits) break;
        }
        
        // Trim to significantDigits or maxDigits
        uint256 trimLength = min(len, maxDigits);
        
        // If all zeros, return just one zero
        if (!foundNonZero) return "0";
        
        bytes memory result = new bytes(trimLength);
        for (uint256 i = 0; i < trimLength; i++) {
            result[i] = bytes(decimalStr)[i];
        }
        
        return string(result);
    }

    /**
     * @notice pad a string with spaces to a fixed width
     * @param label The string to pad
     * @param width The desired width of the string
     */
    function padString(string memory label, uint8 width) internal pure returns (string memory) {
        bytes memory labelBytes = bytes(label);
        require(labelBytes.length <= width, "Name too long");
        uint padLen = width - labelBytes.length;
        bytes memory spaces = new bytes(padLen);
        for (uint i = 0; i < padLen; i++) {
            spaces[i] = 0x20; // ASCII space character
        }
        return string(abi.encodePacked(label, spaces));
    }
}