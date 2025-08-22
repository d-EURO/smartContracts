// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {ILeadrate} from "../interface/ILeadrate.sol";
import {Savings} from "../Savings.sol";

/**
 * This is a
 */
contract LiquidSavings {
    IDecentralizedEURO public immutable DEURO;
    ILeadrate public immutable RATE;
    address public immutable OWNER;

    uint64 private ticks;

    constructor(address _owner, address _deuro, address _leadRate) {
        OWNER = _owner;
        DEURO = IDecentralizedEURO(_deuro);
        RATE = ILeadrate(_leadRate);
        ticks = RATE.currentTicks();
    }

    function refresh() external virtual returns (uint64) {
        uint64 ticks_ = RATE.currentTicks();
        if (ticks_ > ticks) {
            uint192 earnedInterest = calculateInterest(ticks_);
            if (earnedInterest > 0) {
                DEURO.distributeProfits(OWNER, earnedInterest);
                emit Savings.InterestCollected(OWNER, earnedInterest);
            }
            ticks = ticks_;
        }
        return ticks;
    }

    function calculateInterest(uint64 ticks_) public view returns (uint192) {
        if (ticks_ <= ticks || ticks == 0) {
            return 0;
        } else {
            uint256 balance = DEURO.balanceOf(OWNER);

            uint192 earnedInterest = uint192((uint256(ticks_ - ticks) * balance) / 1_000_000 / 365 days);
            uint256 equity = DEURO.equity();
            if (earnedInterest > equity) {
                return uint192(equity); // safe conversion as equity is smaller than uint192 earnedInterest
            } else {
                return earnedInterest;
            }
        }
    }
}
