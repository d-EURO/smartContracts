// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {ILeadrate} from "../../interface/ILeadrate.sol";
import {IPosition} from "./IPosition.sol";
import {PositionRoller} from "../PositionRoller.sol";

interface IMintingHub {
    event PositionUpdate(address indexed position, uint256 collateral, uint256 price, uint256 principal);
    event PositionDeniedByGovernance(address indexed position, address indexed denier, string message);

    function RATE() external view returns (ILeadrate);

    function ROLLER() external view returns (PositionRoller);

    function challenge(
        address _positionAddr,
        uint256 _collateralAmount,
        uint256 minimumPrice
    ) external returns (uint256);

    function bid(uint32 _challengeNumber, uint256 size, bool postponeCollateralReturn) external;

    function returnPostponedCollateral(address collateral, address target) external;

    function buyExpiredCollateral(IPosition pos, uint256 upToAmount) external returns (uint256);

    function clone(address owner, address parent, uint256 _initialCollateral, uint256 _initialMint, uint40 expiration) external returns (address);

    function emitPositionUpdate(uint256 _collateral, uint256 _price, uint256 _principal) external;

    function emitPositionDenied(address denier, string calldata message) external;
}
