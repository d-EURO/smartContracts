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
 * @notice A collateralized minting position.
 */
contract Position is Ownable, IPosition, MathUtil {
    /**
     * @notice The deuro price per unit of the collateral below which challenges succeed, (36 - collateral.decimals) decimals
     */
    uint256 public price;

    /**
     * @notice Net minted amount, including both principal and accrued interest.
     */
    uint256 public minted;

    /**
     * @notice How much has been minted in total. Only used in the parent (original) position.
     */
    uint256 private totalMinted;

    uint256 public immutable limit;

    /**
     * @notice Amount of the collateral currently under challenge.
     */
    uint256 public challengedAmount;

    /**
     * @notice Challenge period in seconds.
     */
    uint40 public immutable challengePeriod;

    /**
     * @notice When minting can start and the position is no longer deniable.
     */
    uint40 public immutable start;

    /**
     * @notice End of the latest cooldown. If in the future, minting is suspended.
     */
    uint40 public cooldown;

    /**
     * @notice Timestamp of the expiration of the position.
     */
    uint40 public expiration;

    bool private closed;

    /**
     * @notice The original position to help identify clones.
     */
    address public immutable original;

    /**
     * @notice The hub that created/recognizes this position.
     */
    address public immutable hub;

    /**
     * @notice The underlying stablecoin contract (dEURO).
     */
    IDecentralizedEURO public immutable deuro;

    /**
     * @notice The collateral token.
     */
    IERC20 public immutable override collateral;

    /**
     * @notice Minimum acceptable collateral to avoid dust.
     */
    uint256 public immutable override minimumCollateral;

    /**
     * @notice The interest in parts per million per year that is deducted when minting dEURO.
     * To be paid over time, but effectively accounted for in accruedInterest.
     */
    uint24 public immutable riskPremiumPPM;

    /**
     * @notice The reserve contribution in parts per million of the minted amount.
     */
    uint24 public immutable reserveContribution;

    /**
     * @notice The total principal borrowed so far (excluding accrued interest).
     */
    uint256 public principal;

    /**
     * @notice The total interest accrued but not yet paid.
     */
    uint256 public accruedInterest;

    /**
     * @notice The timestamp of the last interest accrual update.
     */
    uint40 public lastAccrual;

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
        require(_initPeriod >= 3 days, "initPeriod too small");
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
    }

    function initialize(address parent, uint40 _expiration) external onlyHub {
        if (expiration != 0) revert AlreadyInitialized();
        if (_expiration < block.timestamp || _expiration > Position(original).expiration()) {
            revert InvalidExpiration();
        }
        expiration = _expiration;
        price = Position(parent).price();
        _transferOwnership(hub);
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
        uint256 unusedPotential = minted > potential ? 0 : (potential - minted);
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

    function isClosed() public view returns (bool) {
        return closed;
    }

    function _close() internal {
        closed = true;
    }

    /**
     * @notice This is how much the minter can actually use when minting,
     * with the rest going to the minter reserve.
     */
    function getUsableMint(uint256 totalMint) public view returns (uint256) {
        return (totalMint * (1000_000 - reserveContribution)) / 1000_000;
    }

    function getMintAmount(uint256 usableMint) external view returns (uint256) {
        if (usableMint == 0) {
            return 0;
        }
        return (usableMint * 1000_000 - 1) / (1000_000 - reserveContribution) + 1;
    }

    function adjust(uint256 newMinted, uint256 newCollateral, uint256 newPrice) external onlyOwner {
        _accrueInterest();
        uint256 colbal = _collateralBalance();
        if (newCollateral > colbal) {
            collateral.transferFrom(msg.sender, address(this), newCollateral - colbal);
        }
        // repay if minted is decreasing
        if (newMinted < minted) {
            _payDownDebt(msg.sender, minted - newMinted);
        }
        // withdraw if collateral is decreasing
        if (newCollateral < colbal) {
            _withdrawCollateral(msg.sender, colbal - newCollateral);
        }
        // if minted is increasing
        if (newMinted > minted) {
            _mint(msg.sender, newMinted - minted, newCollateral);
        }
        // optionally adjust price
        if (newPrice != price) {
            _adjustPrice(newPrice);
        }
        emit MintingUpdate(newCollateral, newPrice, minted);
    }

    function adjustPrice(uint256 newPrice) public onlyOwner {
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
        require(newPrice * minimumCollateral <= bounds * ONE_DEC18, "liqPrice too high");
        price = newPrice;
    }

    function _collateralBalance() internal view returns (uint256) {
        return collateral.balanceOf(address(this));
    }

    /**
     * @notice Accrues interest since lastAccrual for principal.
     */
    function _accrueInterest() internal {
        uint40 nowTime = uint40(block.timestamp);
        if (nowTime > lastAccrual && principal > 0) {
            uint256 delta = nowTime - lastAccrual;
            uint256 interest = (principal * annualInterestPPM() * delta) / (365 days * 1_000_000);
            accruedInterest += interest;
            minted = principal + accruedInterest;
        }
        lastAccrual = nowTime;
    }

    function mint(address target, uint256 amount) public ownerOrRoller {
        uint256 colbal = _collateralBalance();
        _mint(target, amount, colbal);
        emit MintingUpdate(colbal, price, minted);
    }

    function annualInterestPPM() public view returns (uint24) {
        return IHub(hub).rate().currentRatePPM() + riskPremiumPPM;
    }

    function _mint(address target, uint256 amount, uint256 collateral_) internal noChallenge noCooldown alive backed {
        _accrueInterest();
        if (amount > availableForMinting()) revert LimitExceeded(amount, availableForMinting());
        Position(original).notifyMint(amount);
        deuro.mintWithReserve(target, amount, reserveContribution, 0);
        principal += amount;
        minted = principal + accruedInterest;
        _checkCollateral(collateral_, price);
    }

    function _restrictMinting(uint40 period) internal {
        uint40 horizon = uint40(block.timestamp) + period;
        if (horizon > cooldown) {
            cooldown = horizon;
        }
    }

    /**
     * @notice Repays from msg.sender, first covering accrued interest, then principal.
     */
    function repay(uint256 amount) external returns (uint256) {
        uint256 used = _payDownDebt(msg.sender, amount);
        emit MintingUpdate(_collateralBalance(), price, minted);
        return used;
    }

    function _payDownDebt(address payer, uint256 amount) internal returns (uint256 repaidAmount) {
        _accrueInterest();
        repaidAmount = 0;

        // pay interest first
        if (accruedInterest > 0) {
            uint256 interestToPay = accruedInterest > amount ? amount : accruedInterest;
            if (interestToPay > 0) {
                deuro.transferFrom(payer, address(this), interestToPay);
                deuro.collectProfits(address(this), interestToPay);
                accruedInterest -= interestToPay;
                amount -= interestToPay;
                repaidAmount += interestToPay;
            }
        }

        // pay principal next
        if (amount > 0 && principal > 0) {
            uint256 principalToPay = principal > amount ? amount : principal;
            if (principalToPay > 0) {
                deuro.transferFrom(payer, address(this), principalToPay);
                uint256 repaid = deuro.burnWithReserve(principalToPay, reserveContribution);
                principal -= repaid;
                amount -= principalToPay;
                repaidAmount += principalToPay;
                _notifyRepaid(repaid);
            }
        }

        minted = principal + accruedInterest;
    }

    function _notifyRepaid(uint256 amount) internal {
        if (amount > principal) revert RepaidTooMuch(amount - principal);
        Position(original).notifyRepaid(amount);
    }

    function forceSale(address buyer, uint256 collAmount, uint256 proceeds) external onlyHub expired noChallenge {
        _accrueInterest();
        uint256 remainingCollateral = _sendCollateral(buyer, collAmount);

        if (minted == 0) {
            // no debt, leftover proceeds go to owner
            if (proceeds > 0) {
                deuro.transferFrom(buyer, owner(), proceeds);
            }
            emit MintingUpdate(_collateralBalance(), price, minted);
            return;
        }

        // partial or full repay
        uint256 used = _payDownDebt(buyer, proceeds);
        uint256 leftover = proceeds > used ? (proceeds - used) : 0;

        if (minted == 0 && leftover > 0) {
            deuro.transferFrom(buyer, owner(), leftover);
        } else if (minted > 0 && remainingCollateral == 0) {
            // shortfall scenario
            uint256 deficit = minted - used;
            deuro.coverLoss(buyer, deficit);
            _payDownDebt(buyer, deficit);
        }
        emit MintingUpdate(_collateralBalance(), price, minted);
    }

    function withdraw(address token, address target, uint256 amount) external onlyOwner {
        if (token == address(collateral)) {
            withdrawCollateral(target, amount);
        } else {
            uint256 balance = _collateralBalance();
            IERC20(token).transfer(target, amount);
            require(balance == _collateralBalance(), "unsafe token");
        }
    }

    function withdrawCollateral(address target, uint256 amount) public ownerOrRoller {
        uint256 balance = _withdrawCollateral(target, amount);
        emit MintingUpdate(balance, price, minted);
    }

    function _withdrawCollateral(address target, uint256 amount) internal noChallenge {
        if (block.timestamp <= cooldown) revert Hot();
        uint256 balance = _sendCollateral(target, amount);
        _checkCollateral(balance, price);
    }

    function _sendCollateral(address target, uint256 amount) internal returns (uint256) {
        if (amount > 0) {
            collateral.transfer(target, amount);
        }
        uint256 balance = _collateralBalance();
        if (balance < minimumCollateral) {
            _close();
        }
        return balance;
    }

    function _checkCollateral(uint256 collateralReserve, uint256 atPrice) internal view {
        uint256 relevantCollateral = collateralReserve < minimumCollateral ? 0 : collateralReserve;
        if (relevantCollateral * atPrice < minted * ONE_DEC18) {
            revert InsufficientCollateral(relevantCollateral * atPrice, minted * ONE_DEC18);
        }
    }

    function challengeData() external view returns (uint256 liqPrice, uint40 phase) {
        return (price, challengePeriod);
    }

    function notifyChallengeStarted(uint256 size) external onlyHub alive {
        // require minimum size if not partial
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

        // Repayment fraction
        uint256 repayment = (colBal == 0) ? 0 : (minted * _size) / colBal;
        // reduce from accrued interest, then from principal
        repayment -= accruedInterest > repayment ? repayment : accruedInterest;
        repayment = principal > repayment ? repayment : principal;
        _notifyRepaid(repayment);

        uint256 newBalance = _sendCollateral(_bidder, _size);
        emit MintingUpdate(newBalance, price, minted);

        _restrictMinting(3 days);
        return (owner(), _size, repayment, reserveContribution);
    }
}

interface IHub {
    function rate() external view returns (ILeadrate);
    function roller() external view returns (address);
}