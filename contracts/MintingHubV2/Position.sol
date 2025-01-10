// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IMintingHubGateway} from "../gateway/interface/IMintingHubGateway.sol";
import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
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
     * @notice The deuro price per unit of the collateral below which challenges succeed, (36 - collateral.decimals) decimals
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
     * @notice The Eurocoin contract.
     */
    IDecentralizedEURO public immutable deuro;

    /**
     * @notice The collateral token.
     */
    IERC20 public immutable override collateral;

    /**
     * @notice Minimum acceptable collateral amount to prevent dust.
     */
    uint256 public immutable override minimumCollateral;

    /**
     * @notice The interest in parts per million per year that is deducted when minting dEURO.
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
     * @notice The total interest accrued but not yet paid.
     */
    uint256 public accruedInterest;

    /**
     * @notice The timestamp of the last interest accrual update.
     */
    uint40 public lastAccrual;

    event MintingUpdate(uint256 collateral, uint256 price, uint256 minted);
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
     * @param _riskPremiumPPM       ppm of minted amount that is added to the applicable minting fee as a risk premium
     */
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
        require(_initPeriod >= 3 days); // must be at least three days, recommended to use higher values
        original = address(this);
        hub = _hub;
        deuro = IDecentralizedEURO(_deuro);
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
        _fixRateToLeadrate();
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
        fixedAnnualRatePPM = Position(parent).fixedAnnualRatePPM();
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
        if (deuro.getPositionParent(msg.sender) != hub) revert NotHub();
        totalMinted += mint_;
    }

    function notifyRepaid(uint256 repaid_) external {
        if (deuro.getPositionParent(msg.sender) != hub) revert NotHub();
        totalMinted -= repaid_;
    }

    /**
     * Should only be called on the original position.
     * Better use 'availableForMinting'.
     */
    function availableForClones() external view returns (uint256) {
        // reserve capacity for the original to the extent the owner provided collateral
        uint256 debt = principal + accruedInterest;
        uint256 potential = (_collateralBalance() * price) / ONE_DEC18;
        uint256 unusedPotential = debt > potential ? 0 : potential - debt;
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
        IReserve(deuro.reserve()).checkQualified(msg.sender, helpers);
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
     * @notice This is how much the minter can actually use when minting deuro, with the rest being assigned
     * to the minter reserve.
     */
    function getUsableMint(uint256 totalMint) public view returns (uint256) {
        return (totalMint * (1000_000 - reserveContribution)) / 1000_000;
    }

    /**
     * Returns the corresponding mint amount (disregarding the limit).
     */
    function getMintAmount(uint256 usableMint) external view returns (uint256) {
        return
            usableMint == 0
                ? 0
                : (usableMint * 1000_000 - 1) / (1000_000 - reserveContribution) + 1;
    }

    /**
     * @notice "All in one" function to adjust the outstanding amount of deuro, the collateral amount,
     * and the price in one transaction.
     */
    function adjust(uint256 newDebt, uint256 newCollateral, uint256 newPrice) external onlyOwner {
        uint256 debt = _accrueInterest();
        uint256 colbal = _collateralBalance();
        if (newCollateral > colbal) {
            collateral.transferFrom(msg.sender, address(this), newCollateral - colbal);
        }
        // Must be called after collateral deposit, but before withdrawal
        if (newDebt < debt) {
            _payDownDebt(msg.sender, debt - newDebt);
        }
        if (newCollateral < colbal) {
            _withdrawCollateral(msg.sender, colbal - newCollateral);
        }
        // Must be called after collateral withdrawal
        if (newDebt > debt) {
            _mint(msg.sender, newDebt - debt, newCollateral);
        }
        if (newPrice != price) {
            _adjustPrice(newPrice);
        }
        emit MintingUpdate(newCollateral, newPrice, newDebt);
    }

    /**
     * @notice Allows the position owner to adjust the liquidation price as long as there is no pending challenge.
     * Lowering the liquidation price can be done with immediate effect, given that there is enough collateral.
     * Increasing the liquidation price triggers a cooldown period of 3 days, during which minting is suspended.
     */
    function adjustPrice(uint256 newPrice) public onlyOwner {
        _adjustPrice(newPrice);
        emit MintingUpdate(_collateralBalance(), price, principal + accruedInterest);
    }

    function _adjustPrice(uint256 newPrice) internal noChallenge alive backed {
        if (newPrice > price) {
            _restrictMinting(3 days);
        } else {
            _checkCollateral(_collateralBalance(), newPrice);
        }
        _setPrice(newPrice, principal + accruedInterest + availableForMinting());
    }

    function _setPrice(uint256 newPrice, uint256 bounds) internal {
        require(newPrice * minimumCollateral <= bounds * ONE_DEC18); // sanity check
        price = newPrice;
    }

    function _collateralBalance() internal view returns (uint256) {
        return IERC20(collateral).balanceOf(address(this));
    }

    /**
     * @notice Mint deuro as long as there is no open challenge, the position is not subject to a cooldown,
     * and there is sufficient collateral.
     */
    function mint(address target, uint256 amount) public ownerOrRoller {
        uint256 debt = _accrueInterest();
        uint256 collateralBalance = _collateralBalance();
        _mint(target, amount, collateralBalance);
        emit MintingUpdate(collateralBalance, price, debt);
    }


    /**
     * @notice Fixes the annual rate to the current leadrate plus the risk premium.
     * This re-prices the entire position based on the current leadrate.
     */
    function _fixRateToLeadrate() internal {
        fixedAnnualRatePPM = IMintingHubGateway(hub).RATE().currentRatePPM() + riskPremiumPPM;
    }

    /**
     * @notice Accrues interest on the principal amount since the last accrual time.
     * 
     * This function calculates the interest based on the time elapsed since the last accrual,
     * the principal amount, and the annual interest rate. The calculated interest is then added
     * to the accrued interest and the total minted amount is updated.
     */
    function _accrueInterest() internal returns (uint256 debt) {
        uint40 nowTime = uint40(block.timestamp);
        debt = _getDebtAtTime(nowTime);

        if (debt - principal > accruedInterest) {
            accruedInterest = debt - principal;
        }

        lastAccrual = nowTime;
    }

    /**
     * @notice Internal helper to calculate debt based on a given timestamp
     * @param currentTime The current block timestamp for calculation
     * @return The total debt (principal + interest accrued up to currentTime)
     */
    function _getDebtAtTime(uint40 currentTime) internal view returns (uint256) {
        uint256 interest = accruedInterest;

        if (currentTime > lastAccrual && principal > 0) {
            uint256 delta = currentTime - lastAccrual;
            interest += (principal * fixedAnnualRatePPM * delta) / (365 days * 1_000_000);
        }

        return principal + interest;
    }

    /**
     * @notice Public function to calculate current debt without modifying state
     * @return The total current debt (principal + accrued interest up to now)
     */
    function getDebt() public view returns (uint256) {
        return _getDebtAtTime(uint40(block.timestamp));
    }

    function _mint(address target, uint256 amount, uint256 collateral_) internal noChallenge noCooldown alive backed {
        if (amount > availableForMinting()) revert LimitExceeded(amount, availableForMinting());

        _fixRateToLeadrate();

        Position(original).notifyMint(amount);
        deuro.mintWithReserve(target, amount, reserveContribution, 0);

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
    *      interest accrual model. Any interest repaid is collected as profit, and principal repayment uses `burnWithReserve`.
    * 
    *      Unlike previous implementations, this function delegates the actual repayment steps to `_payDownDebt`, ensuring
    *      a clean separation of logic. As a result:
    *      - Any surplus `amount` beyond what is needed to pay all outstanding interest and principal is never withdrawn 
    *        from `msg.sender`’s account (no leftover handling required).
    *      - The function can be called while there are challenges, though in that scenario, collateral withdrawals remain 
    *        blocked until all challenges are resolved.
    * 
    *      To fully close the position (bring `minted` to 0), the amount required generally follows the formula:
    *      `minted = principal + accruedInterest + deuro.calculateAssignedReserve(principal + accruedInterest, reservePPM)`.
    *      Under normal conditions, this simplifies to:
    *      `amount = (principal + accruedInterest) * (1000000 - reservePPM) / 1000000`.
    * 
    *      For example, if `principal` is 40, `accruedInterest` is 10, and `reservePPM` is 200000, repaying 40 dEURO 
    *      is required to fully close the position.
    * 
    * @param amount The maximum amount of dEURO that `msg.sender` is willing to repay.
    * @return used  The actual amount of dEURO used for interest and principal repayment.
    * 
    * Emits a {MintingUpdate} event.
    */
    function repay(uint256 amount) public returns (uint256) {
        uint256 used = _payDownDebt(msg.sender, amount);
        emit MintingUpdate(_collateralBalance(), price, principal + accruedInterest);
        return used;
    }

    function repayFull() external returns (uint256) {
        return repay(_accrueInterest());
    }

    /**
     * @notice Notifies the original position that a portion of the debt (principal) has been repaid.
     */
    function _notifyRepaid(uint256 amount) internal {
        Position(original).notifyRepaid(amount);
    }

    /**
     * @notice Forcefully sells some of the collateral after the position has expired, using the given buyer as the source of proceeds.
     * @dev
     * - Can only be called by the minting hub once the position is expired.
     * - Requires that there are no open challenges, ensuring that a forced sale is not used to circumvent the challenge process.
     * - The proceeds from the sale are first used to repay any accrued interest (treated as profit, collected via `collectProfits`),
     *   and then the principal (via `burnWithReserve`). This ensures correct accounting, where interest is always realized as profit before principal is returned.
     * - If all debt is fully repaid and there are surplus proceeds, these are transferred to the position owner.
     * - If there is a shortfall (not enough proceeds to fully repay the debt) and no remaining collateral, the system covers the loss.
     *
     * Do not allow a forced sale as long as there is an open challenge. Otherwise, a forced sale by the owner
     * himself could remove any incentive to launch challenges shortly before the expiration. (CS-ZCHF2-001)
     *
     * In the old model, `forceSale` would rely on `calculateAssignedReserve` and treat `minted` as a lump sum including principal, reserve, and fees.
     * Now, with principal and interest separated, `forceSale` no longer needs manual calculation of reserves. Instead, it uses `burnWithReserve` 
     * to handle the principal and reserve portions automatically.
     *
     * @param buyer       The address buying the collateral. This address provides `proceeds` in dEURO to repay the outstanding debt.
     * @param collAmount  The amount of collateral to be forcibly sold and transferred to the `buyer`.
     * @param proceeds    The amount of dEURO proceeds provided by the `buyer` to repay interest and principal.
     *
     * Emits a {MintingUpdate} event indicating the updated collateral balance, price, and minted amount after the forced sale.
     */
    function forceSale(address buyer, uint256 collAmount, uint256 proceeds) external onlyHub expired noChallenge {
        uint256 debt = _accrueInterest(); // ensure latest state

        // send collateral to buyer
        uint256 remainingCollateral = _sendCollateral(buyer, collAmount);

        if (debt == 0) {
            // No debt, everything goes to owner if proceeds > 0
            if (proceeds > 0) {
                deuro.transferFrom(buyer, owner(), proceeds);
            }
            emit MintingUpdate(_collateralBalance(), price, debt);
            return;
        }

        // Pay down debt from `buyer` up to `proceeds`.
        uint256 used = _payDownDebt(buyer, proceeds);
        uint256 leftover = proceeds > used ? (proceeds - used) : 0;
        debt = used > debt ? 0 : debt - used;

        if (debt == 0 && leftover > 0) {
            // All debt paid, leftover is profit for owner
            deuro.transferFrom(buyer, owner(), leftover);
        } else if (debt > 0 && remainingCollateral == 0) {
            uint256 deficit = debt;
            // Shortfall scenario, cover the loss if needed
            deuro.coverLoss(buyer, deficit);
            _payDownDebt(buyer, deficit);
        }

        emit MintingUpdate(_collateralBalance(), price, debt);
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
        emit MintingUpdate(balance, price, principal + accruedInterest);
    }

    function _withdrawCollateral(address target, uint256 amount) internal noChallenge returns (uint256) {
        if (block.timestamp <= cooldown) revert Hot();
        uint256 balance = _sendCollateral(target, amount);
        _checkCollateral(balance, price);
        return balance;
    }

    function _sendCollateral(address target, uint256 amount) internal returns (uint256) {
        if (amount > 0) {
            // Some weird tokens fail when trying to transfer 0 amounts
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
     * variables change in an adverse way.
     */
    function _checkCollateral(uint256 collateralReserve, uint256 atPrice) internal view {
        uint256 relevantCollateral = collateralReserve < minimumCollateral ? 0 : collateralReserve;
        if (relevantCollateral * atPrice < principal * ONE_DEC18) {
            revert InsufficientCollateral(relevantCollateral * atPrice, principal * ONE_DEC18);
        }
    }

    function _notifyInterestPaid(uint256 amount) internal {
        if (IERC165(hub).supportsInterface(type(IMintingHubGateway).interfaceId)) {
            IMintingHubGateway(hub).notifyInterestPaid(amount);
        }
    }

    function _payDownDebt(address payer, uint256 amount) internal returns (uint256 repaidAmount) {
        uint256 debt = _accrueInterest(); // ensure principal, accruedInterest, minted are up-to-date

        if (amount == 0) {
            return 0;
        }

        uint256 remaining = amount > debt ? debt : amount;
        IERC20(deuro).transferFrom(payer, address(this), remaining);
        repaidAmount = 0;

        // 1) Pay accrued interest first
        if (accruedInterest > 0) {
            uint256 interestToPay = (accruedInterest > remaining) ? remaining : accruedInterest;
            if (interestToPay > 0) {
                deuro.collectProfits(address(this), interestToPay);
                _notifyInterestPaid(interestToPay);
                accruedInterest -= interestToPay;
                remaining -= interestToPay;
                repaidAmount += interestToPay;
            }
        }

        // 2) Pay principal next
        if (principal > 0 && remaining > 0) {
            uint256 principalToPay = (principal > remaining) ? remaining : principal;
            if (principalToPay > 0) {
                uint256 reservePortion = deuro.calculateAssignedReserve(principalToPay, reserveContribution);
                uint256 repaid = deuro.burnWithReserve(principalToPay - reservePortion, reserveContribution);
                principal -= principalToPay;
                remaining -= principalToPay;
                repaidAmount += principalToPay;
                _notifyRepaid(repaid);
            }
        }
    }

    /**
     * @notice Returns the liquidation price and the durations for phase1 and phase2 of the challenge.
     * Both phases are usually of equal duration, but near expiration, phase one is adjusted such that
     * it cannot last beyond the expiration date of the position.
     */
    function challengeData() external view returns (uint256 liqPrice, uint40 phase) {
        return (price, challengePeriod);
    }

    function notifyChallengeStarted(uint256 size) external onlyHub alive {
        // Require minimum size. Collateral balance can be below minimum if it was partially challenged before.
        if (size < minimumCollateral && size < _collateralBalance()) revert ChallengeTooSmall();
        if (size == 0) revert ChallengeTooSmall();
        challengedAmount += size;
    }

    /**
     * @param size   amount of collateral challenged (dec18)
     */
    function notifyChallengeAverted(uint256 size) external onlyHub {
        challengedAmount -= size;

        // Don't allow minter to close the position immediately so challenge can be repeated before
        // the owner has a chance to mint more on an undercollateralized position
        _restrictMinting(1 days);
    }

    /**
     * @notice Notifies the position that a challenge was successful.
     * Triggers the payout of the challenged part of the collateral.
     * Everything else is assumed to be handled by the hub.
     *
     * @param _bidder address of the bidder that receives the collateral
     * @param _size   amount of the collateral bid for
     * @return (position owner, effective challenge size in deuro, amount to be repaid, reserve ppm)
     */
    function notifyChallengeSucceeded(
        address _bidder,
        uint256 _size
    ) external onlyHub returns (address, uint256, uint256, uint32) {
        uint256 debt = _accrueInterest();

        challengedAmount -= _size;
        uint256 colBal = _collateralBalance();
        if (colBal < _size) {
            _size = colBal;
        }

        // Determine how much must be repaid based on challenged collateral
        uint256 repayment = (colBal == 0) ? 0 : (debt * _size) / colBal;

        // First account for paid down accrued interest, then principal
        repayment -= (accruedInterest > repayment) ? repayment : accruedInterest;
        repayment = (principal > repayment) ? repayment : principal;
        _notifyRepaid(repayment);

        // Transfer the challenged collateral to the bidder
        uint256 newBalance = _sendCollateral(_bidder, _size);
        emit MintingUpdate(newBalance, price, debt);

        // Give time for additional challenges before the owner can mint again.
        _restrictMinting(3 days);

        return (owner(), _size, repayment, reserveContribution);
    }
}
