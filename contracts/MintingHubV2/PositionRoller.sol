// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMintingHubGateway} from "../gateway/interface/IMintingHubGateway.sol";
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
 */
contract PositionRoller {
    IDecentralizedEURO private deuro;

    error NotOwner(address pos);
    error NotPosition(address pos);
    error NativeTransferFailed();
    error Log(uint256, uint256, uint256);

    event Roll(address source, uint256 collWithdraw, uint256 repay, address target, uint256 collDeposit, uint256 mint);

    constructor(address deuro_) {
        deuro = IDecentralizedEURO(deuro_);
    }

    /**
     * Convenience method to roll an old position into a new one.
     *
     * Pre-condition: an allowance for the roller to spend the collateral asset on behalf of the caller,
     * i.e., one should set collateral.approve(roller, collateral.balanceOf(sourcePosition)).
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
        (uint256 repay, uint256 collWithdraw, uint256 mint, uint256 collDeposit) =
            _calculateRollParams(source, target, 0);
        roll(source, repay, collWithdraw, target, mint, collDeposit, expiration);
    }

    /**
     * Rolls the source position into the target position using a flash loan.
     * Both the source and the target position must recognize this roller.
     * It is the responsibility of the caller to ensure that both positions are valid contracts.
     *
     * @param source The source position, must be owned by the msg.sender.
     * @param repay The amount of principal to repay from the source position using a flash loan, freeing up some or all collateral .
     * @param collWithdraw Collateral to move from the source position to the msg.sender.
     * @param target The target position. If not owned by msg.sender or if it does not have the desired expiration,
     *               it is cloned to create a position owned by the msg.sender.
     * @param mint The amount to be minted from the target position using collateral from msg.sender.
     * @param collDeposit The amount of collateral to be sent from msg.sender to the target position.
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
            if (Ownable(address(target)).owner() != msg.sender || expiration != target.expiration()) {
                targetCollateral.transferFrom(msg.sender, address(this), collDeposit); // get the new collateral
                targetCollateral.approve(target.hub(), collDeposit); // approve the new collateral and clone:
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
     * Clones the target position and mints the specified amount using the given collateral.
     */
    function _cloneTargetPosition (
        IPosition target,
        IPosition source,
        uint256 collDeposit,
        uint256 mint,
        uint40 expiration
    ) internal returns (IPosition) {
        if (IERC165(target.hub()).supportsInterface(type(IMintingHubGateway).interfaceId)) {
            bytes32 frontendCode = IMintingHubGateway(target.hub()).GATEWAY().getPositionFrontendCode(
                address(source)
            );
            return IPosition(
                IMintingHubGateway(target.hub()).clone(
                    msg.sender,
                    address(target),
                    collDeposit,
                    mint,
                    expiration,
                    frontendCode // use the same frontend code
                )
            );
        } else {
            return IPosition(
                IMintingHub(target.hub()).clone(msg.sender, address(target), collDeposit, mint, expiration)
            );
        }
    }

    /**
     * @notice Roll a position using native coin (ETH) as additional collateral.
     */
    function rollFullyNative(IPosition source, IPosition target) external payable {
        rollFullyNativeWithExpiration(source, target, target.expiration());
    }

    function rollFullyNativeWithExpiration(IPosition source, IPosition target, uint40 expiration) public payable {
        (uint256 repay, uint256 collWithdraw, uint256 mint, uint256 collDeposit) =
            _calculateRollParams(source, target, msg.value);
        rollNative(source, repay, collWithdraw, target, mint, collDeposit, expiration);
    }

    function _calculateRollParams(
        IPosition source,
        IPosition target,
        uint256 extraCollateral
    ) internal view returns (uint256 repay, uint256 collWithdraw, uint256 mint, uint256 collDeposit) {
        require(source.collateral() == target.collateral());
        uint256 _principal = source.principal();
        uint256 _interest = source.getInterest();
        uint256 usableMint = source.getUsableMint(_principal) + _interest;
        mint = target.getMintAmount(usableMint);
        collWithdraw = IERC20(source.collateral()).balanceOf(address(source));
        uint256 totalCollateral = collWithdraw + extraCollateral;
        uint256 targetPrice = target.price();
        collDeposit = (mint * 10 ** 18 + targetPrice - 1) / targetPrice;
        if (collDeposit > totalCollateral) {
            collDeposit = totalCollateral;
            mint = (collDeposit * target.price()) / 10 ** 18;
        }
        repay = _principal + _interest;
    }

    /**
     * @notice Roll with native coin support. Wraps msg.value, withdraws source collateral to the roller,
     * deposits to target, and returns excess as native coin.
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
        IERC20 collateralToken = source.collateral();

        // Wrap any ETH sent as additional collateral
        if (msg.value > 0) {
            IWrappedNative(address(collateralToken)).deposit{value: msg.value}();
        }

        deuro.mint(address(this), repay); // take a flash loan
        uint256 used = source.repay(repay);
        source.withdrawCollateral(address(this), collWithdraw);

        if (mint > 0) {
            IERC20 targetCollateral = IERC20(target.collateral());
            if (Ownable(address(target)).owner() != msg.sender || expiration != target.expiration()) {
                targetCollateral.approve(target.hub(), collDeposit);
                target = _cloneTargetPosition(target, source, collDeposit, mint, expiration);
            } else {
                targetCollateral.transfer(address(target), collDeposit);
                target.mint(msg.sender, mint);
            }
        }

        if (repay > used) {
            deuro.transfer(msg.sender, repay - used);
        }

        deuro.burnFrom(msg.sender, repay); // repay the flash loan

        // Return excess collateral as native coin
        uint256 remaining = collateralToken.balanceOf(address(this));
        if (remaining > 0) {
            IWrappedNative(address(collateralToken)).withdraw(remaining);
            (bool success, ) = msg.sender.call{value: remaining}("");
            if (!success) revert NativeTransferFailed();
        }

        emit Roll(address(source), collWithdraw, repay, address(target), collDeposit, mint);
    }

    /**
     * @dev Required for WETH.withdraw() callbacks and receiving excess native coin.
     */
    receive() external payable {}

    modifier own(IPosition pos) {
        if (Ownable(address(pos)).owner() != msg.sender) revert NotOwner(address(pos));
        _;
    }

    modifier valid(IPosition pos) {
        if (deuro.getPositionParent(address(pos)) == address(0x0)) revert NotPosition(address(pos));
        _;
    }
}
