// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {Savings} from "../Savings.sol";
import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {ILeadrate} from "../interface/ILeadrate.sol";

/**
 * This is a Savings Contract for Savers who need to stay liquid
 */
contract LiquidMultiSavings {
    IDecentralizedEURO public immutable DEURO;
    ILeadrate public immutable RATE;

    mapping(address => LiquidSavingsAccount) public accounts;

    struct LiquidSavingsAccount {
        uint64 ticks;
        uint40 proposalActivationDate;
        uint40 proposalDeactivationDate;
    }

    event LiquidSaverActivationProposed(address who, address proposer, uint40 effectiveDate);
    event LiquidSaverDeactivationProposed(address who, address proposer, uint40 effectiveDate);
    event LiquidSaverEnabled(address who);
    event LiquidSaverDisabled(address who);

    constructor(address _deuro, address _leadRate) {
        DEURO = IDecentralizedEURO(_deuro);
        RATE = ILeadrate(_leadRate);
    }

    function refresh(address account) external virtual returns (uint64) {
        require(accounts[account].ticks > 0, "[LiquidMultiSavings] This account is not eligible for liquid Savings");

        uint64 ticks_ = RATE.currentTicks();
        if (ticks_ > accounts[account].ticks) {
            uint192 earnedInterest = calculateInterest(ticks_, account);
            if (earnedInterest > 0) {
                DEURO.distributeProfits(account, earnedInterest);
                emit Savings.InterestCollected(account, earnedInterest);
            }
            accounts[account].ticks = ticks_;
        }
        return accounts[account].ticks;
    }

    function calculateInterest(uint64 ticks_, address account) public view returns (uint192) {
        uint64 ticks = accounts[account].ticks;
        if (ticks_ <= ticks || ticks == 0) {
            return 0;
        } else {
            uint256 balance = DEURO.balanceOf(account);

            uint192 earnedInterest = uint192((uint256(ticks_ - ticks) * balance) / 1_000_000 / 365 days);
            uint256 equity = DEURO.equity();
            if (earnedInterest > equity) {
                return uint192(equity); // safe conversion as equity is smaller than uint192 earnedInterest
            } else {
                return earnedInterest;
            }
        }
    }

    function proposeLiquidSaver(
        address account,
        bool disableAccount,
        address[] calldata helpers
    ) external virtual returns (uint40) {
        require(accounts[account].ticks == 0 || disableAccount, "[LiquidMultiSavings] No action required");
        DEURO.reserve().checkQualified(msg.sender, helpers);

        uint40 nextDate = uint40(block.timestamp + 7 days);
        if (disableAccount) {
            accounts[account].proposalDeactivationDate = nextDate;
            emit LiquidSaverDeactivationProposed(account, msg.sender, nextDate);
        } else {
            accounts[account].proposalActivationDate = nextDate;
            emit LiquidSaverActivationProposed(account, msg.sender, nextDate);
        }
        return nextDate;
    }

    function enableLiquidSaver(address account) external virtual {
        require(
            accounts[account].ticks == 0 && uint40(block.timestamp) > accounts[account].proposalActivationDate && accounts[account].proposalActivationDate > 0,
            "[LiquidMultiSavings] No action possible"
        );

        accounts[account].ticks = RATE.currentTicks();
        emit LiquidSaverEnabled(account);
    }

    function disableLiquidSaver(address account) external virtual {
        require(
            accounts[account].ticks != 0 && uint40(block.timestamp) > accounts[account].proposalDeactivationDate && accounts[account].proposalDeactivationDate > 0,
            "[LiquidMultiSavings] No action possible"
        );

        refresh(account);
        accounts[account].ticks = 0;
        emit LiquidSaverDisabled(account);
    }
}
