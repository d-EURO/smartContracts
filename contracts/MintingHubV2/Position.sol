// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IMintingHubGateway} from "../gateway/interface/IMintingHubGateway.sol";
import {IJuiceDollar} from "../interface/IJuiceDollar.sol";
import {IReserve} from "../interface/IReserve.sol";
import {MathUtil} from "../utils/MathUtil.sol";
import {IMintingHub} from "./interface/IMintingHub.sol";
import {IPosition} from "./interface/IPosition.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title Position
 * @notice A collateralized minting position.
 */
contract Position is Ownable, IPosition, MathUtil {
    /**
     * @notice Note that this contract is intended to be cloned. All clones will share the same values for
     * the constant and immutable fields, but have their own values for the other fields.
     */

    /**
     * @notice The jusd price per unit of the collateral below which challenges succeed, (36 - collateral.decimals) decimals
     */
    uint256 public price;

    /**
     * @notice How much has been minted in total. This variable is only used in the parent position.
     */
    uint256 private totalMinted;

    uint256 public immutable limit;

    /**
     * @notice Amount of the collateral that is currently under a challenge.
     * Used to figure out whether there are pending challenges.
     */
    uint256 public challengedAmount;

    /**
     * @notice The price at which the challenge was initiated.
     */
    uint256 private challengedPrice;

    /**
     * @notice Challenge period in seconds.
     */
    uint40 public immutable challengePeriod;

    /**
     * @notice Timestamp when minting can start and the position is no longer denied.
     */
    uint40 public immutable start;

    /**
     * @notice End of the latest cooldown. If this is in the future, minting is suspended.
     */
    uint40 public cooldown;

    /**
     * @notice Timestamp of the expiration of the position. After expiration, challenges cannot be averted
     * any more. This is also the basis for fee calculations.
     */
    uint40 public expiration;

    bool private closed;

    /**
     * @notice The original position to help identify clones.
     */
    address public immutable original;

    /**
     * @notice Pointer to the minting hub.
     */
    address public immutable hub;

    /**
     * @notice The JuiceDollar contract.
     */
    IJuiceDollar public immutable jusd;

    /**
     * @notice The collateral token.
     */
    IERC20 public immutable override collateral;

    /**
     * @notice Minimum acceptable collateral amount to prevent dust.
     */
    uint256 public immutable override minimumCollateral;

    /**
     * @notice The interest in parts per million per year that is deducted when minting JUSD.
     */
    uint24 public immutable riskPremiumPPM;

    /**
     * @notice The locked-in rate (including riskPremiumPPM) for this position.
     */
    uint24 public fixedAnnualRatePPM;

    /**
     * @notice The reserve contribution in parts per million of the minted amount.
     */
    uint24 public immutable reserveContribution;

    /**
     * @notice The total principal borrowed.
     */
    uint256 public principal;

    /**
     * @notice The total outstanding interest.
     */
    uint256 public interest;

    /**
     * @notice The timestamp of the last interest accrual.
     */
    uint40 public lastAccrual;

    event MintingUpdate(uint256 collateral, uint256 price, uint256 principal);
    event PositionDenied(address indexed sender, string message); // emitted if closed by governance

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
    error NotOriginal();
    error InvalidExpiration();
    error AlreadyInitialized();
    error PriceTooHigh(uint256 newPrice, uint256 maxPrice);

    modifier alive() {
        if (block.timestamp >= expiration) revert Expired(uint40(block.timestamp), expiration);
        _;
    }

    // requires that the position has always been backed by a minimal amount of collateral
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
        if (msg.sender != address(IMintingHub(hub).ROLLER())) _checkOwner();
        _;
    }

    /**
     * @dev See MintingHub.openPosition
     *
     * @param _riskPremiumPPM ppm of minted amount that is added to the applicable minting fee as a risk premium
     */
    constructor(
        address _owner,
        address _hub,
        address _jusd,
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
        original = address(this);
        hub = _hub;
        jusd = IJuiceDollar(_jusd);
        collateral = IERC20(_collateral);
        riskPremiumPPM = _riskPremiumPPM;
        reserveContribution = _reservePPM;
        minimumCollateral = _minCollateral;
        challengePeriod = _challengePeriod;
        start = uint40(block.timestamp) + _initPeriod; // at least three days time to deny the position
        cooldown = start;
        expiration = start + _duration;
        limit = _initialLimit;
        _setPrice(_liqPrice, _initialLimit);
        _fixRateToLeadrate(_riskPremiumPPM);
    }

    /**
     * Initialization method for clones.
     * Can only be called once. Should be called immediately after creating the clone.
     */
    function initialize(address parent, uint40 _expiration) external onlyHub {
        if (expiration != 0) revert AlreadyInitialized();
        if (_expiration < block.timestamp || _expiration > Position(original).expiration()) revert InvalidExpiration(); // expiration must not be later than original
        expiration = _expiration;
        price = Position(parent).price();
        _fixRateToLeadrate(Position(parent).riskPremiumPPM());
        _transferOwnership(hub);
    }

    /**
     * Cloning a position is only allowed if the position is not challenged, not expired and not in cooldown.
     */
    function assertCloneable() external noChallenge noCooldown alive backed {}

    /**
     * Notify the original that some amount has been minted.
     */
    function notifyMint(uint256 mint_) external {
        if (jusd.getPositionParent(msg.sender) != hub) revert NotHub();
        totalMinted += mint_;
    }

    function notifyRepaid(uint256 repaid_) external {
        if (jusd.getPositionParent(msg.sender) != hub) revert NotHub();
        totalMinted -= repaid_;
    }

    /**
     * Should only be called on the original position.
     * Better use 'availableForMinting'.
     */
    function availableForClones() external view returns (uint256) {
        // reserve capacity for the original to the extent the owner provided collateral
        uint256 potential = (_collateralBalance() * price) / ONE_DEC18;
        uint256 unusedPotential = principal > potential ? 0 : potential - principal;
        if (totalMinted + unusedPotential >= limit) {
            return 0;
        } else {
            return limit - totalMinted - unusedPotential;
        }
    }

    /**
     * The amount available for minting in this position family.
     *
     * Does not check if positions are challenged, closed, or under cooldown.
     */
    function availableForMinting() public view returns (uint256) {
        if (address(this) == original) {
            return limit - totalMinted;
        } else {
            return Position(original).availableForClones();
        }
    }

    /**
     * @notice Qualified pool share holders can call this method to immediately expire a freshly proposed position.
     */
    function deny(address[] calldata helpers, string calldata message) external {
        if (block.timestamp >= start) revert TooLate();
        IReserve(jusd.reserve()).checkQualified(msg.sender, helpers);
        _close();
        emit PositionDenied(msg.sender, message);
    }

    /**
     * Closes the position by putting it into eternal cooldown.
     * This allows the users to still withdraw the collateral that is left, but never to mint again.
     */
    function _close() internal {
        closed = true;
    }

    function isClosed() public view returns (bool) {
        return closed;
    }

    /**
     * @notice This is how much the minter can actually use when minting jusd, with the rest being assigned
     * to the minter reserve.
     */
    function getUsableMint(uint256 mintAmount) public view returns (uint256) {
        return (mintAmount * (1000_000 - reserveContribution)) / 1000_000;
    }

    /**
     * Returns the corresponding mint amount (disregarding the limit).
     */
    function getMintAmount(uint256 usableMint) external view returns (uint256) {
        return _ceilDivPPM(usableMint, reserveContribution);
    }

    /**
     * @notice "All in one" function to adjust the principal, the collateral amount,
     * and the price in one transaction.
     */
    function adjust(uint256 newPrincipal, uint256 newCollateral, uint256 newPrice) external onlyOwner {
        uint256 colbal = _collateralBalance();
        if (newCollateral > colbal) {
            collateral.transferFrom(msg.sender, address(this), newCollateral - colbal);
        }
        // Must be called after collateral deposit, but before withdrawal
        if (newPrincipal < principal) {
            uint256 debt = principal + _accrueInterest();
            _payDownDebt(debt - newPrincipal);
        }
        if (newCollateral < colbal) {
            _withdrawCollateral(msg.sender, colbal - newCollateral);
        }
        // Must be called after collateral withdrawal
        if (newPrincipal > principal) {
            _mint(msg.sender, newPrincipal - principal, newCollateral);
        }
        if (newPrice != price) {
            _adjustPrice(newPrice);
        }
        emit MintingUpdate(newCollateral, newPrice, newPrincipal);
    }

    /**
     * @notice Allows the position owner to adjust the liquidation price as long as there is no pending challenge.
     * Lowering the liquidation price can be done with immediate effect, given that there is enough collateral.
     * Increasing the liquidation price triggers a cooldown period of 3 days, during which minting is suspended.
     */
    function adjustPrice(uint256 newPrice) public onlyOwner {
        _adjustPrice(newPrice);
        emit MintingUpdate(_collateralBalance(), price, principal);
    }

    function _adjustPrice(uint256 newPrice) internal noChallenge alive backed noCooldown {
        if (newPrice > price) {
            _restrictMinting(3 days);
        } else {
            _checkCollateral(_collateralBalance(), newPrice);
        }
        _setPrice(newPrice, principal + availableForMinting());
    }

    function _setPrice(uint256 newPrice, uint256 bounds) internal {
        uint256 colBalance = _collateralBalance();
        if (block.timestamp >= start && newPrice > 2 * price) {
            revert PriceTooHigh(newPrice, 2 * price);
        }
        if (newPrice * colBalance > bounds * ONE_DEC18) {
            revert PriceTooHigh(newPrice, (bounds * ONE_DEC18) / colBalance);
        }
        price = newPrice;
    }

    function _collateralBalance() internal view returns (uint256) {
        return IERC20(collateral).balanceOf(address(this));
    }

    /**
     * @notice Mint jusd as long as there is no open challenge, the position is not subject to a cooldown,
     * and there is sufficient collateral.
     */
    function mint(address target, uint256 amount) public ownerOrRoller {
        uint256 collateralBalance = _collateralBalance();
        _mint(target, amount, collateralBalance);
        emit MintingUpdate(collateralBalance, price, principal);
    }

    /**
     * @notice Returns the virtual price of the collateral in JUSD.
     */
    function virtualPrice() public view returns (uint256) {
        return _virtualPrice(_collateralBalance(), price);
    }

    /**
     * @notice Computes the virtual price of the collateral in JUSD, which is the minimum collateral
     * price required to cover the entire debt with interest overcollateralization, lower bounded by the floor price. 
     * Returns the challenged price if a challenge is active.
     * @param colBalance The collateral balance of the position.
     * @param floorPrice The minimum price of the collateral in JUSD.
     */
    function _virtualPrice(uint256 colBalance, uint256 floorPrice) internal view returns (uint256) {
        if (challengedAmount > 0) return challengedPrice;
        if (colBalance == 0) return floorPrice;
        
        uint256 virtPrice = (_getCollateralRequirement() * ONE_DEC18) / colBalance;
        return virtPrice < floorPrice ? floorPrice: virtPrice;
    }

    /**
     * @notice Fixes the annual rate to the current leadrate plus the risk premium.
     * This re-prices the entire position based on the current leadrate.
     */
    function _fixRateToLeadrate(uint24 _riskPremiumPPM) internal {
        fixedAnnualRatePPM = IMintingHub(hub).RATE().currentRatePPM() + _riskPremiumPPM;
    }

    /**
     * @notice Accrues interest on the principal amount since the last accrual time.
     * @return newInterest The total outstanding interest to be paid.
     */
    function _accrueInterest() internal returns (uint256 newInterest) {
        newInterest = _calculateInterest();

        if (newInterest > interest) {
            interest = newInterest;
        }

        lastAccrual = uint40(block.timestamp);
    }

    /**
     * @notice Computes the total outstanding interest, including newly accrued interest.
     * @dev This function calculates interest accumulated since the last accrual based on
     * the principal amount, the annual interest rate, and the elapsed time.
     * The newly accrued interest is added to the current outstanding interest.
     * @return newInterest The total outstanding interest, including newly accrued interest.
     */
    function _calculateInterest() internal view returns (uint256 newInterest) {
        uint256 timestamp = block.timestamp;
        newInterest = interest;

        if (timestamp > lastAccrual && principal > 0) {
            uint256 delta = timestamp - lastAccrual;
            newInterest += (principal * fixedAnnualRatePPM * delta) / (365 days * 1_000_000);
        }

        return newInterest;
    }

    /**
     * @notice Calculates the current debt (principal + accrued interest)
     * @return Total debt without interest overcollateralization
     */
    function _getDebt() internal view returns (uint256) {
        return principal + _calculateInterest();
    }

    /**
     * @notice Calculates total debt accounting for interest overcollateralization
     * @return Total debt including overcollateralized interest
     */
    function _getCollateralRequirement() internal view returns (uint256) {
        return principal + _ceilDivPPM(_calculateInterest(), reserveContribution);
    }

    /**
     * @notice Public function to calculate current debt
     * @return The total current debt (principal + current accrued interest)
     */
    function getDebt() public view returns (uint256) {
        return _getDebt();
    }
    
    /**
     * @notice Public function to calculate current debt with overcollateralized interest
     * @return The total debt including overcollateralized interest
     */
    function getCollateralRequirement() public view returns (uint256) {
        return _getCollateralRequirement();
    }

    /**
     * @notice Public function to get the current outstanding interest
     */
    function getInterest() public view returns (uint256) {
        return _calculateInterest();
    }

    function _mint(address target, uint256 amount, uint256 collateral_) internal noChallenge noCooldown alive backed {
        if (amount > availableForMinting()) revert LimitExceeded(amount, availableForMinting());

        _accrueInterest(); // accrue interest
        _fixRateToLeadrate(riskPremiumPPM); // sync interest rate with leadrate

        Position(original).notifyMint(amount);
        jusd.mintWithReserve(target, amount, reserveContribution);

        principal += amount;
        _checkCollateral(collateral_, price);
    }

    function _restrictMinting(uint40 period) internal {
        uint40 horizon = uint40(block.timestamp) + period;
        if (horizon > cooldown) {
            cooldown = horizon;
        }
    }

    /**
     * @notice Repays a specified amount of debt from `msg.sender`, prioritizing accrued interest first and then principal.
     * @dev This method integrates the logic of paying accrued interest before principal, as introduced in the continuous
     *      interest accrual model. Any interest repaid is collected as profit, and principal repayment uses `burnFromWithReserve`.
     *
     *      Unlike previous implementations, this function delegates the actual repayment steps to `_payDownDebt`, ensuring
     *      a clean separation of logic. As a result:
     *      - Any surplus `amount` beyond what is needed to pay all outstanding interest and principal is never withdrawn
     *        from `msg.sender`’s account (no leftover handling required).
     *      - The function can be called while there are challenges, though in that scenario, collateral withdrawals remain
     *        blocked until all challenges are resolved.
     *
     *      To fully close the position (bring `debt` to 0), the amount required generally follows the formula:
     *      `debt = principal + interest`. Under normal conditions, this simplifies to:
     *      `amount = (principal * (1000000 - reservePPM)) / 1000000 + interest`.
     *
     *      For example, if `principal` is 40, `interest` is 10, and `reservePPM` is 200000, repaying 42 JUSD
     *      is required to fully close the position.
     *
     * @param amount The maximum amount of JUSD that `msg.sender` is willing to repay.
     * @return used  The actual amount of JUSD used for interest and principal repayment.
     *
     * Emits a {MintingUpdate} event.
     */
    function repay(uint256 amount) public returns (uint256) {
        uint256 used = _payDownDebt(amount);
        emit MintingUpdate(_collateralBalance(), price, principal);
        return used;
    }

    function repayFull() external returns (uint256) {
        return repay(principal + _accrueInterest());
    }

    /**
     * @notice Updates oustanding principal and notifies the original position that a portion of the total
     * minted has been repaid.
     */
    function _notifyRepaid(uint256 amount) internal {
        if (amount > principal) revert RepaidTooMuch(amount - principal);
        Position(original).notifyRepaid(amount);
        principal -= amount;
    }

    /**
     * @notice Updates outstanding interest and notifies the minting hub gateway that interest has been paid.
     */
    function _notifyInterestPaid(uint256 amount) internal {
        if (amount > interest) revert RepaidTooMuch(amount - interest);
        if (IERC165(hub).supportsInterface(type(IMintingHubGateway).interfaceId)) {
            IMintingHubGateway(hub).notifyInterestPaid(amount);
        }
        interest -= amount;
    }

    /**
     * @notice Forcefully sells some of the collateral after the position has expired, using the given buyer as the source of proceeds.
     * @dev
     * - Can only be called by the minting hub once the position is expired.
     * - Requires that there are no open challenges, ensuring that a forced sale is not used to circumvent the challenge process.
     * - The proceeds from the sale are first used to repay any accrued interest (treated as profit, collected via `collectProfits`),
     *   and then the principal (via `burnFromWithReserve`). This ensures correct accounting, where interest is always realized as profit before principal is returned.
     * - If all debt is fully repaid and there are surplus proceeds, these are transferred to the position owner.
     * - If there is a shortfall (not enough proceeds to fully repay the debt) and no remaining collateral, the system covers the loss.
     *
     * Do not allow a forced sale as long as there is an open challenge. Otherwise, a forced sale by the owner
     * himself could remove any incentive to launch challenges shortly before the expiration. (CS-ZCHF2-001)
     *
     * @param buyer         The address buying the collateral. This address provides `proceeds` in JUSD to repay the outstanding debt.
     * @param colAmount     The amount of collateral to be forcibly sold and transferred to the `buyer`.
     * @param proceeds      The amount of JUSD proceeds provided by the `buyer` to repay the outstanding debt.
     *
     * Emits a {MintingUpdate} event indicating the updated collateral balance, price, and debt after the forced sale.
     */
    function forceSale(address buyer, uint256 colAmount, uint256 proceeds) external onlyHub expired noChallenge {
        uint256 debt = principal + _accrueInterest();
        uint256 remainingCollateral = _sendCollateral(buyer, colAmount); // Send collateral to buyer

        // No debt, everything goes to owner if proceeds > 0
        if (debt == 0) {
            if (proceeds > 0) {
                jusd.transferFrom(buyer, owner(), proceeds);
            }
            emit MintingUpdate(_collateralBalance(), price, principal);
            return;
        }

        // Note: A postcondition of _repayPrincipalNet is `principal + interest > 0 => proceeds == 0` (see assert below).
        proceeds = _repayInterest(buyer, proceeds);
        proceeds = _repayPrincipalNet(buyer, proceeds);

        // If remaining collateral is 0 and `principal + interest` > 0, cover the shortfall with the system.
        if (remainingCollateral == 0 && principal + interest > 0) {
            assert(proceeds == 0);
            jusd.coverLoss(address(this), principal + interest);
            if (interest > 0) {
                jusd.collectProfits(address(this), interest);
                _notifyInterestPaid(interest);
            }
            jusd.burnWithoutReserve(principal, reserveContribution);
            _notifyRepaid(principal);
        } else if (proceeds > 0) {
            // All debt paid, leftover proceeds is profit for owner
            jusd.transferFrom(buyer, owner(), proceeds);
        }

        emit MintingUpdate(_collateralBalance(), price, principal);
    }

    /**
     * @notice Withdraw any ERC20 token that might have ended up on this address.
     * Withdrawing collateral is subject to the same restrictions as withdrawCollateral(...).
     */
    function withdraw(address token, address target, uint256 amount) external onlyOwner {
        if (token == address(collateral)) {
            withdrawCollateral(target, amount);
        } else {
            uint256 balance = _collateralBalance();
            IERC20(token).transfer(target, amount);
            require(balance == _collateralBalance()); // guard against double-entry-point tokens
        }
    }

    /**
     * @notice Withdraw collateral from the position up to the extent that it is still well collateralized afterwards.
     * Not possible as long as there is an open challenge or the contract is subject to a cooldown.
     *
     * Withdrawing collateral below the minimum collateral amount formally closes the position.
     */
    function withdrawCollateral(address target, uint256 amount) public ownerOrRoller {
        uint256 balance = _withdrawCollateral(target, amount);
        emit MintingUpdate(balance, price, principal);
    }

    function _withdrawCollateral(address target, uint256 amount) internal noCooldown noChallenge returns (uint256) {
        uint256 balance = _sendCollateral(target, amount);
        _checkCollateral(balance, price);
        return balance;
    }

    /**
     * @notice Transfer the challenged collateral to the bidder. Only callable by minting hub.
     */
    function transferChallengedCollateral(address target, uint256 amount) external onlyHub {
        uint256 newBalance = _sendCollateral(target, amount);
        emit MintingUpdate(newBalance, price, principal);
    }

    function _sendCollateral(address target, uint256 amount) internal returns (uint256) {
        // Some weird tokens fail when trying to transfer 0 amounts
        if (amount > 0) {
            IERC20(collateral).transfer(target, amount);
        }
        uint256 balance = _collateralBalance();
        if (balance < minimumCollateral) {
            _close();
        }
        return balance;
    }

    /**
     * @notice This invariant must always hold and must always be checked when any of the three
     * variables change in an adverse way. Ensures that the position overcollateralizes interest
     * by the same percentage as the reserve contribution.
     */
    function _checkCollateral(uint256 collateralReserve, uint256 atPrice) internal view {
        uint256 relevantCollateral = collateralReserve < minimumCollateral ? 0 : collateralReserve;
        uint256 collateralRequirement = _getCollateralRequirement();
        
        if (relevantCollateral * atPrice < collateralRequirement * ONE_DEC18) {
            revert InsufficientCollateral(relevantCollateral * atPrice, collateralRequirement * ONE_DEC18);
        }
    }

    /**
     * @notice Repays a specified amount of debt from `msg.sender`, prioritizing accrued interest first and then principal.
     * @return The actual amount of JUSD used for interest and principal repayment.
     */
    function _payDownDebt(uint256 amount) internal returns (uint256) {
        _accrueInterest();
        if (amount == 0) return 0;

        uint256 remaining = amount;
        remaining = _repayInterest(msg.sender, remaining); // Repay interest
        remaining = _repayPrincipal(msg.sender, remaining); // Repay principal

        return amount - remaining;
    }

    /**
     * @notice Repays a specified amount of interest from `msg.sender`.
     * @dev Assumes that _accrueInterest has been called before this function.
     * @return `amount` remaining after interest repayment.
     */
    function _repayInterest(address payer, uint256 amount) internal returns (uint256) {
        uint256 repayment = (interest > amount) ? amount : interest;
        if (repayment > 0) {
            jusd.collectProfits(payer, repayment);
            _notifyInterestPaid(repayment);
            return amount - repayment;
        }
        return amount;
    }

    /**
     * @notice Repays a specified amount of principal from `msg.sender`.
     * @param payer The address of the entity repaying the debt.
     * @param amount The repayment amount, including the reserve portion.
     * @return amount remaining after principal repayment
     */
    function _repayPrincipal(address payer, uint256 amount) internal returns (uint256) {
        uint256 repayment = (principal > amount) ? amount : principal;
        if (repayment > 0) {
            uint256 returnedReserve = jusd.burnFromWithReserve(payer, repayment, reserveContribution);
            _notifyRepaid(repayment);
            return amount - (repayment - returnedReserve);
        }
        return amount;
    }

    /**
     * @notice Repays principal from `payer` using the net repayment amount (excluding reserves).
     * To repay an exact amount including reserves, use `_repayPrincipal(address payer, uint256 amount)`.
     *
     * @param payer The address of the entity repaying the debt.
     * @param amount The repayment amount, excluding the reserve portion, i.e. the net amount.
     * @return amount remaining after principal repayment.
     */
    function _repayPrincipalNet(address payer, uint256 amount) internal returns (uint256) {
        uint256 availableReserve = jusd.calculateAssignedReserve(principal, reserveContribution);
        uint256 maxRepayment = principal - availableReserve;
        uint256 repayment = amount > maxRepayment ? maxRepayment : amount;
        if (repayment > 0) {
            uint256 freedAmount = jusd.calculateFreedAmount(repayment, reserveContribution);
            uint256 returnedReserve = jusd.burnFromWithReserve(payer, freedAmount, reserveContribution);
            assert(returnedReserve == freedAmount - repayment);
            _notifyRepaid(freedAmount);
            return amount - repayment;
        }
        return amount;
    }

    /**
     * @notice Returns the liquidation price and the durations for phase1 and phase2 of the challenge.
     * Both phases are usually of equal duration, but near expiration, phase one is adjusted such that
     * it cannot last beyond the expiration date of the position.
     */
    function challengeData() external view returns (uint256 liqPrice, uint40 phase) {
        return (_virtualPrice(_collateralBalance(), price), challengePeriod);
    }

    function notifyChallengeStarted(uint256 size, uint256 _price) external onlyHub alive {
        // Require minimum size. Collateral balance can be below minimum if it was partially challenged before.
        if (size < minimumCollateral && size < _collateralBalance()) revert ChallengeTooSmall();
        if (size == 0) revert ChallengeTooSmall();

        if (challengedAmount == 0) challengedPrice = _price;
        challengedAmount += size;
    }

    /**
     * @param size amount of collateral challenged (dec18)
     */
    function notifyChallengeAverted(uint256 size) external onlyHub {
        challengedAmount -= size;

        // Don't allow minter to close the position immediately so challenge can be repeated before
        // the owner has a chance to mint more on an undercollateralized position
        _restrictMinting(1 days);
    }

    /**
     * @notice Notifies the position that a challenge was successful.
     * Everything else is assumed to be handled by the hub.
     *
     * @param _size amount of the collateral bid for
     * @return (position owner, effective challenge size in jusd, amount of principal to repay, amount of interest to pay, reserve ppm)
     */
    function notifyChallengeSucceeded(
        uint256 _size
    ) external onlyHub returns (address, uint256, uint256, uint256, uint32) {
        _accrueInterest();

        challengedAmount -= _size;
        uint256 colBal = _collateralBalance();
        if (colBal < _size) {
            _size = colBal;
        }

        // Determine how much of the debt must be repaid based on challenged collateral
        uint256 interestToPay = (colBal == 0) ? 0 : (interest * _size) / colBal;
        uint256 principalToPay = (colBal == 0) ? 0 : (principal * _size) / colBal;
        _notifyInterestPaid(interestToPay);
        _notifyRepaid(principalToPay);

        // Give time for additional challenges before the owner can mint again.
        _restrictMinting(3 days);

        return (owner(), _size, principalToPay, interestToPay, reserveContribution);
    }
}
