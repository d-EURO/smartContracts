// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {IFrontendGateway} from "./interface/IFrontendGateway.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {IJuiceDollar} from "../interface/IJuiceDollar.sol";
import {Savings} from "../Savings.sol";

contract SavingsGateway is Savings, Context {
    IFrontendGateway public immutable GATEWAY;

    constructor(IJuiceDollar jusd_, uint24 initialRatePPM, address gateway_) Savings(jusd_, initialRatePPM) {
        GATEWAY = IFrontendGateway(gateway_);
    }

    function refresh(address accountOwner) internal override returns (Account storage) {
        Account storage account = savings[accountOwner];
        uint64 ticks = currentTicks();
        if (ticks > account.ticks) {
            uint192 earnedInterest = calculateInterest(account, ticks);
            if (earnedInterest > 0) {
                // collect interest as you go and trigger accounting event
                (IJuiceDollar(address(jusd))).distributeProfits(address(this), earnedInterest);
                account.saved += earnedInterest;
                GATEWAY.updateSavingRewards(accountOwner, earnedInterest);
                emit InterestCollected(accountOwner, earnedInterest);
            }
            account.ticks = ticks;
        }
        return account;
    }

    function save(uint192 amount, bytes32 frontendCode) public {
        save(_msgSender(), amount, frontendCode);
    }

    function save(address owner, uint192 amount, bytes32 frontendCode) public {
        GATEWAY.updateSavingCode(_msgSender(), frontendCode);
        save(owner, amount);
    }

    function adjust(uint192 targetAmount, bytes32 frontendCode) public {
        GATEWAY.updateSavingCode(_msgSender(), frontendCode);
        adjust(targetAmount);
    }

    function withdraw(address target, uint192 amount, bytes32 frontendCode) public returns (uint256) {
        GATEWAY.updateSavingCode(_msgSender(), frontendCode);
        return withdraw(target, amount);
    }
}
