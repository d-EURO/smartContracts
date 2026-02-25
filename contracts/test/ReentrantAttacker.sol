// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPosition} from "../MintingHubV3/interface/IPosition.sol";

/**
 * @title ReentrantAttacker
 * @notice Test contract that attempts reentrancy on withdrawCollateralAsNative.
 */
contract ReentrantAttacker {
    IPosition public target;
    uint256 public attackAmount;
    uint256 public attackCount;
    bool public attackSucceeded;
    string public lastRevertReason;

    function setTarget(address _target, uint256 _amount) external {
        target = IPosition(_target);
        attackAmount = _amount;
        attackCount = 0;
        attackSucceeded = false;
        lastRevertReason = "";
    }

    function triggerWithdraw(uint256 amount) external {
        target.withdrawCollateralAsNative(address(this), amount);
    }

    receive() external payable {
        attackCount++;
        if (attackCount < 2) {
            try target.withdrawCollateralAsNative(address(this), attackAmount) {
                attackSucceeded = true;
            } catch Error(string memory reason) {
                lastRevertReason = reason;
            } catch (bytes memory) {
                lastRevertReason = "low-level revert";
            }
        }
    }
}
