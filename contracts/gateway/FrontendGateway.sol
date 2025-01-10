// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Equity} from "../Equity.sol";
import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {DEPSWrapper} from "../utils/DEPSWrapper.sol";
import {SavingsGateway} from "./SavingsGateway.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {IFrontendGateway} from "./interface/IFrontendGateway.sol";
import {IMintingHubGateway} from "./interface/IMintingHubGateway.sol";

contract FrontendGateway is IFrontendGateway, Context, Ownable {
    IERC20 public immutable DEURO;
    Equity public immutable EQUITY;
    DEPSWrapper public immutable DEPS;

    // solhint-disable-next-line var-name-mixedcase
    IMintingHubGateway public MINTING_HUB;

    // solhint-disable-next-line var-name-mixedcase
    SavingsGateway public SAVINGS;

    uint24 public feeRate; // Fee rate in PPM (parts per million), for example 10 = 1%
    uint24 public savingsFeeRate; // Fee rate of savings in PPM (parts per million), for example 10 = 1%
    uint24 public mintingFeeRate; // Reward rate of newly minted positions in PPM (parts per million), for example 10 = 1%
    uint24 public nextFeeRate;
    uint24 public nextSavingsFeeRate;
    uint24 public nextMintingFeeRate;
    uint256 public changeTimeLock;

    mapping(bytes32 => FrontendCode) public frontendCodes;
    mapping(address => bytes32) public referredPositions;
    mapping(address => bytes32) public lastUsedFrontendCode;

    modifier frontendCodeOwnerOnly(bytes32 frontendCode) {
        if (frontendCodes[frontendCode].owner != _msgSender()) revert NotFrontendCodeOwner();
        _;
    }

    modifier onlyGatewayService(address service) {
        if (_msgSender() != address(service)) revert NotGatewayService();
        _;
    }

    constructor(address deuro_, address deps_) Ownable(_msgSender()) {
        DEURO = IERC20(deuro_);
        EQUITY = Equity(address(IDecentralizedEURO(deuro_).reserve()));
        DEPS = DEPSWrapper(deps_);
        feeRate = 10_000; // 10_000/1_000_000 = 1% fee
        savingsFeeRate = 50_000; // 50_000/1_000_000 = 5% fee of the of the savings interest
        mintingFeeRate = 50_000; // 50_000/1_000_000 = 5% fee of the of the interest paid by the position owner
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

    function withdrawSaving(address target, uint192 amount, bytes32 frontendCode) external returns (uint256) {
        lastUsedFrontendCode[_msgSender()] = frontendCode;
        return SAVINGS.withdrawFor(_msgSender(), target, amount);
    }

    function adjustSaving(uint192 targetAmount, bytes32 frontendCode) external {
        lastUsedFrontendCode[_msgSender()] = frontendCode;
        SAVINGS.adjustFor(_msgSender(), targetAmount);
    }

    ///////////////////
    // Accounting Logic
    ///////////////////

    function updateFrontendAccount(bytes32 frontendCode, uint256 amount) internal {
        lastUsedFrontendCode[_msgSender()] = frontendCode;
        frontendCodes[frontendCode].balance += (amount * feeRate) / 1_000_000;
    }

    function updateSavingRewards(address saver, uint256 interest) external onlyGatewayService(address(SAVINGS)) {
        frontendCodes[lastUsedFrontendCode[saver]].balance += (interest * savingsFeeRate) / 1_000_000;
    }

    function registerPosition(
        address position,
        bytes32 frontendCode
    ) external onlyGatewayService(address(MINTING_HUB)) {
        referredPositions[position] = frontendCode;
    }

    function updatePositionRewards(address position, uint256 amount) external onlyGatewayService(address(MINTING_HUB)) {
        frontendCodes[referredPositions[position]].balance += (amount * mintingFeeRate) / 1_000_000;
    }

    //////////////////////
    // Frontend Code Logic
    //////////////////////

    function registerFrontendCode(bytes32 frontendCode) external returns (bool) {
        if (frontendCodes[frontendCode].owner != address(0)) revert FrontendCodeAlreadyExists();
        frontendCodes[frontendCode].owner = _msgSender();
        emit FrontendCodeRegistered(_msgSender(), frontendCode);
        return true;
    }

    function transferFrontendCode(
        bytes32 frontendCode,
        address to
    ) external frontendCodeOwnerOnly(frontendCode) returns (bool) {
        frontendCodes[frontendCode].owner = to;
        emit FrontendCodeTransferred(_msgSender(), to, frontendCode);
        return true;
    }

    function withdrawRewards(bytes32 frontendCode) external frontendCodeOwnerOnly(frontendCode) returns (uint256) {
        return _withdrawRewardsTo(frontendCode, _msgSender());
    }

    function withdrawRewardsTo(
        bytes32 frontendCode,
        address to
    ) external frontendCodeOwnerOnly(frontendCode) returns (uint256) {
        return _withdrawRewardsTo(frontendCode, to);
    }

    function _withdrawRewardsTo(bytes32 frontendCode, address to) internal returns (uint256) {
        uint256 amount = frontendCodes[frontendCode].balance;
        frontendCodes[frontendCode].balance = 0;
        IDecentralizedEURO(address(DEURO)).coverLoss(to, amount);
        emit FrontendCodeRewardsWithdrawn(to, amount, frontendCode);
        return amount;
    }

    /**
     * @notice Proposes new referral rates that will available to be executed after seven days.
     * To cancel a proposal, just overwrite it with a new one proposing the current rate.
     */
    function proposeChanges(uint24 newFeeRatePPM_, uint24 newSavingsFeeRatePPM_, uint24 newMintingFeeRatePPM_, address[] calldata helpers) external {
        EQUITY.checkQualified(_msgSender(), helpers);
        nextFeeRate = newFeeRatePPM_;
        nextSavingsFeeRate = newSavingsFeeRatePPM_;
        nextMintingFeeRate = newMintingFeeRatePPM_;
        changeTimeLock = block.timestamp + 7 days;
        emit RateChangesProposed(_msgSender(), newFeeRatePPM_, newSavingsFeeRatePPM_, newMintingFeeRatePPM_, changeTimeLock);
    }

    function executeChanges() external {
        if (nextFeeRate == feeRate && nextSavingsFeeRate == savingsFeeRate && nextMintingFeeRate == mintingFeeRate) revert NoOpenChanges();
        if (block.timestamp < changeTimeLock) revert NotDoneWaiting(changeTimeLock);
        feeRate = nextFeeRate;
        savingsFeeRate = nextSavingsFeeRate;
        mintingFeeRate = nextMintingFeeRate;
        emit RateChangesExecuted(_msgSender(), feeRate, savingsFeeRate, mintingFeeRate);
    }

    function init(address savings, address mintingHub) external onlyOwner {
        SAVINGS = SavingsGateway(savings);
        MINTING_HUB = IMintingHubGateway(mintingHub);
        renounceOwnership();
    }
}
