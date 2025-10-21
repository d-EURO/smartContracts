// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IFrontendGateway {
    struct FrontendCode {
        uint256 balance;
        address owner;
    }

    event FrontendCodeRegistered(address owner, bytes32 frontendCode);
    event FrontendCodeTransferred(address from, address to, bytes32 frontendCode);
    event FrontendCodeRewardsWithdrawn(address to, uint256 amount, bytes32 frontendCode);
    event NewPositionRegistered(address position, bytes32 frontendCode);
    event RateChangesProposed(address who, uint24 nextFeeRate, uint24 nextSavingsFeeRate, uint24 nextMintingFeeRate, uint256 nextChange);
    event RateChangesExecuted(address who, uint24 nextFeeRate, uint24 nextSavingsFeeRate, uint24 nextMintingFeeRate);
    
    event InvestRewardAdded(bytes32 frontendCode, address user, uint256 amount, uint256 reward);
    event RedeemRewardAdded(bytes32 frontendCode, address user, uint256 amount, uint256 reward);
    event UnwrapAndSellRewardAdded(bytes32 frontendCode, address user, uint256 amount, uint256 reward);
    event SavingsRewardAdded(bytes32 frontendCode, address saver, uint256 interest, uint256 reward);
    event PositionRewardAdded(bytes32 frontendCode, address position, uint256 amount, uint256 reward);

    error FrontendCodeAlreadyExists();
    error NotFrontendCodeOwner();
    error NotGatewayService();
    error ProposedChangesToHigh();
    error NoOpenChanges();
    error NotDoneWaiting(uint256 minmumExecutionTime);
    error EquityTooLow();

    function invest(uint256 amount, uint256 expectedShares, bytes32 frontendCode) external returns (uint256);
    function redeem(address target, uint256 shares, uint256 expectedProceeds, bytes32 frontendCode) external returns (uint256);
    function unwrapAndSell(uint256 amount, bytes32 frontendCode) external returns (uint256);

    function updateSavingCode(address savingsOwner, bytes32 frontendCode) external;
    function updateSavingRewards(address saver, uint256 interest) external;

    function registerPosition(address position, bytes32 frontendCode) external;
    function updatePositionRewards(address position, uint256 amount) external;
    function getPositionFrontendCode(address position)view external  returns(bytes32);

    // Frontend Code Logic
    function registerFrontendCode(bytes32 frontendCode) external returns (bool);
    function transferFrontendCode(bytes32 frontendCode, address to) external returns (bool);
    function withdrawRewards(bytes32 frontendCode) external returns (uint256);
    function withdrawRewardsTo(bytes32 frontendCode, address to) external returns (uint256);

    // Governance
    function proposeChanges(uint24 newFeeRatePPM_, uint24 newSavingsFeeRatePPM_, uint24 newMintingFeeRatePPM_, address[] calldata helpers) external;
    function executeChanges() external;
}
