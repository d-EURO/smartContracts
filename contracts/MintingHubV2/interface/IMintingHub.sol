// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {ILeadrate} from "../../interface/ILeadrate.sol";
import {IPosition} from "./IPosition.sol";
import {PositionRoller} from "../PositionRoller.sol";

interface IMintingHub {
    function RATE() external view returns (ILeadrate);

    function ROLLER() external view returns (PositionRoller);

    function challenge(
        address _positionAddr,
        uint256 _collateralAmount,
        uint256 minimumPrice
    ) external returns (uint256);

    function bid(uint32 _challengeNumber, uint256 size, bool postponeCollateralReturn, uint256 maxInterest) external;

    function returnPostponedCollateral(address collateral, address target) external;

    function buyExpiredCollateral(IPosition pos, uint256 upToAmount) external returns (uint256);
}
