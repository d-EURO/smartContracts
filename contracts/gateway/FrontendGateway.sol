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

    uint24 public feeRate; // Fee rate in PPM (parts per million), for example 10'000 = 1%
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

        uint256 reward = updateFrontendAccount(frontendCode, amount);
        emit InvestRewardAdded(frontendCode, _msgSender(), amount, reward);
        return actualShares;
    }

    function redeem(
        address target,
        uint256 shares,
        uint256 expectedProceeds,
        bytes32 frontendCode
    ) external returns (uint256) {
        uint256 actualProceeds = EQUITY.redeemFrom(_msgSender(), target, shares, expectedProceeds);

        uint256 reward = updateFrontendAccount(frontendCode, actualProceeds);
        emit RedeemRewardAdded(frontendCode, _msgSender(), actualProceeds, reward);
        return actualProceeds;
    }

    function unwrapAndSell(uint256 amount, bytes32 frontendCode) external returns (uint256) {
        DEPS.transferFrom(_msgSender(), address(this), amount);
        uint256 actualProceeds = DEPS.unwrapAndSell(amount);
        DEURO.transfer(_msgSender(), actualProceeds);

        uint256 reward = updateFrontendAccount(frontendCode, actualProceeds);
        emit UnwrapAndSellRewardAdded(frontendCode, _msgSender(), actualProceeds, reward);
        return actualProceeds;
    }

    ///////////////////
    // Accounting Logic
    ///////////////////

    function updateFrontendAccount(bytes32 frontendCode, uint256 amount) internal returns (uint256) {
        if (frontendCode == bytes32(0)) return 0;
        lastUsedFrontendCode[_msgSender()] = frontendCode;
        uint256 reward = (amount * feeRate) / 1_000_000;
        frontendCodes[frontendCode].balance += reward;
        return reward;
    }

    function updateSavingCode(
        address savingsOwner,
        bytes32 frontendCode
    ) external onlyGatewayService(address(SAVINGS)) {
        if (frontendCode == bytes32(0)) return;
        lastUsedFrontendCode[savingsOwner] = frontendCode;
    }

    function updateSavingRewards(address saver, uint256 interest) external onlyGatewayService(address(SAVINGS)) {
        bytes32 frontendCode = lastUsedFrontendCode[saver];
        if (frontendCode == bytes32(0)) return;

        uint256 reward = (interest * savingsFeeRate) / 1_000_000;
        frontendCodes[frontendCode].balance += reward;

        emit SavingsRewardAdded(frontendCode, saver, interest, reward);
    }

    function registerPosition(
        address position,
        bytes32 frontendCode
    ) external onlyGatewayService(address(MINTING_HUB)) {
        if (frontendCode == bytes32(0)) return;

        referredPositions[position] = frontendCode;
        emit NewPositionRegistered(position, frontendCode);
    }

    function updatePositionRewards(address position, uint256 amount) external onlyGatewayService(address(MINTING_HUB)) {
        bytes32 frontendCode = referredPositions[position];
        if (frontendCode == bytes32(0)) return;
        
        uint256 reward = (amount * mintingFeeRate) / 1_000_000;
        frontendCodes[frontendCode].balance += reward;

        emit PositionRewardAdded(frontendCode, position, amount, reward);
    }

    function getPositionFrontendCode(address position) external view returns (bytes32) {
        return referredPositions[position];
    }

    //////////////////////
    // Frontend Code Logic
    //////////////////////

    function registerFrontendCode(bytes32 frontendCode) external returns (bool) {
        if (frontendCodes[frontendCode].owner != address(0) || frontendCode == bytes32(0))
            revert FrontendCodeAlreadyExists();
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

        if (IDecentralizedEURO(address(DEURO)).equity() < amount) revert EquityTooLow();

        frontendCodes[frontendCode].balance = 0;
        IDecentralizedEURO(address(DEURO)).distributeProfits(to, amount);
        emit FrontendCodeRewardsWithdrawn(to, amount, frontendCode);
        return amount;
    }

    /**
     * @notice Proposes new referral rates that will available to be executed after seven days.
     * To cancel a proposal, just overwrite it with a new one proposing the current rate.
     */
    function proposeChanges(
        uint24 newFeeRatePPM_,
        uint24 newSavingsFeeRatePPM_,
        uint24 newMintingFeeRatePPM_,
        address[] calldata helpers
    ) external {
        if (newFeeRatePPM_ > 20_000 || newSavingsFeeRatePPM_ > 1_000_000 || newMintingFeeRatePPM_ > 1_000_000)
            revert ProposedChangesToHigh();
        EQUITY.checkQualified(_msgSender(), helpers);
        nextFeeRate = newFeeRatePPM_;
        nextSavingsFeeRate = newSavingsFeeRatePPM_;
        nextMintingFeeRate = newMintingFeeRatePPM_;
        changeTimeLock = block.timestamp + 7 days;
        emit RateChangesProposed(
            _msgSender(),
            newFeeRatePPM_,
            newSavingsFeeRatePPM_,
            newMintingFeeRatePPM_,
            changeTimeLock
        );
    }

    function executeChanges() external {
        if (nextFeeRate == feeRate && nextSavingsFeeRate == savingsFeeRate && nextMintingFeeRate == mintingFeeRate)
            revert NoOpenChanges();
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
