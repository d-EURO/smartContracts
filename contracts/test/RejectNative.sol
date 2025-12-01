// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title RejectNative
 * @notice Test helper contract that rejects all native coin transfers
 * @dev Used to test NativeTransferFailed error in Position.withdrawCollateralAsNative()
 */
contract RejectNative {
    receive() external payable {
        revert("I reject native coin");
    }

    fallback() external payable {
        revert("I reject native coin");
    }
}
