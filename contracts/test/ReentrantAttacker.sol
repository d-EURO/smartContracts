// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IPosition} from "../MintingHubV2/interface/IPosition.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ReentrantAttacker
 * @notice Test contract that attempts reentrancy attack on Position.withdrawCollateralAsNative()
 * @dev Used to verify Position is safe against reentrancy
 */
contract ReentrantAttacker is Ownable {
    IPosition public targetPosition;
    uint256 public attackCount;
    uint256 public withdrawAmount;
    bool public attackSucceeded;
    string public lastRevertReason;

    event AttackAttempted(uint256 count, bool success, string reason);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Sets the target position for the attack
     * @param _position The position contract to attack
     */
    function setTarget(address _position) external onlyOwner {
        targetPosition = IPosition(_position);
    }

    /**
     * @notice Initiates the reentrancy attack
     * @param _amount Amount to withdraw in each attempt
     */
    function attack(uint256 _amount) external onlyOwner {
        require(address(targetPosition) != address(0), "Target not set");
        withdrawAmount = _amount;
        attackCount = 0;
        attackSucceeded = false;
        lastRevertReason = "";

        targetPosition.withdrawCollateralAsNative(address(this), _amount);
    }

    /**
     * @notice Called when receiving native coin - attempts reentrancy
     */
    receive() external payable {
        attackCount++;

        if (attackCount < 2) {
            // Attempt reentrancy on second receive
            try targetPosition.withdrawCollateralAsNative(address(this), withdrawAmount) {
                // If this succeeds, reentrancy attack worked
                attackSucceeded = true;
                emit AttackAttempted(attackCount, true, "Attack succeeded - VULNERABILITY!");
            } catch Error(string memory reason) {
                lastRevertReason = reason;
                emit AttackAttempted(attackCount, false, reason);
            } catch (bytes memory) {
                lastRevertReason = "Unknown revert";
                emit AttackAttempted(attackCount, false, "Unknown revert");
            }
        }
    }

    /**
     * @notice Allows owner to withdraw any native coin from this contract
     */
    function withdrawAll() external onlyOwner {
        (bool success, ) = owner().call{value: address(this).balance}("");
        require(success, "Withdraw failed");
    }
}
