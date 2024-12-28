// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Equity} from "../Equity.sol";
import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {DEPSWrapper} from "../utils/DEPSWrapper.sol";
import {SavingsGateway} from "./SavingsGateway.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";

contract FrontendGateway is Context, Ownable {
    IERC20 public immutable DEURO;
    Equity public immutable EQUITY;
    DEPSWrapper public immutable DEPS;
    SavingsGateway public SAVINGS;

    struct FrontendCode {
        uint256 balance;
        address owner;
    }

    uint8 public feeRate; // Fee rate in PPM (parts per thousand), for example 10 = 1%
    uint8 public savingsFeeRate; // Fee rate of savings in PPM (parts per thousand), for example 10 = 1%
    uint8 public nextFeeRate;
    uint8 public nextSavingsFeeRate;
    uint256 public changeTimeLock;

    mapping(bytes32 => FrontendCode) public frontendCodes;
    mapping(address => bytes32) public lastUsedFrontendCode;

    event FrontendCodeRegistered(address owner, bytes32 frontendCode);
    event RateChangesProposed(address who, uint8 nextFeeRate, uint8 nextSavingsFeeRate, uint256 nextChange);
    event RateChangesExecuted(address who, uint8 nextFeeRate, uint8 nextSavingsFeeRate);

    error FrontendCodeAlreadyExists();
    error NotFrontendCodeOwner();
    error NotSavingsGateway();
    error NoOpenChanges();
    error NotDoneWaiting(uint minmumExecutionTime);

    modifier frontendCodeOwnerOnly(bytes32 frontendCode) {
        if (frontendCodes[frontendCode].owner != _msgSender()) revert NotFrontendCodeOwner();
        _;
    }

    constructor(address deuro_, address deps_) public Ownable(_msgSender()) {
        DEURO = IERC20(deuro_);
        EQUITY = Equity(address(IDecentralizedEURO(deuro_).reserve()));
        DEPS = DEPSWrapper(deps_);
        feeRate = 10; // 10/1000 = 1% fee
        savingsFeeRate = 50; // 10/1000 = 1% fee
    }

    /**
     * @notice Call this a wrapper method to obtain newly minted pool shares in exchange for
     * DecentralizedEUROs and reward frontend providers with a small commission.
     * No allowance required (i.e., it is hard-coded in the DecentralizedEURO token contract).
     * Make sure to invest at least 10e-12 * market cap to avoid rounding losses.
     *
     * @dev If equity is close to zero or negative, you need to send enough dEURO to bring equity back to 1_000 dEURO.
     *
     * @param amount            DecentralizedEUROs to invest
     * @param expectedShares    Minimum amount of expected shares for front running protection
     * @param frontendCode      Code of the used frontend or referrer
     */
    function invest(uint256 amount, uint256 expectedShares, bytes32 frontendCode) external returns (uint256) {
        uint256 actualShares = EQUITY.investFor(_msgSender(), amount, expectedShares);

        updateFrontendAccount(frontendCode, amount);
        return actualShares;
    }

    function redeem(address target, uint256 shares, bytes32 frontendCode) external returns (uint256) {
        uint256 expectedProceeds = EQUITY.calculateProceeds(shares);
        uint256 actualProceeds = EQUITY.redeemFrom(_msgSender(), target, shares, expectedProceeds);

        updateFrontendAccount(frontendCode, actualProceeds);
        return actualProceeds;
    }

    function unwrapAndSell(uint256 amount, bytes32 frontendCode) external returns (uint256) {
        DEPS.transferFrom(_msgSender(), address(this), amount);
        uint256 actualProceeds = DEPS.unwrapAndSell(amount);
        DEURO.transfer(_msgSender(), actualProceeds);

        updateFrontendAccount(frontendCode, actualProceeds);
        return actualProceeds;
    }

    function save(address owner, uint192 amount, bytes32 frontendCode) external {
        lastUsedFrontendCode[_msgSender()] = frontendCode;
        SAVINGS.saveFor(_msgSender(), owner, amount);
    }

    function withdraw(address target, uint192 amount, bytes32 frontendCode) external returns (uint256) {
        lastUsedFrontendCode[_msgSender()] = frontendCode;
        return SAVINGS.withdrawFor(_msgSender(), target, amount);
    }

    function adjust(uint192 targetAmount, bytes32 frontendCode) external {
        lastUsedFrontendCode[_msgSender()] = frontendCode;
        SAVINGS.adjustFor(_msgSender(), targetAmount);
    }

    // ToDo: 2. ClonePosition
    // ToDo: 2.1. Create Position https://etherscan.io/address/0x86db50a14b35f71c2d81a0ae19eb20503587f596#writeContract

    function updateFrontendAccount(bytes32 frontendCode, uint256 amount) internal {
        lastUsedFrontendCode[_msgSender()] = frontendCode;
        frontendCodes[frontendCode].balance += (amount * feeRate) / 1000;
    }

    function updateSaving(address saver, uint256 interest) external {
        if (_msgSender() != address(SAVINGS)) revert NotSavingsGateway();

        frontendCodes[lastUsedFrontendCode[saver]].balance += (interest * savingsFeeRate) / 1000;
    }

    function registerFrontendCode(bytes32 frontendCode) external returns (bool) {
        if (frontendCodes[frontendCode].owner != address(0)) revert FrontendCodeAlreadyExists();
        frontendCodes[frontendCode].owner = _msgSender();
        return true;
    }

    function transferFrontendCode(
        bytes32 frontendCode,
        address to
    ) external frontendCodeOwnerOnly(frontendCode) returns (bool) {
        frontendCodes[frontendCode].owner = to;
        return true;
    }

    function withdrawRewards(bytes32 frontendCode) external frontendCodeOwnerOnly(frontendCode) returns (uint256) {
        return withdrawRewardsTo(frontendCode, _msgSender());
    }

    function withdrawRewardsTo(
        bytes32 frontendCode,
        address to
    ) public frontendCodeOwnerOnly(frontendCode) returns (uint256) {
        uint256 amount = frontendCodes[frontendCode].balance;
        frontendCodes[frontendCode].balance = 0;
        IDecentralizedEURO(address(DEURO)).coverLoss(to, amount);
        return amount;
    }

    /**
     * @notice Proposes new referral rates that will available to be executed after seven days.
     * To cancel a proposal, just overwrite it with a new one proposing the current rate.
     */
    function proposeChanges(uint8 newFeeRatePPM_, uint8 newSavingsFeeRatePPM_, address[] calldata helpers) external {
        EQUITY.checkQualified(_msgSender(), helpers);
        nextFeeRate = newFeeRatePPM_;
        nextSavingsFeeRate = newSavingsFeeRatePPM_;
        changeTimeLock = block.timestamp + 7 days;
        emit RateChangesProposed(_msgSender(), newFeeRatePPM_, newSavingsFeeRatePPM_, 0);
    }

    function executeChanges() external {
        if (nextFeeRate == feeRate && nextSavingsFeeRate == savingsFeeRate) revert NoOpenChanges();
        if (block.timestamp < changeTimeLock) revert NotDoneWaiting(changeTimeLock);
        feeRate = nextFeeRate;
        savingsFeeRate = nextSavingsFeeRate;
        emit RateChangesExecuted(_msgSender(), feeRate, savingsFeeRate);
    }


    function initSavings(address savings) external onlyOwner {
        SAVINGS = SavingsGateway(savings);
        renounceOwnership();
    }
}
