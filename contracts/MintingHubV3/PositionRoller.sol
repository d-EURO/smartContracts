// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMintingHubGateway} from "../gateway/interface/IMintingHubGateway.sol";
import {IMintingHubGatewayV3} from "../gateway/interface/IMintingHubGatewayV3.sol";
import {IMintingHub} from "./interface/IMintingHub.sol";
import {IPosition} from "./interface/IPosition.sol";
import {IReserve} from "../interface/IReserve.sol";
import {IWrappedNative} from "../interface/IWrappedNative.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PositionRoller
 *
 * Helper to roll over a debt from an old position to a new one.
 * Both positions should have the same collateral. Otherwise, it does not make much sense.
 *
 * For standard ERC20 positions, use roll/rollFully/rollFullyWithExpiration.
 * Collateral flows through the user's wallet and requires approval.
 *
 * For native coin positions (e.g., WETH), use rollNative/rollFullyNative/rollFullyNativeWithExpiration.
 * Collateral flows through the roller, no approval needed, and excess is returned as native coin.
 */
contract PositionRoller {
    IDecentralizedEURO private deuro;

    error NotOwner(address pos);
    error NotPosition(address pos);
    error NativeTransferFailed();

    event Roll(address source, uint256 collWithdraw, uint256 repay, address target, uint256 collDeposit, uint256 mint);

    constructor(address deuro_) {
        deuro = IDecentralizedEURO(deuro_);
    }

    /**
     * Convenience method to roll an old position into a new one.
     *
     * Pre-condition: an allowance for the roller to spend the collateral asset
     * on behalf of the caller, i.e., collateral.approve(roller, collateral.balanceOf(sourcePosition)).
     *
     * The following is assumed:
     * - If the limit of the target position permits, the user wants to roll everything.
     * - The user does not want to add additional collateral, but excess collateral is returned.
     * - If not enough can be minted in the new position, it is acceptable for the roller to use dEURO from the msg.sender.
     */
    function rollFully(IPosition source, IPosition target) external {
        rollFullyWithExpiration(source, target, target.expiration());
    }

    /**
     * Like rollFully, but with a custom expiration date for the new position.
     */
    function rollFullyWithExpiration(IPosition source, IPosition target, uint40 expiration) public {
        require(source.collateral() == target.collateral());
        (uint256 repay, uint256 collWithdraw, uint256 mint, uint256 collDeposit) = _calculateRollParams(
            source,
            target,
            0
        );
        roll(source, repay, collWithdraw, target, mint, collDeposit, expiration);
    }

    /**
     * Rolls the source position into the target position using a flash loan.
     * Both the source and the target position must recognize this roller.
     * It is the responsibility of the caller to ensure that both positions are valid contracts.
     *
     * @param source The source position, must be owned by the msg.sender.
     * @param repay The amount of principal to repay from the source position using a flash loan.
     * @param collWithdraw Collateral to withdraw from the source position.
     * @param target The target position. If not owned by msg.sender or if it does not have the desired expiration,
     *               it is cloned to create a position owned by the msg.sender.
     * @param mint The amount to be minted from the target position.
     * @param collDeposit The amount of collateral to deposit into the target position.
     * @param expiration The desired expiration date for the target position.
     */
    function roll(
        IPosition source,
        uint256 repay,
        uint256 collWithdraw,
        IPosition target,
        uint256 mint,
        uint256 collDeposit,
        uint40 expiration
    ) public valid(source) valid(target) own(source) {
        deuro.mint(address(this), repay); // take a flash loan
        uint256 used = source.repay(repay);
        source.withdrawCollateral(msg.sender, collWithdraw);
        if (mint > 0) {
            IERC20 targetCollateral = IERC20(target.collateral());
            bool needsClone = Ownable(address(target)).owner() != msg.sender || expiration != target.expiration();
            if (needsClone) {
                targetCollateral.transferFrom(msg.sender, address(this), collDeposit);
                targetCollateral.approve(target.hub(), collDeposit);
                target = _cloneTargetPosition(target, source, collDeposit, mint, expiration);
            } else {
                // We can roll into the provided existing position.
                // We do not verify whether the target position was created by the known minting hub in order
                // to allow positions to be rolled into future versions of the minting hub.
                targetCollateral.transferFrom(msg.sender, address(target), collDeposit);
                target.mint(msg.sender, mint);
            }
        }

        // Transfer remaining flash loan to caller for repayment
        if (repay > used) {
            deuro.transfer(msg.sender, repay - used);
        }

        deuro.burnFrom(msg.sender, repay); // repay the flash loan
        emit Roll(address(source), collWithdraw, repay, address(target), collDeposit, mint);
    }

    /**
     * Convenience method to roll a native coin position into a new one.
     *
     * No collateral approval is needed - collateral flows through the roller
     * and excess is returned as native coin.
     *
     * Additional collateral can be provided via msg.value.
     */
    function rollFullyNative(IPosition source, IPosition target) external payable {
        rollFullyNativeWithExpiration(source, target, target.expiration());
    }

    /**
     * Like rollFullyNative, but with a custom expiration date for the new position.
     */
    function rollFullyNativeWithExpiration(IPosition source, IPosition target, uint40 expiration) public payable {
        require(source.collateral() == target.collateral());
        (uint256 repay, uint256 collWithdraw, uint256 mint, uint256 collDeposit) = _calculateRollParams(
            source,
            target,
            msg.value
        );
        rollNative(source, repay, collWithdraw, target, mint, collDeposit, expiration);
    }

    /**
     * Rolls a native coin position into the target position using a flash loan.
     * Collateral is routed through the roller and returned as native coin,
     * eliminating the need for users to interact with wrapped native tokens directly.
     *
     * If additional collateral is needed (collDeposit > collWithdraw), it can be provided
     * as native coin via msg.value.
     *
     * @param source The source position, must be owned by the msg.sender.
     * @param repay The amount of principal to repay from the source position using a flash loan.
     * @param collWithdraw Collateral to withdraw from the source position.
     * @param target The target position. If not owned by msg.sender or if it does not have the desired expiration,
     *               it is cloned to create a position owned by the msg.sender.
     * @param mint The amount to be minted from the target position.
     * @param collDeposit The amount of collateral to deposit into the target position.
     * @param expiration The desired expiration date for the target position.
     */
    function rollNative(
        IPosition source,
        uint256 repay,
        uint256 collWithdraw,
        IPosition target,
        uint256 mint,
        uint256 collDeposit,
        uint40 expiration
    ) public payable valid(source) valid(target) own(source) {
        address collateral = address(source.collateral());

        deuro.mint(address(this), repay); // take a flash loan
        uint256 used = source.repay(repay);
        source.withdrawCollateral(address(this), collWithdraw);
        if (msg.value > 0) {
            IWrappedNative(collateral).deposit{value: msg.value}();
        }

        if (mint > 0) {
            IERC20 targetCollateral = IERC20(collateral);
            bool needsClone = Ownable(address(target)).owner() != msg.sender || expiration != target.expiration();
            if (needsClone) {
                targetCollateral.approve(target.hub(), collDeposit);
                target = _cloneTargetPosition(target, source, collDeposit, mint, expiration);
            } else {
                targetCollateral.transfer(address(target), collDeposit);
                target.mint(msg.sender, mint);
            }
        }

        // Transfer remaining flash loan to caller for repayment
        if (repay > used) {
            deuro.transfer(msg.sender, repay - used);
        }
        deuro.burnFrom(msg.sender, repay); // repay the flash loan

        // Return excess as native coin
        uint256 remaining = IERC20(collateral).balanceOf(address(this));
        if (remaining > 0) {
            IWrappedNative(collateral).withdraw(remaining);
            (bool success, ) = msg.sender.call{value: remaining}("");
            if (!success) revert NativeTransferFailed();
        }

        emit Roll(address(source), collWithdraw, repay, address(target), collDeposit, mint);
    }

    /**
     * Calculates the parameters for a roll operation.
     * @param extraCollateral Additional collateral provided via msg.value (for native rolls).
     */
    function _calculateRollParams(
        IPosition source,
        IPosition target,
        uint256 extraCollateral
    ) internal view returns (uint256 repay, uint256 collWithdraw, uint256 mint, uint256 collDeposit) {
        uint256 principal = source.principal();
        uint256 interest = source.getInterest();
        uint256 usableMint = source.getUsableMint(principal) + interest;
        uint256 mintAmount = target.getMintAmount(usableMint);
        uint256 collateralAvailable = IERC20(source.collateral()).balanceOf(address(source));
        uint256 totalAvailable = collateralAvailable + extraCollateral;
        uint256 targetPrice = target.price();
        uint256 depositAmount = (mintAmount * 10 ** 18 + targetPrice - 1) / targetPrice;

        if (depositAmount > totalAvailable) {
            depositAmount = totalAvailable;
            mintAmount = (depositAmount * target.price()) / 10 ** 18;
        }

        return (principal + interest, collateralAvailable, mintAmount, depositAmount);
    }

    /**
     * Clones the target position and mints the specified amount using the given collateral.
     */
    function _cloneTargetPosition(
        IPosition target,
        IPosition source,
        uint256 collDeposit,
        uint256 mint,
        uint40 expiration
    ) internal returns (IPosition) {
        // Check for V3 Gateway first (has _liqPrice parameter)
        if (IERC165(target.hub()).supportsInterface(type(IMintingHubGatewayV3).interfaceId)) {
            bytes32 frontendCode = IMintingHubGatewayV3(target.hub()).GATEWAY().getPositionFrontendCode(address(source));
            return
                IPosition(
                    IMintingHubGatewayV3(target.hub()).clone(
                        msg.sender,
                        address(target),
                        collDeposit,
                        mint,
                        expiration,
                        0, // inherit price from parent
                        frontendCode // use the same frontend code
                    )
                );
        } else {
            return
                IPosition(
                    IMintingHub(target.hub()).clone(msg.sender, address(target), collDeposit, mint, expiration, 0)
                );
        }
    }

    modifier own(IPosition pos) {
        if (Ownable(address(pos)).owner() != msg.sender) revert NotOwner(address(pos));
        _;
    }

    modifier valid(IPosition pos) {
        if (deuro.getPositionParent(address(pos)) == address(0x0)) revert NotPosition(address(pos));
        _;
    }

    /// @notice Required to receive native coin when unwrapping
    receive() external payable {}
}
