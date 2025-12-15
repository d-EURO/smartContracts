// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IMintingHub} from "../../MintingHubV3/interface/IMintingHub.sol";
import {IFrontendGateway} from "./IFrontendGateway.sol";

interface IMintingHubGatewayV3 {
    function GATEWAY() external view returns (IFrontendGateway);
    function notifyInterestPaid(uint256 amount) external;
    function openPosition(
        address _collateralAddress,
        uint256 _minCollateral,
        uint256 _initialCollateral,
        uint256 _mintingMaximum,
        uint40 _initPeriodSeconds,
        uint40 _expirationSeconds,
        uint40 _challengeSeconds,
        uint24 _riskPremium,
        uint256 _liqPrice,
        uint24 _reservePPM,
        bytes32 _frontendCode
    ) external payable returns (address);
    function clone(
        address owner,
        address parent,
        uint256 _initialCollateral,
        uint256 _initialMint,
        uint40 expiration,
        uint256 _liqPrice,
        bytes32 frontendCode
    ) external payable returns (address);
}
