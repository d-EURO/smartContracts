// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IWrappedNative} from "../interface/IWrappedNative.sol";
import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ILeadrate} from "../interface/ILeadrate.sol";
import {IMintingHub} from "./interface/IMintingHub.sol";
import {IPositionFactory} from "./interface/IPositionFactory.sol";
import {IPosition} from "./interface/IPosition.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PositionRoller} from "./PositionRoller.sol";

/**
 * @title Minting Hub V3
 * @notice The central hub for creating, cloning, and challenging collateralized dEURO positions.
 * @dev Only one instance of this contract is required, whereas every new position comes with a new position
 * contract. Pending challenges are stored as structs in an array.
 */
contract MintingHub is IMintingHub, ERC165 {
    /**
     * @notice Irrevocable fee in dEURO when proposing a new position (but not when cloning an existing one).
     */
    uint256 public constant OPENING_FEE = 1000 * 10 ** 18;

    /**
     * @notice The challenger reward in parts per million (ppm) relative to the challenged amount, whereas
     * challenged amount is defined as the challenged collateral amount times the liquidation price.
     */
    uint256 public constant CHALLENGER_REWARD = 20000; // 2%
    uint256 public constant EXPIRED_PRICE_FACTOR = 10;

    IPositionFactory private immutable POSITION_FACTORY; // position contract to clone

    IDecentralizedEURO public immutable DEURO; // currency
    PositionRoller public immutable ROLLER; // helper to roll positions
    ILeadrate public immutable RATE; // to determine the interest rate
    address public immutable WETH; // wrapped native token (ETH) address

    Challenge[] public challenges; // list of open challenges

    /**
     * @notice Map to remember pending postponed collateral returns.
     * @dev It maps collateral => beneficiary => amount.
     */
    mapping(address collateral => mapping(address owner => uint256 amount)) public pendingReturns;

    /**
     * @notice Tracks whether the first position has been created.
     * @dev The first position (genesis) can skip the 3-day init period requirement.
     */
    bool private _genesisPositionCreated;

    struct Challenge {
        address challenger; // the address from which the challenge was initiated
        uint40 start; // the start of the challenge
        IPosition position; // the position that was challenged
        uint256 size; // how much collateral the challenger provided
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
    event PostponedReturn(address collateral, address indexed beneficiary, uint256 amount);
    event ForcedSale(address pos, uint256 amount, uint256 priceE36MinusDecimals);

    error UnexpectedPrice();
    error InvalidPos();
    error IncompatibleCollateral();
    error InsufficientCollateral();
    error LeaveNoDust(uint256 amount);
    error InvalidRiskPremium();
    error InvalidReservePPM();
    error InvalidCollateralDecimals();
    error ChallengeTimeTooShort();
    error InitPeriodTooShort();
    error NativeOnlyForWETH();
    error ValueMismatch();
    error NativeTransferFailed();

    modifier validPos(address position) {
        if (DEURO.getPositionParent(position) != address(this)) revert InvalidPos();
        _;
    }

    constructor(address _deuro, address _leadrate, address payable _roller, address _factory, address _weth) {
        DEURO = IDecentralizedEURO(_deuro);
        RATE = ILeadrate(_leadrate);
        POSITION_FACTORY = IPositionFactory(_factory);
        ROLLER = PositionRoller(_roller);
        WETH = _weth;
    }

    /**
     * @notice Open a collateralized loan position. See also https://docs.deuro.com/positions/open .
     * @dev For a successful call, you must set an allowance for the collateral token, allowing
     * the minting hub to transfer the initial collateral amount to the newly created position and to
     * withdraw the fees.
     *
     * @param _collateralAddress  address of collateral token
     * @param _minCollateral      minimum collateral required to prevent dust amounts
     * @param _initialCollateral  amount of initial collateral to be deposited
     * @param _mintingMaximum     maximal amount of dEURO that can be minted by the position owner
     * @param _initPeriodSeconds  initial period in seconds
     * @param _expirationSeconds  position tenor in seconds from 'now'
     * @param _challengeSeconds   challenge period. Longer for less liquid collateral.
     * @param _riskPremium        ppm of minted amount that is added to the applicable minting fee as a risk premium
     * @param _liqPrice           Liquidation price with (36 - token decimals) decimals,
     *                            e.g. 18 decimals for an 18 dec collateral, 36 decs for a 0 dec collateral.
     * @param _reservePPM         ppm of minted amount that is locked as borrower's reserve, e.g. 20%
     * @return address            address of created position
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
        uint24 _reservePPM
    ) public payable returns (address) {
        {
            if (_riskPremium > 1_000_000) revert InvalidRiskPremium();
            if (CHALLENGER_REWARD > _reservePPM || _reservePPM > 1_000_000) revert InvalidReservePPM();
            if (IERC20Metadata(_collateralAddress).decimals() > 24) revert InvalidCollateralDecimals(); // leaves 12 digits for price
            if (_challengeSeconds < 1 days) revert ChallengeTimeTooShort();
            // First position (genesis) can skip init period, all others require 3 days minimum
            if (_genesisPositionCreated) {
                if (_initPeriodSeconds < 3 days) revert InitPeriodTooShort();
            } else {
                _genesisPositionCreated = true;
            }
            uint256 invalidAmount = IERC20(_collateralAddress).totalSupply() + 1;
            // TODO: Improve for older tokens that revert with assert,
            // which consumes all gas and makes the entire tx fail (uncatchable)
            try IERC20(_collateralAddress).transfer(address(0x123), invalidAmount) {
                revert IncompatibleCollateral(); // we need a collateral that reverts on failed transfers
            } catch Error(string memory /*reason*/) {} catch Panic(uint /*errorCode*/) {} catch (
                bytes memory /*lowLevelData*/
            ) {}
            if (_initialCollateral < _minCollateral) revert InsufficientCollateral();
            // must start with at least 100 dEURO worth of collateral
            if (_minCollateral * _liqPrice < 100 ether * 10 ** 18) revert InsufficientCollateral();
        }

        IPosition pos = IPosition(
            POSITION_FACTORY.createNewPosition(
                msg.sender,
                address(DEURO),
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
        DEURO.registerPosition(address(pos));
        DEURO.collectProfits(msg.sender, OPENING_FEE);

        // Transfer collateral (handles native coin positions)
        if (msg.value > 0) {
            if (_collateralAddress != WETH) revert NativeOnlyForWETH();
            if (msg.value != _initialCollateral) revert ValueMismatch();
            IWrappedNative(WETH).deposit{value: msg.value}();
            IERC20(WETH).transfer(address(pos), _initialCollateral);
        } else {
            IERC20(_collateralAddress).transferFrom(msg.sender, address(pos), _initialCollateral);
        }

        emit PositionOpened(msg.sender, address(pos), address(pos), _collateralAddress);
        return address(pos);
    }

    /**
     * @notice Clones an existing position and immediately tries to mint the specified amount using the given collateral.
     * @dev This needs an allowance to be set on the collateral contract such that the minting hub can get the collateral.
     * For native coin positions (WETH), send msg.value equal to _initialCollateral.
     * @param owner The owner of the cloned position
     * @param parent The parent position to clone from
     * @param _initialCollateral Amount of collateral to deposit
     * @param _initialMint Amount of dEURO to mint
     * @param expiration Expiration timestamp for the clone
     * @param _liqPrice The liquidation price. If 0, inherits from parent.
     */
    function clone(
        address owner,
        address parent,
        uint256 _initialCollateral,
        uint256 _initialMint,
        uint40 expiration,
        uint256 _liqPrice
    ) public payable validPos(parent) returns (address) {
        address pos = POSITION_FACTORY.clonePosition(parent);
        IPosition child = IPosition(pos);
        child.initialize(parent, expiration);
        DEURO.registerPosition(pos);
        IERC20 collateral = child.collateral();
        if (_initialCollateral < child.minimumCollateral()) revert InsufficientCollateral();

        // Transfer collateral (handles native coin positions)
        if (msg.value > 0) {
            if (address(collateral) != WETH) revert NativeOnlyForWETH();
            if (msg.value != _initialCollateral) revert ValueMismatch();
            IWrappedNative(WETH).deposit{value: msg.value}();
            collateral.transfer(pos, _initialCollateral);
        } else {
            collateral.transferFrom(msg.sender, pos, _initialCollateral); // collateral must still come from sender for security
        }

        emit PositionOpened(owner, address(pos), parent, address(collateral));
        child.mint(owner, _initialMint);

        // Adjust price if requested, incurs cooldown on price increase
        if (_liqPrice > 0 && _liqPrice != child.price()) {
            child.adjustPrice(_liqPrice);
        }

        Ownable(address(child)).transferOwnership(owner);
        return address(pos);
    }

    /**
     * @notice Launch a challenge (Dutch auction) on a position
     * @dev For native coin positions (WETH), send msg.value equal to _collateralAmount.
     * @param _positionAddr address of the position we want to challenge
     * @param _collateralAmount amount of the collateral we want to challenge
     * @param minimumPrice guards against the minter front-running with a price change
     * @return index of the challenge in the challenge-array
     */
    function challenge(
        address _positionAddr,
        uint256 _collateralAmount,
        uint256 minimumPrice
    ) external payable validPos(_positionAddr) returns (uint256) {
        IPosition position = IPosition(_positionAddr);
        // challenger should be ok if front-run by owner with a higher price
        // in case owner front-runs challenger with small price decrease to prevent challenge,
        // the challenger should set minimumPrice to market price
        uint256 liqPrice = position.virtualPrice();
        if (liqPrice < minimumPrice) revert UnexpectedPrice();

        // Transfer collateral (handles native coin positions)
        address collateralAddr = address(position.collateral());
        if (msg.value > 0) {
            if (collateralAddr != WETH) revert NativeOnlyForWETH();
            if (msg.value != _collateralAmount) revert ValueMismatch();
            IWrappedNative(WETH).deposit{value: msg.value}();
        } else {
            IERC20(collateralAddr).transferFrom(msg.sender, address(this), _collateralAmount);
        }

        uint256 pos = challenges.length;
        challenges.push(Challenge(msg.sender, uint40(block.timestamp), position, _collateralAmount));
        position.notifyChallengeStarted(_collateralAmount, liqPrice);
        emit ChallengeStarted(msg.sender, address(position), _collateralAmount, pos);
        return pos;
    }

    /**
     * @notice Post a bid in dEURO given an open challenge.
     *
     * @dev In case that the collateral cannot be transferred back to the challenger (i.e. because the collateral token
     * has a blacklist and the challenger is on it), it is possible to postpone the return of the collateral.
     *
     * @param _challengeNumber          index of the challenge as broadcast in the event
     * @param size                      how much of the collateral the caller wants to bid for at most
     *                                  (automatically reduced to the available amount)
     * @param postponeCollateralReturn  To postpone the return of the collateral to the challenger. Usually false.
     * @param returnCollateralAsNative  If true, return collateral as native coin (only for WETH positions).
     *                                  In phase 1 (aversion): bidder receives native. In phase 2 (liquidation): both
     *                                  challenger refund and bidder acquisition are returned as native.
     */
    function bid(uint32 _challengeNumber, uint256 size, bool postponeCollateralReturn, bool returnCollateralAsNative) public {
        Challenge memory _challenge = challenges[_challengeNumber];
        (uint256 liqPrice, uint40 phase) = _challenge.position.challengeData();
        size = _challenge.size < size ? _challenge.size : size; // cannot bid for more than the size of the challenge

        if (block.timestamp <= _challenge.start + phase) {
            _avertChallenge(_challenge, _challengeNumber, liqPrice, size, returnCollateralAsNative);
            emit ChallengeAverted(address(_challenge.position), _challengeNumber, size);
        } else {
            _returnChallengerCollateral(_challenge, _challengeNumber, size, postponeCollateralReturn, returnCollateralAsNative);
            (uint256 transferredCollateral, uint256 offer) = _finishChallenge(_challenge, size, returnCollateralAsNative);
            emit ChallengeSucceeded(address(_challenge.position), _challengeNumber, offer, transferredCollateral, size);
        }
    }

    /**
     * @notice Post a bid in dEURO given an open challenge (backward compatible version).
     */
    function bid(uint32 _challengeNumber, uint256 size, bool postponeCollateralReturn) external {
        bid(_challengeNumber, size, postponeCollateralReturn, false);
    }

    function _finishChallenge(
        Challenge memory _challenge,
        uint256 size,
        bool asNative
    ) internal returns (uint256, uint256) {
        // Repayments depend on what was actually minted, whereas bids depend on the available collateral
        (address owner, uint256 collateral, uint256 repayment, uint256 interest, uint32 reservePPM) = _challenge
            .position
            .notifyChallengeSucceeded(size);

        // No overflow possible thanks to invariant (col * price <= limit * 10**18)
        // enforced in Position.setPrice and knowing that collateral <= col.
        uint256 offer = _calculateOffer(_challenge, collateral);

        DEURO.transferFrom(msg.sender, address(this), offer); // get money from bidder
        uint256 reward = (offer * CHALLENGER_REWARD) / 1_000_000;
        DEURO.transfer(_challenge.challenger, reward); // pay out the challenger reward
        uint256 fundsAvailable = offer - reward; // funds available after reward

        // Example: available funds are 90, repayment is 50, reserve 20%. Then 20%*(90-50)=16 are collected as profits
        // and the remaining 34 are sent to the position owner. If the position owner maxed out debt before the challenge
        // started and the liquidation price was 100, they would be slightly better off as they would get away with 80
        // instead of 40+36 = 76 in this example.
        if (fundsAvailable > repayment + interest) {
            // The excess amount is distributed between the system and the owner using the reserve ratio
            // At this point, we cannot rely on the liquidation price because the challenge might have been started as a
            // response to an unreasonable increase of the liquidation price, such that we have to use this heuristic
            // for excess fund distribution, which make position owners that maxed out their positions slightly better
            // off in comparison to those who did not.
            uint256 profits = (reservePPM * (fundsAvailable - repayment - interest)) / 1_000_000;
            DEURO.collectProfits(address(this), profits);
            DEURO.transfer(owner, fundsAvailable - repayment - interest - profits);
        } else if (fundsAvailable < repayment + interest) {
            DEURO.coverLoss(address(this), repayment + interest - fundsAvailable); // ensure we have enough to pay everything
        }
        DEURO.burnWithoutReserve(repayment, reservePPM); // Repay the challenged part
        DEURO.collectProfits(address(this), interest); // Collect interest as profits

        // Transfer collateral to bidder (handles native coin if requested)
        if (asNative && address(_challenge.position.collateral()) == WETH) {
            _challenge.position.transferChallengedCollateral(address(this), collateral);
            IWrappedNative(WETH).withdraw(collateral);
            (bool success, ) = msg.sender.call{value: collateral}("");
            if (!success) revert NativeTransferFailed();
        } else {
            _challenge.position.transferChallengedCollateral(msg.sender, collateral);
        }

        return (collateral, offer);
    }

    function _avertChallenge(Challenge memory _challenge, uint32 number, uint256 liqPrice, uint256 size, bool asNative) internal {
        require(block.timestamp != _challenge.start); // do not allow to avert the challenge in the same transaction, see CS-ZCHF-037
        if (msg.sender == _challenge.challenger) {
            // allow challenger to cancel challenge without paying themselves
        } else {
            DEURO.transferFrom(msg.sender, _challenge.challenger, (size * liqPrice) / (10 ** 18));
        }

        _challenge.position.notifyChallengeAverted(size);

        if (size < _challenge.size) {
            challenges[number].size = _challenge.size - size;
        } else {
            require(size == _challenge.size);
            delete challenges[number];
        }

        // Transfer collateral to bidder (handles native coin if requested)
        if (asNative && address(_challenge.position.collateral()) == WETH) {
            IWrappedNative(WETH).withdraw(size);
            (bool success, ) = msg.sender.call{value: size}("");
            if (!success) revert NativeTransferFailed();
        } else {
            _challenge.position.collateral().transfer(msg.sender, size);
        }
    }

    /**
     * @notice Returns 'amount' of the collateral to the challenger and reduces or deletes the relevant challenge.
     */
    function _returnChallengerCollateral(
        Challenge memory _challenge,
        uint32 number,
        uint256 amount,
        bool postpone,
        bool asNative
    ) internal {
        if (_challenge.size == amount) {
            // bid on full amount
            delete challenges[number];
        } else {
            // bid on partial amount
            challenges[number].size -= amount;
        }
        _returnCollateral(_challenge.position.collateral(), _challenge.challenger, amount, postpone, asNative);
    }

    /**
     * @notice Calculates the current Dutch auction price.
     * @dev Starts at the full price at time 'start' and linearly goes to 0 as 'phase2' passes.
     */
    function _calculatePrice(uint40 start, uint40 phase2, uint256 liqPrice) internal view returns (uint256) {
        uint40 timeNow = uint40(block.timestamp);
        if (timeNow <= start) {
            return liqPrice;
        } else if (timeNow >= start + phase2) {
            return 0;
        } else {
            uint256 timeLeft = phase2 - (timeNow - start);
            return (liqPrice * timeLeft) / phase2;
        }
    }

    /**
     * @notice Calculates the offer amount for the given challenge.
     * @dev The offer is calculated as the current price times the collateral amount.
     */
    function _calculateOffer(Challenge memory _challenge, uint256 collateral) internal view returns (uint256) {
        (uint256 liqPrice, uint40 phase) = _challenge.position.challengeData();
        return (_calculatePrice(_challenge.start + phase, phase, liqPrice) * collateral) / 10 ** 18;
    }

    /**
     * @notice Get the price per unit of the collateral for the given challenge.
     * @dev The price comes with (36 - collateral.decimals()) digits, so multiplying it with the raw collateral amount
     * always yields a price with 36 digits, or 18 digits after dividing by 10**18 again.
     */
    function price(uint32 challengeNumber) public view returns (uint256) {
        Challenge memory _challenge = challenges[challengeNumber];
        if (_challenge.challenger == address(0x0)) {
            return 0;
        } else {
            (uint256 liqPrice, uint40 phase) = _challenge.position.challengeData();
            return _calculatePrice(_challenge.start + phase, phase, liqPrice);
        }
    }

    /**
     * @notice Challengers can call this method to withdraw collateral whose return was postponed.
     * @param collateral The collateral token address
     * @param target The address to receive the collateral
     * @param asNative If true and collateral is WETH, unwrap and send as native coin
     */
    function returnPostponedCollateral(address collateral, address target, bool asNative) public {
        uint256 amount = pendingReturns[collateral][msg.sender];
        delete pendingReturns[collateral][msg.sender];
        if (asNative && collateral == WETH) {
            IWrappedNative(WETH).withdraw(amount);
            (bool success, ) = target.call{value: amount}("");
            if (!success) revert NativeTransferFailed();
        } else {
            IERC20(collateral).transfer(target, amount);
        }
    }

    /**
     * @notice Challengers can call this method to withdraw collateral whose return was postponed (backward compatible).
     */
    function returnPostponedCollateral(address collateral, address target) external {
        returnPostponedCollateral(collateral, target, false);
    }

    function _returnCollateral(IERC20 collateral, address recipient, uint256 amount, bool postpone, bool asNative) internal {
        if (postpone) {
            // Postponing helps in case the challenger was blacklisted or otherwise cannot receive at the moment.
            pendingReturns[address(collateral)][recipient] += amount;
            emit PostponedReturn(address(collateral), recipient, amount);
        } else if (asNative && address(collateral) == WETH) {
            // Unwrap and return as native coin
            IWrappedNative(WETH).withdraw(amount);
            (bool success, ) = recipient.call{value: amount}("");
            if (!success) revert NativeTransferFailed();
        } else {
            collateral.transfer(recipient, amount); // return the challenger's collateral
        }
    }

    /**
     * The applicable purchase price when forcing the sale of collateral of an expired position.
     *
     * The price starts at 10x the liquidation price at the expiration time, linearly declines to
     * 1x liquidation price over the course of one challenge period, and then linearly declines
     * less steeply to 0 over the course of another challenge period.
     */
    function expiredPurchasePrice(IPosition pos) public view returns (uint256) {
        uint256 liqprice = pos.virtualPrice();
        uint256 expiration = pos.expiration();
        if (block.timestamp <= expiration) {
            return EXPIRED_PRICE_FACTOR * liqprice;
        } else {
            uint256 challengePeriod = pos.challengePeriod();
            uint256 timePassed = block.timestamp - expiration;
            if (timePassed <= challengePeriod) {
                // from 10x liquidation price to 1x in first phase
                uint256 timeLeft = challengePeriod - timePassed;
                return liqprice + (((EXPIRED_PRICE_FACTOR - 1) * liqprice * timeLeft) / challengePeriod);
            } else if (timePassed < 2 * challengePeriod) {
                // from 1x liquidation price to 0 in second phase
                uint256 timeLeft = 2 * challengePeriod - timePassed;
                return (liqprice * timeLeft) / challengePeriod;
            } else {
                // get collateral for free after both phases passed
                return 0;
            }
        }
    }

    /**
     * Buys up to the desired amount of the collateral asset from the given expired position using
     * the applicable 'expiredPurchasePrice' at that instant.
     *
     * To prevent dust either the remaining collateral needs to be bought or collateral with a value
     * of at least OPENING_FEE (1000 dEURO) needs to remain in the position for a different buyer
     *
     * @param pos The expired position to buy collateral from
     * @param upToAmount Maximum amount of collateral to buy
     * @param receiveAsNative If true and collateral is WETH, receive as native coin
     */
    function buyExpiredCollateral(IPosition pos, uint256 upToAmount, bool receiveAsNative) public returns (uint256) {
        uint256 max = pos.collateral().balanceOf(address(pos));
        uint256 amount = upToAmount > max ? max : upToAmount;
        uint256 forceSalePrice = expiredPurchasePrice(pos);

        uint256 costs = (forceSalePrice * amount) / 10 ** 18;

        if (max - amount > 0 && ((forceSalePrice * (max - amount)) / 10 ** 18) < OPENING_FEE) {
            revert LeaveNoDust(max - amount);
        }

        address collateralAddr = address(pos.collateral());
        if (receiveAsNative && collateralAddr == WETH) {
            // Pull dEURO from user to Hub, then approve Position to spend it
            DEURO.transferFrom(msg.sender, address(this), costs);
            IERC20(address(DEURO)).approve(address(pos), costs);
            // Route through hub to unwrap
            pos.forceSale(address(this), amount, costs);
            IWrappedNative(WETH).withdraw(amount);
            (bool success, ) = msg.sender.call{value: amount}("");
            if (!success) revert NativeTransferFailed();
        } else {
            pos.forceSale(msg.sender, amount, costs);
        }

        emit ForcedSale(address(pos), amount, forceSalePrice);
        return amount;
    }

    /**
     * Buys up to the desired amount of the collateral asset from the given expired position (backward compatible).
     */
    function buyExpiredCollateral(IPosition pos, uint256 upToAmount) external returns (uint256) {
        return buyExpiredCollateral(pos, upToAmount, false);
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view override virtual returns (bool) {
        return
            interfaceId == type(IMintingHub).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    /**
     * @notice Required to receive native coin when unwrapping WETH.
     */
    receive() external payable {}
}
