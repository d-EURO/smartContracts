// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {MintingHub} from "../MintingHubV2/MintingHub.sol";
import {IFrontendGateway} from "./interface/IFrontendGateway.sol";
import {IMintingHubGateway} from "./interface/IMintingHubGateway.sol";

contract MintingHubGateway is MintingHub, IMintingHubGateway {
    IFrontendGateway public immutable GATEWAY;

    constructor(
        address _jusd,
        address _leadrate,
        address _roller,
        address _factory,
        address _gateway
    ) MintingHub(_jusd, _leadrate, _roller, _factory) {
        GATEWAY = IFrontendGateway(_gateway);
    }

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
    ) public returns (address) {
        address position = openPosition(
            _collateralAddress,
            _minCollateral,
            _initialCollateral,
            _mintingMaximum,
            _initPeriodSeconds,
            _expirationSeconds,
            _challengeSeconds,
            _riskPremium,
            _liqPrice,
            _reservePPM
        );
        GATEWAY.registerPosition(position, _frontendCode);
        return position;
    }

    function clone(
        address parent,
        uint256 _initialCollateral,
        uint256 _initialMint,
        uint40 expiration,
        bytes32 frontendCode
    ) public returns (address) {
        return clone(msg.sender, parent, _initialCollateral, _initialMint, expiration, frontendCode);
    }

    /**
     * @notice Clones an existing position and immediately tries to mint the specified amount using the given collateral.
     * @dev This needs an allowance to be set on the collateral contract such that the minting hub can get the collateral.
     */
    function clone(
        address owner,
        address parent,
        uint256 _initialCollateral,
        uint256 _initialMint,
        uint40 expiration,
        bytes32 frontendCode
    ) public returns (address) {
        address position = clone(owner, parent, _initialCollateral, _initialMint, expiration);
        GATEWAY.registerPosition(position, frontendCode);
        return position;
    }

    function notifyInterestPaid(uint256 amount) external validPos(msg.sender) {
        GATEWAY.updatePositionRewards(msg.sender, amount);
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IMintingHubGateway).interfaceId || super.supportsInterface(interfaceId);
    }
}
