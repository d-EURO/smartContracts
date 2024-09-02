// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./IERC20.sol";
import "./IReserve.sol";
import "./IFrankencoin.sol";

interface IPosition {

    function original() external view returns (address);

    function collateral() external view returns (IERC20);

    function minimumCollateral() external view returns (uint256);

    function challengePeriod() external view returns (uint40);

    function expiration() external view returns (uint40);

    function price() external view returns (uint256);

    function assertCloneable() external;

    function initializeClone(address owner, uint256 _price, uint256 _coll, uint256 _mint, uint40 expiration) external;

    function deny(address[] calldata helpers, string calldata message) external;

    function mint(address target, uint256 amount) external;

    function repay(uint256 amount) external returns (uint256);

    function minted() external view returns (uint256);

    function availableForMinting() external returns (uint256);

    function reserveContribution() external returns (uint24);

    function withdrawCollateral(address target, uint256 amount) external;

    function getUsableMint(uint256 totalMint, bool beforeFees) external view returns (uint256);

    function challengeData() external view returns (uint256 liqPrice, uint40 phase);

    function notifyChallengeStarted(uint256 size) external;

    function notifyChallengeAverted(uint256 size) external;

    function notifyChallengeSucceeded(address _bidder, uint256 _size) external returns (address, uint256, uint256, uint32);

    function forceSale(address buyer, uint256 collAmount, uint256 proceeds) external;

}