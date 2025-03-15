// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.10;

import {IMintingHub} from "../../MintingHubV2/interface/IMintingHub.sol";
import {IFrontendGateway} from "./IFrontendGateway.sol";

interface IMintingHubGateway {
    function GATEWAY() external view returns (IFrontendGateway);
    function notifyInterestPaid(uint256 amount) external;
    function openPosition(address _collateralAddress, uint256 _minCollateral, uint256 _initialCollateral, uint256 _mintingMaximum, uint40 _initPeriodSeconds, uint40 _expirationSeconds, uint40 _challengeSeconds, uint24 _riskPremium, uint256 _liqPrice, uint24 _reservePPM, bytes32 _frontendCode) external returns (address);
    function clone(address owner, address parent, uint256 _initialCollateral, uint256 _initialMint, uint40 expiration, bytes32 frontendCode) external returns (address);
}
