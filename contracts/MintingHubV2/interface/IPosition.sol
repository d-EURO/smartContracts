// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPosition {
    function hub() external view returns (address);

    function collateral() external view returns (IERC20);

    function minimumCollateral() external view returns (uint256);

    function price() external view returns (uint256);

    function virtualPrice() external view returns (uint256);

    function challengedAmount() external view returns (uint256);

    function original() external view returns (address);

    function expiration() external view returns (uint40);

    function cooldown() external view returns (uint40);

    function limit() external view returns (uint256);

    function challengePeriod() external view returns (uint40);

    function start() external view returns (uint40);

    function riskPremiumPPM() external view returns (uint24);

    function reserveContribution() external view returns (uint24);

    function principal() external view returns (uint256);

    function interest() external view returns (uint256);

    function lastAccrual() external view returns (uint40);

    function initialize(address parent, uint40 _expiration) external;

    function assertCloneable() external;

    function notifyMint(uint256 mint_) external;

    function notifyRepaid(uint256 repaid_) external;

    function availableForClones() external view returns (uint256);

    function availableForMinting() external view returns (uint256);

    function deny(address[] calldata helpers, string calldata message) external;

    function getUsableMint(uint256 totalMint) external view returns (uint256);

    function getMintAmount(uint256 usableMint) external view returns (uint256);

    function adjust(uint256 newMinted, uint256 newCollateral, uint256 newPrice) external;

    function adjustPrice(uint256 newPrice) external;

    function mint(address target, uint256 amount) external;

    function getDebt() external view returns (uint256);

    function getInterest() external view returns (uint256);

    function repay(uint256 amount) external returns (uint256);

    function repayFull() external returns (uint256);

    function forceSale(address buyer, uint256 colAmount, uint256 proceeds) external;

    function withdraw(address token, address target, uint256 amount) external;

    function withdrawCollateral(address target, uint256 amount) external;

    function transferChallengedCollateral(address target, uint256 amount) external;

    function challengeData() external view returns (uint256 liqPrice, uint40 phase);

    function notifyChallengeStarted(uint256 size, uint256 _price) external;

    function notifyChallengeAverted(uint256 size) external;

    function notifyChallengeSucceeded(
        uint256 _size
    ) external returns (address, uint256, uint256, uint256, uint32);
}
