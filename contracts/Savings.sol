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
    mapping(address => uint192) public principalWithoutCompounding;

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
            uint192 earnedInterest = calculateInterest(accountOwner, account, ticks);
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
        return calculateInterest(accountOwner, account, ticks(timestamp));
    }

    function calculateInterest(Account memory account, uint64 ticks) public view returns (uint192) {
        if (ticks <= account.ticks || account.ticks == 0) {
            return 0;
        } else {
            uint192 earnedInterest = uint192((uint256(ticks - account.ticks) * account.saved) / 1_000_000 / 365 days);
            uint256 equity = IDecentralizedEURO(address(deuro)).equity();
            if (earnedInterest > equity) {
                return uint192(equity);
            } else {
                return earnedInterest;
            }
        }
    }

    function calculateInterest(address accountOwner, Account memory account, uint64 ticks) internal view returns (uint192) {
        if (ticks <= account.ticks || account.ticks == 0) {
            return 0;
        } else {
            // Calculate interest only on the principal (saved minus non-compounding amounts)
            uint192 principal = account.saved - principalWithoutCompounding[accountOwner];
            uint192 earnedInterest = uint192((uint256(ticks - account.ticks) * principal) / 1_000_000 / 365 days);
            uint256 equity = IDecentralizedEURO(address(deuro)).equity();
            if (earnedInterest > equity) {
                return uint192(equity);
            } else {
                return earnedInterest;
            }
        }
    }

    /**
     * Save 'amount' with compound interest (reinvests accrued interest).
     */
    function saveAndCompound(uint192 amount) public {
        saveAndCompound(msg.sender, amount);
    }

    function adjust(uint192 targetAmount) public {
        Account storage balance = refresh(msg.sender);
        if (balance.saved < targetAmount) {
            saveAndCompound(targetAmount - balance.saved);
        } else if (balance.saved > targetAmount) {
            withdraw(msg.sender, balance.saved - targetAmount);
        }
    }

    /**
     * Send 'amount' to the account of the provided owner with compound interest.
     */
    function saveAndCompound(address owner, uint192 amount) public {
        if (currentRatePPM == 0) revert ModuleDisabled();
        if (nextRatePPM == 0 && (nextChange <= block.timestamp)) revert ModuleDisabled();
        Account storage balance = refresh(owner);
        deuro.transferFrom(msg.sender, address(this), amount);
        assert(balance.ticks >= currentTicks()); // @dev: should not differ, since there is no shift of interests
        balance.saved += amount;
        emit Saved(owner, amount);
    }

    /**
     * Save 'amount' without compounding accrued interest.
     * This keeps the interest separate and doesn't add it to the principal.
     */
    function save(uint192 amount) public {
        save(msg.sender, amount);
    }

    /**
     * Send 'amount' to the account of the provided owner without compounding interest.
     * This doesn't call refresh() first, so any accrued interest remains separate
     * and is not added to the principal. Interest continues to accrue on the original saved amount only.
     */
    function save(address owner, uint192 amount) public {
        if (currentRatePPM == 0) revert ModuleDisabled();
        if (nextRatePPM == 0 && (nextChange <= block.timestamp)) revert ModuleDisabled();
        
        Account storage account = savings[owner];
        
        // If this is a new account, initialize ticks
        if (account.ticks == 0) {
            account.ticks = currentTicks();
        }
        
        deuro.transferFrom(msg.sender, address(this), amount);
        account.saved += amount;
        principalWithoutCompounding[owner] += amount;
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
            delete principalWithoutCompounding[msg.sender];
        } else {
            // Proportionally reduce the non-compounding principal before reducing saved
            if (principalWithoutCompounding[msg.sender] > 0) {
                uint192 reduction = uint192((uint256(principalWithoutCompounding[msg.sender]) * amount) / account.saved);
                principalWithoutCompounding[msg.sender] -= reduction;
            }
            account.saved -= amount;
        }
        deuro.transfer(target, amount);
        emit Withdrawn(msg.sender, amount);
        return amount;
    }
}
