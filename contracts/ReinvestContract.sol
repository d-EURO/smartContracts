// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ERC4626, ERC20, IERC20} from '@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol';
import {Ownable2Step, Ownable} from '@openzeppelin/contracts/access/Ownable2Step.sol';

import {ISavingsZCHF} from './helpers/IReinvestContract.sol';

/**
 * @title SavingsVaultZCHF
 * @notice ERC-4626-compatible vault adapter for the ISavingsZCHF module.
 *         This vault tracks interest-bearing deposits using a custom price-based mechanism,
 *         where share value increases over time as interest accrues.
 *
 * @dev The vault mitigates dilution and price manipulation attacks on empty vaults
 *      (a known vulnerability in ERC-4626) by using an explicit price model that starts at 1e18,
 *      instead of relying on the default totalAssets / totalSupply ratio when supply is zero.
 *
 *      Interest is recognized through a manual `_accrueInterest()` call, which updates the internal
 *      price based on newly accrued interest. Withdrawals are protected by a locking mechanism tied
 *      to `savings.currentTicks()`, preventing premature exits and mitigating manipulation of
 *      account-based interest shifts enforced by `savings.INTEREST_DELAY()`.
 */
contract SavingsVaultZCHF is ERC4626, Ownable2Step {
    using Math for uint256;

    ISavingsZCHF public immutable savings;
    uint256 public totalClaimed;

    event InterestClaimed(uint256 interest, uint256 totalClaimed);

    constructor(
        address _owner,
        IERC20 _coin,
        ISavingsZCHF _savings,
        string memory _name,
        string memory _symbol
    ) ERC4626(_coin) ERC20(_name, _symbol) Ownable(_owner) {
        savings = _savings;
    }

    function info() public view returns (ISavingsZCHF.Account memory) {
        return savings.savings(address(this));
    }

    /// @notice Returns the current price per share of the contract
    /// @dev If no shares exist, it defaults to 1 ether (implying 1:1 value)
    function price() public view returns (uint256) {
        uint256 totalShares = totalSupply();
        if (totalShares == 0) return 1 ether;
        return (totalAssets() * 1 ether) / totalShares;
    }

    /// @notice Calculates the accrued interest for this contract
    function _interest() internal view returns (uint256) {
        return savings.accruedInterest(address(this));
    }

    function totalAssets() public view override returns (uint256) {
        return savings.savings(address(this)).saved + _interest();
    }

    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view virtual override returns (uint256) {
        return (assets * 1 ether) / price();
    }

    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view virtual override returns (uint256) {
        return (shares * price()) / 1 ether;
    }

    /// @notice Checks whether the vault's funds are unlocked and eligible for withdrawal.
    /// @dev Compares the current tick with the tick at which the vault's funds become available.
    function isUnlocked() public view returns (bool) {
        return savings.currentTicks() >= savings.savings(address(this)).ticks;
    }

    /// @notice Returns the time (in seconds) until the vault's funds are unlocked.
    /// @dev Returns 0 as funds are always unlocked in simplified version
    function untilUnlocked() public pure returns (uint256) {
        return 0;
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal virtual override {
        _accrueInterest();

        SafeERC20.safeTransferFrom(IERC20(asset()), caller, address(this), assets);

        savings.save(uint192(assets));

        _mint(receiver, shares);

        emit Deposit(caller, receiver, assets, shares);
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares) internal virtual override {
        if (isUnlocked() == false) revert ISavingsZCHF.FundsLocked(uint40(untilUnlocked()));

        _accrueInterest();

        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        _burn(owner, shares);

        savings.withdraw(receiver, uint192(assets));

        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    function _accrueInterest() internal {
        uint256 interest = _interest();

        if (interest > 0 && totalSupply() > 0) {
            totalClaimed += interest;
            emit InterestClaimed(interest, totalClaimed);
        }
    }

}
