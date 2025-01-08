// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IFrontendGateway {
    struct FrontendCode {
        uint256 balance;
        address owner;
    }

    event FrontendCodeRegistered(address owner, bytes32 frontendCode);
    event RateChangesProposed(address who, uint24 nextFeeRate, uint24 nextSavingsFeeRate, uint256 nextChange);
    event RateChangesExecuted(address who, uint24 nextFeeRate, uint24 nextSavingsFeeRate);

    error FrontendCodeAlreadyExists();
    error NotFrontendCodeOwner();
    error NotGatewayService();
    error NoOpenChanges();
    error NotDoneWaiting(uint256 minmumExecutionTime);

    function invest(uint256 amount, uint256 expectedShares, bytes32 frontendCode) external returns (uint256);
    function redeem(address target, uint256 shares, bytes32 frontendCode) external returns (uint256);
    function unwrapAndSell(uint256 amount, bytes32 frontendCode) external returns (uint256);

    function save(address owner, uint192 amount, bytes32 frontendCode) external;
    function withdrawSaving(address target, uint192 amount, bytes32 frontendCode) external returns (uint256);
    function adjustSaving(uint192 targetAmount, bytes32 frontendCode) external;

    function updateSavingRewards(address saver, uint256 interest) external;

    function registerPosition(address position, bytes32 frontendCode) external;
    function updatePositionRewards(address position, uint256 amount) external;

    // Frontend Code Logic
    function registerFrontendCode(bytes32 frontendCode) external returns (bool);
    function transferFrontendCode(bytes32 frontendCode, address to) external returns (bool);
    function withdrawRewards(bytes32 frontendCode) external returns (uint256);
    function withdrawRewardsTo(bytes32 frontendCode, address to) external returns (uint256);

    // Governance
    function proposeChanges(uint24 newFeeRatePPM_, uint24 newSavingsFeeRatePPM_, address[] calldata helpers) external;
    function executeChanges() external;
}
