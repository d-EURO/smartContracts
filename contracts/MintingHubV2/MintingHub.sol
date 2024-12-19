// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {MathUtil} from "../utils/MathUtil.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {IReserve} from "../interface/IReserve.sol";
import {ILeadrate} from "../interface/ILeadrate.sol";

import {IPosition} from "./interface/IPosition.sol";
import {IPositionFactory} from "./interface/IPositionFactory.sol";
import {PositionRoller} from "./PositionRoller.sol";

/**
 * @title Minting Hub
 * @notice The central hub for creating, cloning, and challenging collateralized DecentralizedEURO positions.
 */
contract MintingHub {
    /**
     * @notice Irrevocable fee in deur when proposing a new position (but not when cloning an existing one).
     */
    uint256 public constant OPENING_FEE = 1000 * 10 ** 18;

    /**
     * @notice The challenger reward in parts per million (ppm)
     */
    uint256 public constant CHALLENGER_REWARD = 20000; // 2%
    uint256 public constant EXPIRED_PRICE_FACTOR = 10;

    IPositionFactory private immutable POSITION_FACTORY;

    IDecentralizedEURO public immutable deur;
    PositionRoller public immutable roller;
    ILeadrate public immutable rate;

    Challenge[] public challenges;

    mapping(address collateral => mapping(address owner => uint256 amount)) public pendingReturns;

    struct Challenge {
        address challenger;
        uint40 start;
        IPosition position;
        uint256 size;
    }

    event PositionOpened(address indexed owner, address indexed position, address original, address collateral);
    event ChallengeStarted(address indexed challenger, address indexed position, uint256 size, uint256 number);
    event ChallengeAverted(address indexed position, uint256 number, uint256 size);
    event ChallengeSucceeded(
        address indexed position,
        uint256 number,
        uint256 bid,
        uint256 acquiredCollateral,
        uint256 challengeSize
    );
    event PostPonedReturn(address collateral, address indexed beneficiary, uint256 amount);
    event ForcedSale(address pos, uint256 amount, uint256 priceE36MinusDecimals);

    error UnexpectedPrice();
    error InvalidPos();
    error IncompatibleCollateral();
    error InsufficientCollateral();

    modifier validPos(address position) {
        if (deur.getPositionParent(position) != address(this)) revert InvalidPos();
        _;
    }

    constructor(address _deur, address _leadrate, address _roller, address _factory) {
        deur = IDecentralizedEURO(_deur);
        rate = ILeadrate(_leadrate);
        POSITION_FACTORY = IPositionFactory(_factory);
        roller = PositionRoller(_roller);
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
        uint24 _reservePPM
    ) public returns (address) {
        require(_riskPremium <= 1000000);
        require(CHALLENGER_REWARD <= _reservePPM && _reservePPM <= 1000000);
        require(IERC20Metadata(_collateralAddress).decimals() <= 24);
        {
            uint256 invalidAmount = IERC20(_collateralAddress).totalSupply() + 1;
            try IERC20(_collateralAddress).transfer(address(0x123), invalidAmount) {
                revert IncompatibleCollateral();
            } catch {} 
            if (_initialCollateral < _minCollateral) revert InsufficientCollateral();
            if (_minCollateral * _liqPrice < 5000 ether * 10 ** 18) revert InsufficientCollateral();
        }
        IPosition pos = IPosition(
            POSITION_FACTORY.createNewPosition(
                msg.sender,
                address(deur),
                _collateralAddress,
                _minCollateral,
                _mintingMaximum,
                _initPeriodSeconds,
                _expirationSeconds,
                _challengeSeconds,
                _riskPremium,
                _liqPrice,
                _reservePPM
            )
        );
        deur.registerPosition(address(pos));
        deur.collectProfits(msg.sender, OPENING_FEE);
        IERC20(_collateralAddress).transferFrom(msg.sender, address(pos), _initialCollateral);

        emit PositionOpened(msg.sender, address(pos), address(pos), _collateralAddress);
        return address(pos);
    }

    function clone(
        address parent,
        uint256 _initialCollateral,
        uint256 _initialMint,
        uint40 expiration
    ) public returns (address) {
        return clone(msg.sender, parent, _initialCollateral, _initialMint, expiration);
    }

    function clone(
        address owner,
        address parent,
        uint256 _initialCollateral,
        uint256 _initialMint,
        uint40 expiration
    ) public validPos(parent) returns (address) {
        address pos = POSITION_FACTORY.clonePosition(parent);
        IPosition child = IPosition(pos);
        child.initialize(parent, expiration);
        deur.registerPosition(pos);
        IERC20 collateral = child.collateral();
        if (_initialCollateral < child.minimumCollateral()) revert InsufficientCollateral();
        collateral.transferFrom(msg.sender, pos, _initialCollateral);
        emit PositionOpened(owner, address(pos), parent, address(collateral));
        child.mint(owner, _initialMint);
        Ownable(address(child)).transferOwnership(owner);
        return address(pos);
    }

    function challenge(
        address _positionAddr,
        uint256 _collateralAmount,
        uint256 minimumPrice
    ) external validPos(_positionAddr) returns (uint256) {
        IPosition position = IPosition(_positionAddr);
        if (position.price() < minimumPrice) revert UnexpectedPrice();
        IERC20(position.collateral()).transferFrom(msg.sender, address(this), _collateralAmount);
        uint256 pos = challenges.length;
        challenges.push(Challenge(msg.sender, uint40(block.timestamp), position, _collateralAmount));
        position.notifyChallengeStarted(_collateralAmount);
        emit ChallengeStarted(msg.sender, address(position), _collateralAmount, pos);
        return pos;
    }

    function bid(uint32 _challengeNumber, uint256 size, bool postponeCollateralReturn) external {
        Challenge memory _challenge = challenges[_challengeNumber];
        (uint256 liqPrice, uint40 phase) = _challenge.position.challengeData();
        size = _challenge.size < size ? _challenge.size : size;

        if (block.timestamp <= _challenge.start + phase) {
            _avertChallenge(_challenge, _challengeNumber, liqPrice, size);
            emit ChallengeAverted(address(_challenge.position), _challengeNumber, size);
        } else {
            _returnChallengerCollateral(_challenge, _challengeNumber, size, postponeCollateralReturn);
            (uint256 transferredCollateral, uint256 offer) = _finishChallenge(_challenge, liqPrice, phase, size);
            emit ChallengeSucceeded(address(_challenge.position), _challengeNumber, offer, transferredCollateral, size);
        }
    }

    function _finishChallenge(
        Challenge memory _challenge,
        uint256 liqPrice,
        uint40 phase,
        uint256 size
    ) internal returns (uint256, uint256) {
        (address owner, uint256 collateral, uint256 repayment, uint32 reservePPM) = _challenge
            .position
            .notifyChallengeSucceeded(msg.sender, size);

        uint256 offer = (_calculatePrice(_challenge.start + phase, phase, liqPrice) * collateral) / 10 ** 18;
        deur.transferFrom(msg.sender, address(this), offer);
        uint256 reward = (offer * CHALLENGER_REWARD) / 1000_000;
        deur.transfer(_challenge.challenger, reward);
        uint256 fundsAvailable = offer - reward;

        if (fundsAvailable > repayment) {
            uint256 profits = (reservePPM * (fundsAvailable - repayment)) / 1000_000;
            deur.collectProfits(address(this), profits);
            deur.transfer(owner, fundsAvailable - repayment - profits);
        } else if (fundsAvailable < repayment) {
            deur.coverLoss(address(this), repayment - fundsAvailable);
        }
        deur.burnWithoutReserve(repayment, reservePPM);
        return (collateral, offer);
    }

    function _avertChallenge(Challenge memory _challenge, uint32 number, uint256 liqPrice, uint256 size) internal {
        require(block.timestamp != _challenge.start);
        if (msg.sender == _challenge.challenger) {
        } else {
            deur.transferFrom(msg.sender, _challenge.challenger, (size * liqPrice) / (10 ** 18));
        }

        _challenge.position.notifyChallengeAverted(size);
        _challenge.position.collateral().transfer(msg.sender, size);
        if (size < _challenge.size) {
            challenges[number].size = _challenge.size - size;
        } else {
            require(size == _challenge.size);
            delete challenges[number];
        }
    }

    function _returnChallengerCollateral(
        Challenge memory _challenge,
        uint32 number,
        uint256 amount,
        bool postpone
    ) internal {
        _returnCollateral(_challenge.position.collateral(), _challenge.challenger, amount, postpone);
        if (_challenge.size == amount) {
            delete challenges[number];
        } else {
            challenges[number].size -= amount;
        }
    }

    function _calculatePrice(uint40 start, uint40 phase2, uint256 liqPrice) internal view returns (uint256) {
        uint40 timeNow = uint40(block.timestamp);
        if (timeNow <= start) {
            return liqPrice;
        } else if (timeNow >= start + phase2) {
            return 0;
        } else {
            uint256 timeLeft = phase2 - (timeNow - start);
            return (liqPrice / phase2) * timeLeft;
        }
    }

    function price(uint32 challengeNumber) public view returns (uint256) {
        Challenge memory _challenge = challenges[challengeNumber];
        if (_challenge.challenger == address(0x0)) {
            return 0;
        } else {
            (uint256 liqPrice, uint40 phase) = _challenge.position.challengeData();
            return _calculatePrice(_challenge.start + phase, phase, liqPrice);
        }
    }

    function returnPostponedCollateral(address collateral, address target) external {
        uint256 amount = pendingReturns[collateral][msg.sender];
        delete pendingReturns[collateral][msg.sender];
        IERC20(collateral).transfer(target, amount);
    }

    function _returnCollateral(IERC20 collateral, address recipient, uint256 amount, bool postpone) internal {
        if (postpone) {
            pendingReturns[address(collateral)][recipient] += amount;
            emit PostPonedReturn(address(collateral), recipient, amount);
        } else {
            collateral.transfer(recipient, amount);
        }
    }

    function expiredPurchasePrice(IPosition pos) public view returns (uint256) {
        uint256 liqprice = pos.price();
        uint256 expiration = pos.expiration();
        if (block.timestamp <= expiration) {
            return EXPIRED_PRICE_FACTOR * liqprice;
        } else {
            uint256 challengePeriod = pos.challengePeriod();
            uint256 timePassed = block.timestamp - expiration;
            if (timePassed <= challengePeriod) {
                uint256 timeLeft = challengePeriod - timePassed;
                return liqprice + (((EXPIRED_PRICE_FACTOR - 1) * liqprice) / challengePeriod) * timeLeft;
            } else if (timePassed < 2 * challengePeriod) {
                uint256 timeLeft = 2 * challengePeriod - timePassed;
                return (liqprice / challengePeriod) * timeLeft;
            } else {
                return 0;
            }
        }
    }

    function buyExpiredCollateral(IPosition pos, uint256 upToAmount) external returns (uint256) {
        uint256 max = pos.collateral().balanceOf(address(pos));
        uint256 amount = upToAmount > max ? max : upToAmount;
        uint256 forceSalePrice = expiredPurchasePrice(pos);
        uint256 costs = (forceSalePrice * amount) / 10 ** 18;
        pos.forceSale(msg.sender, amount, costs);
        emit ForcedSale(address(pos), amount, forceSalePrice);
        return amount;
    }
}