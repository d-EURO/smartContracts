// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {IReserve} from "../interface/IReserve.sol";

import {IPosition} from "./interface/IPosition.sol";

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
        require(source.collateral() == target.collateral());
        uint256 repay = findRepaymentAmount(source);
        uint256 mintAmount = target.getMintAmount(repay);
        uint256 collateralToWithdraw = IERC20(source.collateral()).balanceOf(address(source));
        uint256 targetPrice = target.price();
        uint256 depositAmount = (mintAmount * 10 ** 18 + targetPrice - 1) / targetPrice; // round up
        if (depositAmount > collateralToWithdraw) {
            depositAmount = collateralToWithdraw;
            mintAmount = (depositAmount * target.price()) / 10 ** 18; // round down, rest will be taken from caller
        }
        roll(source, repay, collateralToWithdraw, target, mintAmount, depositAmount, expiration);
    }

    /**
     * Doing a binary search is not very efficient, but guaranteed to return a valid result without rounding errors.
     * To save gas costs, the frontend can also call this and other methods to calculate the right parameters and
     * then call 'roll' directly.
     *
     * Now that no interest is paid upfront and only accrued over time, the repayment amount to close the position
     * (i.e. minted to 0) is simply minted * (1000000 - reservePPM) / 1000000.
     */
    function findRepaymentAmount(IPosition pos) public view returns (uint256) {
        uint256 minted = pos.minted();
        uint24 reservePPM = pos.reserveContribution();
        if (minted == 0) {
            return 0;
        }
        uint256 repayAmount = (minted * (1000000 - reservePPM)) / 1000000;
        return repayAmount;
    }

    /**
     * Rolls the source position into the target position using a flash loan.
     * Both the source and the target position must recognize this roller.
     * It is the responsibility of the caller to ensure that both positions are valid contracts.
     *
     * @param source The source position, must be owned by the msg.sender.
     * @param repay The amount to flash loan in order to repay the source position and free up some or all collateral.
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
        source.repay(repay);
        source.withdrawCollateral(msg.sender, collWithdraw);
        if (mint > 0) {
            IERC20 targetCollateral = IERC20(target.collateral());
            if (Ownable(address(target)).owner() != msg.sender || expiration != target.expiration()) {
                targetCollateral.transferFrom(msg.sender, address(this), collDeposit); // get the new collateral
                targetCollateral.approve(target.hub(), collDeposit); // approve the new collateral and clone:
                target = IPosition(
                    IMintingHub(target.hub()).clone(msg.sender, address(target), collDeposit, mint, expiration)
                );
            } else {
                targetCollateral.transferFrom(msg.sender, address(target), collDeposit);
                target.mint(msg.sender, mint);
            }
        }
        deuro.burnFrom(msg.sender, repay); // repay the flash loan
        emit Roll(address(source), collWithdraw, repay, address(target), collDeposit, mint);
    }

    modifier own(IPosition pos) {
        if (Ownable(address(pos)).owner() != msg.sender) revert NotOwner(address(pos));
        _;
    }

    modifier valid(IPosition pos) {
        if (deuro.getPositionParent(address(pos)) == address(0x0)) revert NotPosition(address(pos));
        _;
    }
}

interface IMintingHub {
    function clone(
        address owner,
        address parent,
        uint256 _initialCollateral,
        uint256 _initialMint,
        uint40 expiration
    ) external returns (address);
}