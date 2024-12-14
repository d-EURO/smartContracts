// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {MathUtil} from "../utils/MathUtil.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {IReserve} from "../interface/IReserve.sol";
import {ILeadrate} from "../interface/ILeadrate.sol";

import {IPosition} from "./interface/IPosition.sol";

/**
 * @title Position
 * @notice A collateralized minting position with continuous interest accrual and no upfront minting fee.
 */
contract Position is Ownable, IPosition, MathUtil {
    uint256 public price;
    uint256 public minted;
    uint256 private totalMinted;
    uint256 public immutable limit;
    uint256 public challengedAmount;
    uint40 public immutable challengePeriod;
    uint40 public immutable start;
    uint40 public cooldown;
    uint40 public expiration;
    bool private closed;
    address public immutable original;
    address public immutable hub;
    IDecentralizedEURO public immutable deuro;
    IERC20 public immutable override collateral;
    uint256 public immutable override minimumCollateral;
    uint24 public immutable riskPremiumPPM;
    uint24 public immutable reserveContribution;

    uint256 public lastInterestAccrual;

    event MintingUpdate(uint256 collateral, uint256 price, uint256 minted);
    event PositionDenied(address indexed sender, string message); 

    error InsufficientCollateral(uint256 needed, uint256 available);
    error TooLate();
    error RepaidTooMuch(uint256 excess);
    error LimitExceeded(uint256 tried, uint256 available);
    error ChallengeTooSmall();
    error Expired(uint40 time, uint40 expiration);
    error Alive();
    error Closed();
    error Hot();
    error Challenged();
    error NotHub();
    error InvalidExpiration();
    error AlreadyInitialized();

    modifier alive() {
        if (block.timestamp >= expiration) revert Expired(uint40(block.timestamp), expiration);
        _;
    }

    modifier backed() {
        if (isClosed()) revert Closed();
        _;
    }

    modifier expired() {
        if (block.timestamp < expiration) revert Alive();
        _;
    }

    modifier noCooldown() {
        if (block.timestamp <= cooldown) revert Hot();
        _;
    }

    modifier noChallenge() {
        if (challengedAmount > 0) revert Challenged();
        _;
    }

    modifier onlyHub() {
        if (msg.sender != address(hub)) revert NotHub();
        _;
    }

    modifier ownerOrRoller() {
        if (msg.sender != address(IHub(hub).roller())) _checkOwner();
        _;
    }

    constructor(
        address _owner,
        address _hub,
        address _deuro,
        address _collateral,
        uint256 _minCollateral,
        uint256 _initialLimit,
        uint40 _initPeriod,
        uint40 _duration,
        uint40 _challengePeriod,
        uint24 _riskPremiumPPM,
        uint256 _liqPrice,
        uint24 _reservePPM
    ) Ownable(_owner) {
        require(_initPeriod >= 3 days);
        original = address(this);
        hub = _hub;
        deuro = IDecentralizedEURO(_deuro);
        collateral = IERC20(_collateral);
        riskPremiumPPM = _riskPremiumPPM;
        reserveContribution = _reservePPM;
        minimumCollateral = _minCollateral;
        challengePeriod = _challengePeriod;
        start = uint40(block.timestamp) + _initPeriod;
        cooldown = start;
        expiration = start + _duration;
        limit = _initialLimit;
        _setPrice(_liqPrice, _initialLimit);
        lastInterestAccrual = block.timestamp;
    }

    function initialize(address parent, uint40 _expiration) external onlyHub {
        if (expiration != 0) revert AlreadyInitialized();
        if (_expiration < block.timestamp || _expiration > Position(original).expiration()) revert InvalidExpiration();
        expiration = _expiration;
        price = Position(parent).price();
        _transferOwnership(hub);
        lastInterestAccrual = block.timestamp;
    }

    function assertCloneable() external noChallenge noCooldown alive backed {}

    function notifyMint(uint256 mint_) external {
        if (deuro.getPositionParent(msg.sender) != hub) revert NotHub();
        totalMinted += mint_;
    }

    function notifyRepaid(uint256 repaid_) external {
        if (deuro.getPositionParent(msg.sender) != hub) revert NotHub();
        totalMinted -= repaid_;
    }

    function availableForClones() external view returns (uint256) {
        uint256 potential = (_collateralBalance() * price) / ONE_DEC18;
        uint256 unusedPotential = minted > potential ? 0 : potential - minted;
        if (totalMinted + unusedPotential >= limit) {
            return 0;
        } else {
            return limit - totalMinted - unusedPotential;
        }
    }

    function availableForMinting() public view returns (uint256) {
        if (address(this) == original) {
            return limit - totalMinted;
        } else {
            return Position(original).availableForClones();
        }
    }

    function deny(address[] calldata helpers, string calldata message) external {
        if (block.timestamp >= start) revert TooLate();
        IReserve(deuro.reserve()).checkQualified(msg.sender, helpers);
        _close();
        emit PositionDenied(msg.sender, message);
    }

    function _close() internal {
        closed = true;
    }

    function isClosed() public view returns (bool) {
        return closed;
    }

    function getUsableMint(uint256 totalMint, bool afterFees) public view returns (uint256) {
        if (afterFees) {
            return (totalMint * (1000_000 - reserveContribution - calculateCurrentFee())) / 1000_000;
        } else {
            return (totalMint * (1000_000 - reserveContribution)) / 1000_000;
        }
    }

    function getMintAmount(uint256 usableMint) external view returns (uint256) {
        uint24 fee = calculateCurrentFee();
        return
            usableMint == 0
                ? 0
                : (usableMint * 1000_000 - 1) / (1000_000 - reserveContribution - fee) + 1;
    }

    function adjust(uint256 newMinted, uint256 newCollateral, uint256 newPrice) external onlyOwner {
        _accrueInterest();
        uint256 colbal = _collateralBalance();
        if (newCollateral > colbal) {
            collateral.transferFrom(msg.sender, address(this), newCollateral - colbal);
        }
        if (newMinted < minted) {
            deuro.burnFromWithReserve(msg.sender, minted - newMinted, reserveContribution);
            _notifyRepaid(minted - newMinted);
        }
        if (newCollateral < colbal) {
            _withdrawCollateral(msg.sender, colbal - newCollateral);
        }
        if (newMinted > minted) {
            _mint(msg.sender, newMinted - minted, newCollateral);
        }
        if (newPrice != price) {
            _adjustPrice(newPrice);
        }
        emit MintingUpdate(newCollateral, newPrice, newMinted);
    }

    function adjustPrice(uint256 newPrice) public onlyOwner {
        _accrueInterest();
        _adjustPrice(newPrice);
        emit MintingUpdate(_collateralBalance(), price, minted);
    }

    function _adjustPrice(uint256 newPrice) internal noChallenge alive backed {
        if (newPrice > price) {
            _restrictMinting(3 days);
        } else {
            _checkCollateral(_collateralBalance(), newPrice);
        }
        _setPrice(newPrice, minted + availableForMinting());
    }

    function _setPrice(uint256 newPrice, uint256 bounds) internal {
        require(newPrice * minimumCollateral <= bounds * ONE_DEC18);
        price = newPrice;
    }

    function _collateralBalance() internal view returns (uint256) {
        return IERC20(collateral).balanceOf(address(this));
    }

    function mint(address target, uint256 amount) public ownerOrRoller {
        _accrueInterest();
        uint256 collateralBalance = _collateralBalance();
        _mint(target, amount, collateralBalance);
        emit MintingUpdate(collateralBalance, price, minted);
    }

    function calculateCurrentFee() public view returns (uint24) {
        return 0;
    }

    function annualInterestPPM() public view returns (uint24) {
        return IHub(hub).rate().currentRatePPM() + riskPremiumPPM;
    }

    function calculateFee(uint256 exp) public view returns (uint24) {
        uint256 time = block.timestamp < start ? start : block.timestamp;
        uint256 timePassed = exp - time;
        uint256 feePPM = (timePassed * annualInterestPPM()) / 365 days;
        return uint24(feePPM > 1000000 ? 1000000 : feePPM);
    }

    function _mint(address target, uint256 amount, uint256 collateral_) internal noChallenge noCooldown alive backed {
        if (amount > availableForMinting()) revert LimitExceeded(amount, availableForMinting());
        Position(original).notifyMint(amount);
        deuro.mintWithReserve(target, amount, reserveContribution, 0);
        minted += amount;
        _checkCollateral(collateral_, price);
    }

    function _restrictMinting(uint40 period) internal {
        uint40 horizon = uint40(block.timestamp) + period;
        if (horizon > cooldown) {
            cooldown = horizon;
        }
    }

    function repay(uint256 amount) public returns (uint256) {
        _accrueInterest();
        IERC20(deuro).transferFrom(msg.sender, address(this), amount);
        uint256 actuallyRepaid = IDecentralizedEURO(deuro).burnWithReserve(amount, reserveContribution);
        _notifyRepaid(actuallyRepaid);
        emit MintingUpdate(_collateralBalance(), price, minted);
        return actuallyRepaid;
    }

    function _notifyRepaid(uint256 amount) internal {
        if (amount > minted) revert RepaidTooMuch(amount - minted);
        Position(original).notifyRepaid(amount);
        minted -= amount;
    }

    function forceSale(address buyer, uint256 collAmount, uint256 proceeds) external onlyHub expired noChallenge {
        _accrueInterest();
        uint256 remainingCollateral = _sendCollateral(buyer, collAmount);
        if (minted > 0) {
            uint256 availableReserve = deuro.calculateAssignedReserve(minted, reserveContribution);
            if (proceeds + availableReserve >= minted) {
                uint256 returnedReserve = deuro.burnFromWithReserve(buyer, minted, reserveContribution);
                assert(returnedReserve == availableReserve);
                deuro.transferFrom(buyer, owner(), proceeds + returnedReserve - minted);
                _notifyRepaid(minted);
            } else {
                deuro.transferFrom(buyer, address(this), proceeds);
                if (remainingCollateral == 0) {
                    deuro.coverLoss(address(this), minted - proceeds);
                    deuro.burnWithoutReserve(minted, reserveContribution);
                    _notifyRepaid(minted);
                } else {
                    uint256 repaid = deuro.burnWithReserve(proceeds, reserveContribution);
                    _notifyRepaid(repaid);
                }
            }
        } else {
            deuro.transferFrom(buyer, owner(), proceeds);
        }
        emit MintingUpdate(_collateralBalance(), price, minted);
    }

    function withdraw(address token, address target, uint256 amount) external onlyOwner {
        _accrueInterest();
        if (token == address(collateral)) {
            withdrawCollateral(target, amount);
        } else {
            uint256 balance = _collateralBalance();
            IERC20(token).transfer(target, amount);
            require(balance == _collateralBalance());
        }
    }

    function withdrawCollateral(address target, uint256 amount) public ownerOrRoller {
        _accrueInterest();
        uint256 balance = _withdrawCollateral(target, amount);
        emit MintingUpdate(balance, price, minted);
    }

    function _withdrawCollateral(address target, uint256 amount) internal noChallenge returns (uint256) {
        if (block.timestamp <= cooldown) revert Hot();
        uint256 balance = _sendCollateral(target, amount);
        _checkCollateral(balance, price);
        return balance;
    }

    function _sendCollateral(address target, uint256 amount) internal returns (uint256) {
        if (amount > 0) {
            IERC20(collateral).transfer(target, amount);
        }
        uint256 balance = _collateralBalance();
        if (balance < minimumCollateral) {
            _close();
        }
        return balance;
    }

    function _checkCollateral(uint256 collateralReserve, uint256 atPrice) internal view {
        uint256 relevantCollateral = collateralReserve < minimumCollateral ? 0 : collateralReserve;
        if (relevantCollateral * atPrice < minted * ONE_DEC18)
            revert InsufficientCollateral(relevantCollateral * atPrice, minted * ONE_DEC18);
    }

    function challengeData() external view returns (uint256 liqPrice, uint40 phase) {
        return (price, challengePeriod);
    }

    function notifyChallengeStarted(uint256 size) external onlyHub alive {
        if (size < minimumCollateral && size < _collateralBalance()) revert ChallengeTooSmall();
        if (size == 0) revert ChallengeTooSmall();
        challengedAmount += size;
    }

    function notifyChallengeAverted(uint256 size) external onlyHub {
        challengedAmount -= size;
        _restrictMinting(1 days);
    }

    function notifyChallengeSucceeded(
        address _bidder,
        uint256 _size
    ) external onlyHub returns (address, uint256, uint256, uint32) {
        _accrueInterest();
        challengedAmount -= _size;
        uint256 colBal = _collateralBalance();
        if (colBal < _size) {
            _size = colBal;
        }
        uint256 repayment = colBal == 0 ? 0 : (minted * _size) / colBal;
        _notifyRepaid(repayment);
        _restrictMinting(3 days);
        uint256 newBalance = _sendCollateral(_bidder, _size);
        emit MintingUpdate(newBalance, price, minted);
        return (owner(), _size, repayment, reserveContribution);
    }

    function _accrueInterest() internal {
        if (block.timestamp > lastInterestAccrual) {
            uint256 timeElapsed = block.timestamp - lastInterestAccrual;
            uint24 interestPPM = annualInterestPPM();
            uint256 annualInterest = (minted * interestPPM) / 1000000;
            uint256 accrued = (annualInterest * timeElapsed) / (365 days);
            minted += accrued;
            lastInterestAccrual = block.timestamp;
        }
    }
}

interface IHub {
    function rate() external view returns (ILeadrate);
    function roller() external view returns (address);
}