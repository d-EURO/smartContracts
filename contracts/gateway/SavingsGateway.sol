// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.10;

import {IFrontendGateway} from "./interface/IFrontendGateway.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {Savings} from "../Savings.sol";

contract SavingsGateway is Savings, Context {
    IFrontendGateway public immutable GATEWAY;

    error NotGateway();

    constructor(
        IDecentralizedEURO deuro_,
        uint24 initialRatePPM,
        address gateway_
    ) public Savings(deuro_, initialRatePPM) {
        GATEWAY = IFrontendGateway(gateway_);
    }

    function refresh(address accountOwner) internal override returns (Account storage) {
        Account storage account = savings[accountOwner];
        uint64 ticks = currentTicks();
        if (ticks > account.ticks) {
            uint192 earnedInterest = calculateInterest(account, ticks);
            if (earnedInterest > 0) {
                // collect interest as you go and trigger accounting event
                (IDecentralizedEURO(address(deuro))).coverLoss(address(this), earnedInterest);
                account.saved += earnedInterest;
                GATEWAY.updateSavingRewards(accountOwner, earnedInterest);
                emit InterestCollected(accountOwner, earnedInterest);
            }
            account.ticks = ticks;
        }
        return account;
    }

    modifier gatewayOnly() {
        if (_msgSender() != address(GATEWAY)) revert NotGateway();
        _;
    }

    function adjustFor(address owner, uint192 targetAmount) public gatewayOnly {
        Account storage balance = refresh(owner);
        if (balance.saved < targetAmount) {
            saveFor(owner, owner, targetAmount - balance.saved);
        } else if (balance.saved > targetAmount) {
            withdrawFor(owner, owner, balance.saved - targetAmount);
        }
    }

    function saveFor(address sender, address target, uint192 amount) public gatewayOnly {
        if (currentRatePPM == 0) revert ModuleDisabled();
        if (nextRatePPM == 0 && (nextChange <= block.timestamp)) revert ModuleDisabled();
        Account storage balance = refresh(target);
        deuro.transferFrom(sender, address(this), amount);
        assert(balance.ticks >= currentTicks()); // @dev: should not differ, since there is no shift of interests
        balance.saved += amount;
        emit Saved(target, amount);
    }

    function withdrawFor(address owner, address target, uint192 amount) public gatewayOnly returns (uint256) {
        Account storage account = refresh(owner);
        if (amount >= account.saved) {
            amount = account.saved;
            delete savings[owner];
        } else {
            account.saved -= amount;
        }
        deuro.transfer(target, amount);
        emit Withdrawn(owner, amount);
        return amount;
    }
}
