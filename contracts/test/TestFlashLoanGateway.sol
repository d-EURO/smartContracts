// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFrontendGateway {
    function invest(uint256 amount, uint256 expectedShares, bytes32 frontendCode) external returns (uint256);
    function redeem(address target, uint256 shares, uint256 expectedProceeds, bytes32 frontendCode) external returns (uint256);
}

interface IEquity is IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
}

/**
 * @title TestFlashLoanGateway
 * @notice Helper contract to test same-block flash loan protection via FrontendGateway
 */
contract TestFlashLoanGateway {
    IERC20 public immutable jusd;
    IEquity public immutable equity;
    IFrontendGateway public immutable gateway;

    constructor(address _jusd, address _equity, address _gateway) {
        jusd = IERC20(_jusd);
        equity = IEquity(_equity);
        gateway = IFrontendGateway(_gateway);
    }

    /**
     * @notice Attempts to invest and immediately redeem via FrontendGateway in the same transaction
     * @dev Should revert with SameBlockRedemption
     */
    function attemptInvestAndRedeemViaGateway(
        uint256 amount,
        bytes32 frontendCode
    ) external returns (uint256) {
        jusd.approve(address(gateway), amount);
        jusd.approve(address(equity), amount);

        uint256 shares = gateway.invest(amount, 0, frontendCode);
        
        equity.approve(address(gateway), shares);
        uint256 proceeds = gateway.redeem(address(this), shares, 0, frontendCode);

        jusd.transfer(msg.sender, proceeds);
        return proceeds;
    }
}
