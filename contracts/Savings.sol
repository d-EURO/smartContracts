// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDecentralizedEURO} from "./interface/IDecentralizedEURO.sol";
import {IReserve} from "./interface/IReserve.sol";
import {Leadrate} from "./Leadrate.sol";

/**
 * @title Savings
 *
 * Module to enable savings based on a Leadrate ("Leitzins") module.
 *
 * As the interest rate changes, the speed at which 'ticks' are accumulated is
 * adjusted. The ticks counter serves as the basis for calculating the interest
 * due for the individual accounts.
 */
contract Savings is Leadrate {
    IERC20 public immutable deuro;

    mapping(address => Account) public savings;

    struct Account {
        uint192 saved;
        uint64 ticks;
    }

    event Saved(address indexed account, uint192 amount);
    event InterestCollected(address indexed account, uint256 interest);
    event Withdrawn(address indexed account, uint192 amount);

    // The module is considered disabled if the interest is zero or about to become zero within three days.
    error ModuleDisabled();

    constructor(IDecentralizedEURO deuro_, uint24 initialRatePPM) Leadrate(IReserve(deuro_.reserve()), initialRatePPM) {
        deuro = IERC20(deuro_);
    }

    /**
     * Shortcut for refreshBalance(msg.sender)
     */
    function refreshMyBalance() public returns (uint192) {
        return refreshBalance(msg.sender);
    }

    /**
     * Collects the accrued interest and adds it to the account.
     *
     * It can be beneficial to do so every now and then in order to start collecting
     * interest on the accrued interest.
     */
    function refreshBalance(address owner) public returns (uint192) {
        return refresh(owner).saved;
    }

    function refresh(address accountOwner) virtual internal returns (Account storage) {
        Account storage account = savings[accountOwner];
        uint64 ticks = currentTicks();
        if (ticks > account.ticks) {
            uint192 earnedInterest = calculateInterest(account, ticks);
            if (earnedInterest > 0) {
                // collect interest as you go and trigger accounting event
                (IDecentralizedEURO(address(deuro))).distributeProfits(address(this), earnedInterest);
                account.saved += earnedInterest;
                emit InterestCollected(accountOwner, earnedInterest);
            }
            account.ticks = ticks;
        }
        return account;
    }

    function accruedInterest(address accountOwner) public view returns (uint192) {
        return accruedInterest(accountOwner, block.timestamp);
    }

    function accruedInterest(address accountOwner, uint256 timestamp) public view returns (uint192) {
        Account memory account = savings[accountOwner];
        return calculateInterest(account, ticks(timestamp));
    }

    function calculateInterest(Account memory account, uint64 ticks) public view returns (uint192) {
        if (ticks <= account.ticks || account.ticks == 0) {
            return 0;
        } else {
            uint192 earnedInterest = uint192((uint256(ticks - account.ticks) * account.saved) / 1_000_000 / 365 days);
            uint256 equity = IDecentralizedEURO(address(deuro)).equity();
            if (earnedInterest > equity) {
                return uint192(equity); // safe conversion as equity is smaller than uint192 earnedInterest
            } else {
                return earnedInterest;
            }
        }
    }

    /**
     * Save 'amount'.
     */
    function save(uint192 amount) public {
        save(msg.sender, amount);
    }

    function adjust(uint192 targetAmount) public {
        Account storage balance = refresh(msg.sender);
        if (balance.saved < targetAmount) {
            save(targetAmount - balance.saved);
        } else if (balance.saved > targetAmount) {
            withdraw(msg.sender, balance.saved - targetAmount);
        }
    }

    /**
     * Send 'amount' to the account of the provided owner.
     */
    function save(address owner, uint192 amount) public {
        if (currentRatePPM == 0) revert ModuleDisabled();
        if (nextRatePPM == 0 && (nextChange <= block.timestamp)) revert ModuleDisabled();
        Account storage balance = refresh(owner);
        deuro.transferFrom(msg.sender, address(this), amount);
        assert(balance.ticks >= currentTicks()); // @dev: should not differ, since there is no shift of interests
        balance.saved += amount;
        emit Saved(owner, amount);
    }

    /**
     * Withdraw up to 'amount' to the target address.
     * When trying to withdraw more than available, all that is available is withdrawn.
     * Returns the actually transferred amount.
     */
    function withdraw(address target, uint192 amount) public returns (uint256) {
        Account storage account = refresh(msg.sender);
        if (amount >= account.saved) {
            amount = account.saved;
            delete savings[msg.sender];
        } else {
            account.saved -= amount;
        }
        deuro.transfer(target, amount);
        emit Withdrawn(msg.sender, amount);
        return amount;
    }
}
