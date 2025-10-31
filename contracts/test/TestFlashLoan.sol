// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IEquity is IERC20 {
    function invest(uint256 amount, uint256 expected) external returns (uint256);
    function investFor(address investor, uint256 amount, uint256 expected) external returns (uint256);
    function redeem(address target, uint256 shares) external returns (uint256);
    function redeemExpected(address target, uint256 shares, uint256 expectedProceeds) external returns (uint256);
    function redeemFrom(
        address owner,
        address target,
        uint256 shares,
        uint256 expectedProceeds
    ) external returns (uint256);
}

/**
 * @title TestFlashLoan
 * @notice Helper contract to test same-block flash loan protection in Equity contract
 */
contract TestFlashLoan {
    IERC20 public immutable jusd;
    IEquity public immutable equity;

    constructor(address _jusd, address _equity) {
        jusd = IERC20(_jusd);
        equity = IEquity(_equity);
    }

    /**
     * @notice Attempts to invest and redeem in the same block
     * @dev Should revert with SameBlockRedemption
     */
    function attemptInvestAndRedeem(uint256 amount) external returns (uint256) {
        uint256 shares = equity.invest(amount, 0);
        uint256 proceeds = equity.redeem(address(this), shares);
        jusd.transfer(msg.sender, proceeds);
        return proceeds;
    }

    /**
     * @notice Attempts to redeem shares that were received in the current block
     * @dev Should revert with SameBlockRedemption
     */
    function attemptReceiveAndRedeem() external {
        uint256 msgSenderShares = equity.balanceOf(msg.sender);
        require(msgSenderShares > 0, "Message sender has no shares");
        equity.transferFrom(msg.sender, address(this), msgSenderShares);
        equity.redeem(address(this), msgSenderShares);
    }

    /**
     * @notice Attempts redeemExpected in same block as receiving shares
     * @dev Should revert with SameBlockRedemption
     */
    function attemptRedeemExpected() external {
        uint256 msgSenderShares = equity.balanceOf(msg.sender);
        require(msgSenderShares > 0, "Message sender has no shares");
        equity.transferFrom(msg.sender, address(this), msgSenderShares);
        equity.redeemExpected(address(this), msgSenderShares, 0);
    }

    /**
     * @notice Attempts invest and redeemExpected in the same block
     * @dev Should revert with SameBlockRedemption
     */
    function attemptInvestAndRedeemExpected(uint256 amount) external returns (uint256) {
        uint256 shares = equity.invest(amount, 0);
        uint256 proceeds = equity.redeemExpected(address(this), shares, 0);
        return proceeds;
    }

    /**
     * @notice Attempts investFor and redeemFrom on behalf of another investor in the same block
     * @dev Should revert with SameBlockRedemption
     */
    function attemptInvestForAndRedeemFrom(uint256 amount, address investor) external returns (uint256) {
        uint256 shares = equity.investFor(investor, amount, 0);
        uint256 proceeds = equity.redeemFrom(investor, address(this), shares, 0);
        return proceeds;
    }
}
