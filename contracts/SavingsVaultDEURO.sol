// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC4626, ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

import {ISavingsDEURO} from "./interface/ISavingsDEURO.sol";

/**
 * @title SavingsVaultDEURO
 * @notice ERC-4626-compatible vault adapter for the d-EURO Savings module.
 *         This vault tracks interest-bearing deposits using a custom price-based mechanism,
 *         where share value increases over time as interest accrues.
 *
 * @dev The vault mitigates dilution and price manipulation attacks on empty vaults
 *      (a known vulnerability in ERC-4626) by using an explicit price model that starts at 1e18,
 *      instead of relying on the default totalAssets / totalSupply ratio when supply is zero.
 *
 *      Interest is recognized through a manual `_accrueInterest()` call, which updates the internal
 *      price based on newly accrued interest.
 */
contract SavingsVaultDEURO is ERC4626 {
    using Math for uint256;
    using SafeCast for uint256;

    ISavingsDEURO public immutable SAVINGS;
    uint256 public totalClaimed;

    event InterestClaimed(uint256 interest, uint256 totalClaimed);

    constructor(
        IERC20 _coin,
        ISavingsDEURO _savings,
        string memory _name,
        string memory _symbol
    ) ERC4626(_coin) ERC20(_name, _symbol) {
        SAVINGS = _savings;
        // Approve the savings contract to transfer tokens from this vault
        SafeERC20.forceApprove(_coin, address(_savings), type(uint256).max);
    }

    // ---------------------------------------------------------------------------------------

    /// @notice Returns the current savings account state for this contract
    /// @dev Uses the external `savings` contract to fetch the account details
    function info() public view returns (ISavingsDEURO.Account memory) {
        return SAVINGS.savings(address(this));
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
        return SAVINGS.accruedInterest(address(this));
    }

    // ---------------------------------------------------------------------------------------
    // Override functions of ERC4626

    function totalAssets() public view override returns (uint256) {
        return SAVINGS.savings(address(this)).saved + _interest();
    }

    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view virtual override returns (uint256) {
        return assets.mulDiv(1 ether, price(), rounding);
    }

    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view virtual override returns (uint256) {
        return shares.mulDiv(price(), 1 ether, rounding);
    }

    // ---------------------------------------------------------------------------------------

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal virtual override {
        _accrueInterest();

        // If _asset is ERC-777, `transferFrom` can trigger a reentrancy BEFORE the transfer happens through the
        // `tokensToSend` hook. On the other hand, the `tokenReceived` hook, that is triggered after the transfer,
        // calls the vault, which is assumed not malicious.
        //
        // Conclusion: we need to do the transfer before we mint so that any reentrancy would happen before the
        // assets are transferred and before the shares are minted, which is a valid state.
        // slither-disable-next-line reentrancy-no-eth
        SafeERC20.safeTransferFrom(IERC20(asset()), caller, address(this), assets);

        SAVINGS.save(assets.toUint192());

        _mint(receiver, shares);

        emit Deposit(caller, receiver, assets, shares);
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        _accrueInterest();

        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        // If _asset is ERC-777, `transfer` can trigger a reentrancy AFTER the transfer happens through the
        // `tokensReceived` hook. On the other hand, the `tokensToSend` hook, that is triggered before the transfer,
        // calls the vault, which is assumed not malicious.
        //
        // Conclusion: we need to do the transfer after the burn so that any reentrancy would happen after the
        // shares are burned and after the assets are transferred, which is a valid state.
        _burn(owner, shares);

        SAVINGS.withdraw(receiver, assets.toUint192());

        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    // ---------------------------------------------------------------------------------------

    /// @notice Internal function to accrue and record interest if available
    /// @dev Retrieves net interest via `_interest()`
    /// @dev If there is interest and shares exist, adds it to `totalClaimed` and emits an event
    function _accrueInterest() internal {
        uint256 interest = _interest();

        if (interest > 0 && totalSupply() > 0) {
            totalClaimed += interest;
            emit InterestClaimed(interest, totalClaimed);
        }
    }
}
