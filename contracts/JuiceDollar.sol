// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Equity} from "./Equity.sol";
import {IJuiceDollar} from "./interface/IJuiceDollar.sol";
import {IReserve} from "./interface/IReserve.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {ERC3009} from "./impl/ERC3009.sol";

/**
 * @title JuiceDollar
 * @notice The JuiceDollar (JUSD) is an ERC-20 token that is designed to track the value of the Dollar.
 * It is not upgradable, but open to arbitrary minting plugins. These are automatically accepted if none of the
 * qualified pool shareholders casts a veto, leading to a flexible but conservative governance.
 */
contract JuiceDollar is ERC20Permit, ERC3009, IJuiceDollar, ERC165 {
    /**
     * @notice Minimal fee and application period when suggesting a new minter.
     */
    uint256 public constant MIN_FEE = 1000 * (10 ** 18);
    uint256 public immutable MIN_APPLICATION_PERIOD; // For example: 10 days

    /**
     * @notice The contract that holds the reserve.
     */
    IReserve public immutable override reserve;

    /**
     * @notice How much of the reserve belongs to the minters. Everything else belongs to the pool shareholders.
     * Stored with 6 additional digits of accuracy so no rounding is necessary when dealing with parts per
     * million (ppm) in reserve calculations.
     */
    uint256 private minterReserveE6;

    /**
     * @notice Map of minters to approval time stamps. If the time stamp is in the past, the minter contract is allowed
     * to mint JuiceDollars.
     */
    mapping(address minter => uint256 validityStart) public minters;

    /**
     * @notice List of positions that are allowed to mint and the minter that registered them.
     */
    mapping(address position => address registeringMinter) public positions;

    event MinterApplied(address indexed minter, uint256 applicationPeriod, uint256 applicationFee, string message);
    event MinterDenied(address indexed minter, string message);
    event Loss(address indexed reportingMinter, uint256 amount);
    event Profit(address indexed reportingMinter, uint256 amount);
    event ProfitDistributed(address indexed recipient, uint256 amount);

    error PeriodTooShort();
    error FeeTooLow();
    error AlreadyRegistered();
    error NotMinter();
    error TooLate();

    modifier minterOnly() {
        if (!isMinter(msg.sender) && !isMinter(positions[msg.sender])) revert NotMinter();
        _;
    }

    /**
     * @notice Initiates the JuiceDollar with the provided minimum application period for new plugins
     * in seconds, for example 10 days, i.e. 3600*24*10 = 864000
     */
    constructor(uint256 _minApplicationPeriod) ERC20Permit("Juice Dollar") ERC20("Juice Dollar", "JUSD") {
        MIN_APPLICATION_PERIOD = _minApplicationPeriod;
        reserve = new Equity(this);
    }

    function initialize(address _minter, string calldata _message) external {
        require(totalSupply() == 0 && reserve.totalSupply() == 0);
        minters[_minter] = block.timestamp;
        emit MinterApplied(_minter, 0, 0, _message);
    }

    /**
     * @notice Publicly accessible method to suggest a new way of minting JuiceDollar.
     * @dev The caller has to pay an application fee that is irrevocably lost even if the new minter is vetoed.
     * The caller must assume that someone will veto the new minter unless there is broad consensus that the new minter
     * adds value to the JuiceDollar system. Complex proposals should have application periods and applications fees
     * above the minimum. It is assumed that over time, informal ways to coordinate on new minters will emerge. The message
     * parameter might be useful for initiating further communication. Maybe it contains a link to a website describing
     * the proposed minter.
     *
     * @param _minter              An address that is given the permission to mint JuiceDollars
     * @param _applicationPeriod   The time others have to veto the suggestion, at least MIN_APPLICATION_PERIOD
     * @param _applicationFee      The fee paid by the caller, at least MIN_FEE
     * @param _message             An optional human readable message to everyone watching this contract
     */
    function suggestMinter(
        address _minter,
        uint256 _applicationPeriod,
        uint256 _applicationFee,
        string calldata _message
    ) external override {
        if (_applicationPeriod < MIN_APPLICATION_PERIOD) revert PeriodTooShort();
        if (_applicationFee < MIN_FEE) revert FeeTooLow();
        if (minters[_minter] != 0) revert AlreadyRegistered();
        _collectProfits(address(this), msg.sender, _applicationFee);
        minters[_minter] = block.timestamp + _applicationPeriod;
        emit MinterApplied(_minter, _applicationPeriod, _applicationFee, _message);
    }

    /**
     * @notice Make the system more user friendly by skipping the allowance in many cases.
     * @dev We trust minters and the positions they have created to mint and burn as they please, so
     * giving them arbitrary allowances does not pose an additional risk.
     */
    function allowance(address owner, address spender) public view override(IERC20, ERC20) returns (uint256) {
        uint256 explicit = super.allowance(owner, spender);
        if (explicit > 0) {
            return explicit; // don't waste gas checking minter
        }

        if (spender == address(reserve)) {
            return type(uint256).max;
        }

        if (
            (isMinter(spender) || isMinter(getPositionParent(spender))) &&
            (isMinter(owner) || positions[owner] != address(0) || owner == address(reserve))
        ) {
            return type(uint256).max;
        }

        return 0;
    }

    /**
     * @notice The reserve provided by the owners of collateralized positions.
     * @dev The minter reserve can be used to cover losses after the equity holders have been wiped out.
     */
    function minterReserve() public view returns (uint256) {
        return minterReserveE6 / 1_000_000;
    }

    /**
     * @notice Allows minters to register collateralized debt positions, thereby giving them the ability to mint JuiceDollars.
     * @dev It is assumed that the responsible minter that registers the position ensures that the position can be trusted.
     */
    function registerPosition(address _position) external override {
        if (!isMinter(msg.sender)) revert NotMinter();
        positions[_position] = msg.sender;
    }

    /**
     * @notice The amount of equity of the JuiceDollar system in JUSD, owned by the holders of Juice Protocol (JUICE).
     * @dev Note that the equity contract technically holds both the minter reserve as well as the equity, so the minter
     * reserve must be subtracted. All fees and other kinds of income are added to the Equity contract and essentially
     * constitute profits attributable to the pool shareholders.
     */
    function equity() public view returns (uint256) {
        uint256 balance = balanceOf(address(reserve));
        uint256 minReserve = minterReserve();
        if (balance <= minReserve) {
            return 0;
        } else {
            return balance - minReserve;
        }
    }

    /**
     * @notice Qualified pool shareholders can deny minters during the application period.
     * @dev Calling this function is relatively cheap thanks to the deletion of a storage slot.
     */
    function denyMinter(address _minter, address[] calldata _helpers, string calldata _message) external override {
        if (block.timestamp > minters[_minter]) revert TooLate();
        reserve.checkQualified(msg.sender, _helpers);
        delete minters[_minter];
        emit MinterDenied(_minter, _message);
    }

    /**
     * @notice Mints the provided amount of JUSD to the target address, automatically forwarding
     * the minting fee and the reserve to the right place.
     */
    function mintWithReserve(address _target, uint256 _amount, uint32 _reservePPM) external override minterOnly {
        uint256 usableMint = (_amount * (1_000_000 - _reservePPM)) / 1_000_000; // rounding down is fine
        _mint(_target, usableMint);
        _mint(address(reserve), _amount - usableMint); // rest goes to equity as reserves or as fees
        minterReserveE6 += _amount * _reservePPM;
    }

    function mint(address _target, uint256 _amount) external override minterOnly {
        _mint(_target, _amount);
    }

    /**
     * Anyone is allowed to burn their JUSD.
     */
    function burn(uint256 _amount) external {
        _burn(msg.sender, _amount);
    }

    /**
     * @notice Burn someone else's JUSD.
     */
    function burnFrom(address _owner, uint256 _amount) external override minterOnly {
        _spendAllowance(_owner, msg.sender, _amount);
        _burn(_owner, _amount);
    }

    /**
     * @notice Burn the amount without reclaiming the reserve, but freeing it up and thereby essentially donating it to the
     * pool shareholders. This can make sense in combination with 'coverLoss', i.e. when it is the pool shareholders
     * that bear the risk and depending on the outcome they make a profit or a loss.
     *
     * Design rule: Minters calling this method are only allowed to do so for token amounts they previously minted with
     * the same _reservePPM amount.
     *
     * For example, if someone minted 50 JUSD earlier with a 20% reserve requirement (200000 ppm), they got 40 JUSD
     * and paid 10 JUSD into the reserve. Now they want to repay the debt by burning 50 JUSD. When doing so using this
     * method, 50 JUSD get burned and on top of that, 10 JUSD previously assigned to the minter's reserve are
     * reassigned to the pool shareholders.
     */
    function burnWithoutReserve(uint256 amount, uint32 reservePPM) public override minterOnly {
        _burn(msg.sender, amount);

        uint256 equityBefore = equity();
        uint256 reserveReduction = amount * reservePPM;
        minterReserveE6 = minterReserveE6 > reserveReduction ? minterReserveE6 - reserveReduction : 0;
        uint256 equityAfter = equity();

        if (equityAfter > equityBefore) {
            emit Profit(msg.sender, equityAfter - equityBefore);
        }
    }

    /**
     * @notice Burns the target amount taking the tokens to be burned from the payer and the payer's reserve.
     * Only use this method for tokens also minted by the caller with the same reservePPM.
     *
     * Example: the calling contract has previously minted 100 JUSD with a reserve ratio of 20% (i.e. 200000 ppm).
     * To burn half of that again, the minter calls burnFromWithReserve with a target amount of 50 JUSD. Assuming that reserves
     * are only 90% covered, this call will deduct 41 JUSD from the payer's balance and 9 from the reserve, while
     * reducing the minter reserve by 10.
     */
    function burnFromWithReserve(
        address payer,
        uint256 targetTotalBurnAmount,
        uint32 reservePPM
    ) public override minterOnly returns (uint256) {
        uint256 assigned = calculateAssignedReserve(targetTotalBurnAmount, reservePPM);
        _spendAllowance(payer, msg.sender, targetTotalBurnAmount - assigned); // spend amount excluding the reserve
        _burn(address(reserve), assigned); // burn reserve amount from the reserve
        _burn(payer, targetTotalBurnAmount - assigned); // burn remaining amount from the payer
        minterReserveE6 -= targetTotalBurnAmount * reservePPM; // reduce reserve requirements by original ratio
        return assigned;
    }

    /**
     * @notice Calculates the assigned reserve for a given amount and reserve requirement, adjusted for reserve losses.
     * @return `amountExcludingReserve` plus its share of the reserve.
     */
    function calculateFreedAmount(uint256 amountExcludingReserve, uint32 _reservePPM) public view returns (uint256) {
        uint256 effectiveReservePPM = _effectiveReservePPM(_reservePPM);
        return (1_000_000 * amountExcludingReserve) / (1_000_000 - effectiveReservePPM);
    }

    /**
     * @notice Calculates the reserve attributable to someone who minted the given amount with the given reserve requirement.
     * Under normal circumstances, this is just the reserve requirement multiplied by the amount. However, after a
     * severe loss of capital that burned into the minter's reserve, this can also be less than that.
     */
    function calculateAssignedReserve(uint256 mintedAmount, uint32 _reservePPM) public view returns (uint256) {
        uint256 effectiveReservePPM = _effectiveReservePPM(_reservePPM);
        return (effectiveReservePPM * mintedAmount) / 1_000_000;
    }

    /**
     * @notice Calculates the reserve ratio adjusted for any reserve shortfall
     * @dev When there's a reserve shortfall (currentReserve < minterReserve), the effective reserve ratio is proportionally reduced.
     * This ensures fair distribution of remaining reserves during repayment.
     * @param reservePPM The nominal reserve ratio in parts per million
     * @return The effective reserve ratio in parts per million, adjusted for any shortfall
     */
    function _effectiveReservePPM(uint32 reservePPM) internal view returns (uint256) {
        uint256 minterReserve_ = minterReserve();
        uint256 currentReserve = balanceOf(address(reserve));
        return currentReserve < minterReserve_ ? (reservePPM * currentReserve) / minterReserve_ : reservePPM;
    }

    /**
     * @notice Notify the JuiceDollar that a minter lost economic access to some coins. This does not mean that the coins are
     * literally lost. It just means that some JUSD will likely never be repaid and that in order to bring the system
     * back into balance, the lost amount of JUSD must be removed from the reserve instead.
     *
     * For example, if a minter printed 1 million JUSD for a mortgage and the mortgage turned out to be unsound with
     * the house only yielding 800,000 in the subsequent auction, there is a loss of 200,000 that needs to be covered
     * by the reserve.
     */
    function coverLoss(address source, uint256 _amount) external override minterOnly {
        _withdrawFromReserve(source, _amount);
        emit Loss(source, _amount);
    }

    /**
     * @notice Distribute profits (e.g., savings interest) from the reserve to recipients.
     *
     * @param recipient The address receiving the payout.
     * @param amount The amount of JUSD to distribute.
     */
    function distributeProfits(address recipient, uint256 amount) external override minterOnly {
        _withdrawFromReserve(recipient, amount);
        emit ProfitDistributed(recipient, amount);
    }

    function collectProfits(address source, uint256 _amount) external override minterOnly {
        _collectProfits(msg.sender, source, _amount);
    }

    function _collectProfits(address minter, address source, uint256 _amount) internal {
        _spendAllowance(source, minter, _amount);
        _transfer(source, address(reserve), _amount);
        emit Profit(minter, _amount);
    }

    /**
     * @notice Transfers the specified amount from the reserve if possible; mints the remainder if necessary.
     * @param recipient The address receiving the funds.
     * @param amount The total amount to be paid.
     */
    function _withdrawFromReserve(address recipient, uint256 amount) internal {
        uint256 reserveLeft = balanceOf(address(reserve));
        if (reserveLeft >= amount) {
            _transfer(address(reserve), recipient, amount);
        } else {
            _transfer(address(reserve), recipient, reserveLeft);
            _mint(recipient, amount - reserveLeft);
        }
    }

    /**
     * @notice Returns true if the address is an approved minter.
     */
    function isMinter(address _minter) public view override returns (bool) {
        return minters[_minter] != 0 && block.timestamp >= minters[_minter];
    }

    /**
     * @notice Returns the address of the minter that created this position or null if the provided address is unknown.
     */
    function getPositionParent(address _position) public view override returns (address) {
        return positions[_position];
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return
            interfaceId == type(IERC20).interfaceId ||
            interfaceId == type(ERC20Permit).interfaceId ||
            interfaceId == type(ERC3009).interfaceId ||
            interfaceId == type(IJuiceDollar).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
