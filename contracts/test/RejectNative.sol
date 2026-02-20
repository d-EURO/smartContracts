// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMintingHubBid {
    function bid(uint32 _challengeNumber, uint256 size, bool postponeCollateralReturn, bool returnAsNative) external;
    function buyExpiredCollateral(address pos, uint256 upToAmount, bool receiveAsNative) external returns (uint256);
    function returnPostponedCollateral(address collateral, address target, bool asNative) external;
}

/**
 * @title RejectNative
 * @notice Test contract that rejects all native ETH transfers.
 *         Used to test NativeTransferFailed error paths.
 */
contract RejectNative {
    function callBid(address hub, uint32 number, uint256 size) external {
        IMintingHubBid(hub).bid(number, size, false, true);
    }

    function callBuyExpired(address hub, address pos, uint256 amount) external {
        IMintingHubBid(hub).buyExpiredCollateral(pos, amount, true);
    }

    function callReturnPostponed(address hub, address collateralToken, address target) external {
        IMintingHubBid(hub).returnPostponedCollateral(collateralToken, target, true);
    }

    function approve(address token, address spender, uint256 amount) external {
        IERC20(token).approve(spender, amount);
    }

    function transfer(address token, address to, uint256 amount) external {
        IERC20(token).transfer(to, amount);
    }

    // No receive() or fallback — rejects all native transfers
}
