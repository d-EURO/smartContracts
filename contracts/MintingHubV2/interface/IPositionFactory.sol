// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IPositionFactory {
    function createNewPosition(
        address _owner,
        address _deuro,
        address _collateral,
        uint256 _minCollateral,
        uint256 _initialLimit,
        uint40 _initPeriod,
        uint40 _duration,
        uint40 _challengePeriod,
        uint24 _riskPremiumPPM,
        uint256 _liqPrice,
        uint24 _reserve
    ) external returns (address);

    function clonePosition(address _parent) external returns (address);
}