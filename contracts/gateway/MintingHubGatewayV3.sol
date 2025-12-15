// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {MintingHub} from "../MintingHubV3/MintingHub.sol";
import {IFrontendGateway} from "./interface/IFrontendGateway.sol";
import {IMintingHubGatewayV3} from "./interface/IMintingHubGatewayV3.sol";
import {IMintingHubGateway} from "./interface/IMintingHubGateway.sol";

/**
 * @title MintingHubGatewayV3
 * @notice Extension of MintingHub V3 with frontend code tracking and rewards.
 * @dev Registers positions with the FrontendGateway for reward distribution.
 */
contract MintingHubGatewayV3 is MintingHub, IMintingHubGatewayV3 {
    IFrontendGateway public immutable GATEWAY;

    constructor(
        address _deuro,
        address _leadrate,
        address payable _roller,
        address _factory,
        address _gateway,
        address _weth
    ) MintingHub(_deuro, _leadrate, _roller, _factory, _weth) {
        GATEWAY = IFrontendGateway(_gateway);
    }

    /**
     * @notice Open a new position with frontend code tracking.
     * @dev For native coin positions (WETH), send msg.value equal to _initialCollateral.
     * @param _frontendCode The frontend code for reward attribution
     */
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
    ) public payable returns (address) {
        address position = MintingHub.openPosition(
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

    /**
     * @notice Clones an existing position with frontend code tracking.
     * @dev For native coin positions (WETH), send msg.value equal to _initialCollateral.
     * For ERC20 collateral, ensure prior approval for the minting hub to transfer _initialCollateral.
     * @param _liqPrice Optionally adjust price of new position after minting. Set to 0 to inherit parent's price.
     * @param frontendCode Optionally register the position with a frontend code.
     */
    function clone(
        address owner,
        address parent,
        uint256 _initialCollateral,
        uint256 _initialMint,
        uint40 expiration,
        uint256 _liqPrice,
        bytes32 frontendCode
    ) public payable returns (address) {
        address position = MintingHub.clone(owner, parent, _initialCollateral, _initialMint, expiration, _liqPrice);
        GATEWAY.registerPosition(position, frontendCode);
        return position;
    }

    /**
     * @notice Called by positions when interest is paid to update frontend rewards.
     * @param amount The amount of interest paid
     */
    function notifyInterestPaid(uint256 amount) external validPos(msg.sender) {
        GATEWAY.updatePositionRewards(msg.sender, amount);
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return
            interfaceId == type(IMintingHubGatewayV3).interfaceId ||
            interfaceId == type(IMintingHubGateway).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
