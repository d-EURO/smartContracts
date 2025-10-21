// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {JuiceDollar} from "./JuiceDollar.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC3009} from "./impl/ERC3009.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IReserve} from "./interface/IReserve.sol";
import {MathUtil} from "./utils/MathUtil.sol";

/**
 * @title Equity
 * @notice If the JuiceDollar system was a bank, this contract would represent the equity on its balance sheet.
 * Like a corporation, the owners of the equity capital are the shareholders, or in this case the holders
 * of Juice Protocol (JUICE) tokens. Anyone can mint additional JUICE tokens by adding JuiceDollars to the
 * reserve pool. Also, JUICE tokens can be redeemed for JuiceDollars again after a minimum holding period.
 * Furthermore, the JUICE shares come with some voting power. Anyone that held at least 2% of the holding-period-
 * weighted reserve pool shares gains veto power and can veto new proposals.
 */
contract Equity is ERC20Permit, ERC3009, MathUtil, IReserve, ERC165 {
    /**
     * The VALUATION_FACTOR determines the market cap of the reserve pool shares relative to the equity reserves.
     * The following always holds: Market Cap = Valuation Factor * Equity Reserve = Price * Supply
     *
     * In the absence of fees, profits and losses, the variables grow as follows when JUICE tokens are minted:
     *
     * |        Reserve     |      Market Cap    |     Price    |       Supply    |
     * |              1_000 |              5_000 |       0.0005 |      10_000_000 |
     * |        100_000_000 |        500_000_000 |       5      |     100_000_000 |
     * | 10_000_000_000_000 | 50_000_000_000_000 |  50_000      |   1_000_000_000 |
     *
     * i.e., the supply is proportional to the fifth root of the reserve and the price is proportional to the
     * squared cubic root. When profits accumulate or losses materialize, the reserve, the market cap,
     * and the price are adjusted proportionally. In the absence of extreme inflation of the Dollar, it is unlikely
     * that there will ever be more than ten million JUICE.
     */
    uint32 public constant VALUATION_FACTOR = 5; // Changed from 3 to 5 as requested

    uint256 private constant MINIMUM_EQUITY = 1_000 * ONE_DEC18;

    /**
     * @notice The quorum in basis points. 100 is 1%.
     */
    uint32 private constant QUORUM = 200;

    /**
     * @notice The number of digits to store the average holding time of share tokens.
     */
    uint8 private constant TIME_RESOLUTION_BITS = 20;

    /**
     * @notice The minimum holding duration. You are not allowed to redeem your pool shares if you held them
     * for less than the minimum holding duration at average. For example, if you have two pool shares at your
     * address, one acquired 5 days ago and one acquired 105 days ago, you cannot redeem them as the average
     * holding duration of your shares is only 55 days < 90 days.
     */
    uint256 public constant MIN_HOLDING_DURATION = 90 days << TIME_RESOLUTION_BITS; // Set to 5 for local testing

    JuiceDollar public immutable JUSD;

    /**
     * @dev To track the total number of votes we need to know the number of votes at the anchor time and when the
     * anchor time was. This is (hopefully) stored in one 256 bit slot, with the anchor time taking 64 Bits and
     * the total vote count 192 Bits. Given the sub-second resolution of 20 Bits, the implicit assumption is
     * that the timestamp can always be stored in 44 Bits (i.e., it does not exceed half a million years). Further,
     * given 18 decimals (about 60 Bits), this implies that the total supply cannot exceed
     *   192 - 60 - 44 - 20 = 68 Bits
     * Here, we are also safe, as 68 Bits would imply more than a trillion outstanding shares. In fact,
     * a limit of about 2**36 shares (that's about 2**96 Bits when taking into account the decimals) is imposed
     * when minting. This means that the maximum supply is billions of shares, which could only be reached in
     * a scenario with hyperinflation, in which case the stablecoin is worthless anyway.
     */
    uint192 private totalVotesAtAnchor; // Total number of votes at the anchor time
    uint64 private totalVotesAnchorTime; // 44 Bits for the time stamp, 20 Bit sub-second resolution

    /**
     * @notice Keeping track of who delegated votes to whom.
     * Note that delegation does not mean you cannot vote / veto anymore; it just means that the delegate can
     * benefit from your votes when invoking a veto. Circular delegations are valid but do not help when voting.
     */
    mapping(address owner => address delegate) public delegates;

    /**
     * @notice A time stamp in the past such that: votes = balance * (time passed since anchor was set).
     */
    mapping(address owner => uint64 timestamp) private voteAnchor; // 44 bits for time stamp, 20 sub-second resolution

    event Delegation(address indexed from, address indexed to); // indicates a delegation
    event Trade(address who, int256 amount, uint256 totPrice, uint256 newprice); // amount pos or neg for mint or redemption

    error BelowMinimumHoldingPeriod();
    error NotQualified();
    error NotMinter();
    error InsufficientEquity();
    error TooManyShares();
    error TotalSupplyExceeded();

    constructor(
        JuiceDollar JUSD_
    )
        ERC20Permit("Juice Protocol")
        ERC20("Juice Protocol", "JUICE")
    {
        JUSD = JUSD_;
    }

    /**
     * @notice Returns the price of one JUICE in JUSD with 18 decimals precision.
     */
    function price() public view returns (uint256) {
        uint256 equity = JUSD.equity();
        if (equity == 0 || totalSupply() == 0) {
            return 10 ** 14; 
        } else {
            return (VALUATION_FACTOR * JUSD.equity() * ONE_DEC18) / totalSupply();
        }
    }

    function _update(address from, address to, uint256 value) internal override {
        if (value > 0) {
            // No need to adjust the sender's votes. When they send out 10% of their shares, they also lose 10% of
            // their votes, so everything falls nicely into place. Recipient votes should stay the same, but grow
            // faster in the future, requiring an adjustment of the anchor.
            uint256 roundingLoss = _adjustRecipientVoteAnchor(to, value);
            // The total also must be adjusted and kept accurate by taking into account the rounding error.
            _adjustTotalVotes(from, value, roundingLoss);
        }
        super._update(from, to, value);
    }

    /**
     * @notice Returns whether the given address is allowed to redeem JUICE, which is the
     * case after their average holding duration is larger than the required minimum.
     */
    function canRedeem(address owner) public view returns (bool) {
        return _anchorTime() - voteAnchor[owner] >= MIN_HOLDING_DURATION;
    }

    /**
     * @notice Decrease the total votes anchor when tokens lose their voting power due to being moved.
     * @param from      sender
     * @param amount    amount to be sent
     */
    function _adjustTotalVotes(address from, uint256 amount, uint256 roundingLoss) internal {
        uint64 time = _anchorTime();
        uint256 lostVotes = from == address(0x0) ? 0 : (time - voteAnchor[from]) * amount;
        totalVotesAtAnchor = uint192(totalVotes() - roundingLoss - lostVotes);
        totalVotesAnchorTime = time;
    }

    /**
     * @notice The vote anchor of the recipient is moved forward such that the number of calculated
     * votes does not change despite the higher balance.
     * @param to        receiver address
     * @param amount    amount to be received
     * @return the number of votes lost due to rounding errors
     */
    function _adjustRecipientVoteAnchor(address to, uint256 amount) internal returns (uint256) {
        if (to != address(0x0)) {
            uint256 recipientVotes = votes(to); // for example 21 if 7 shares were held for 3 seconds
            uint256 newbalance = balanceOf(to) + amount; // for example 11 if 4 shares are added
            // new example: anchor is only 21 / 11 = ~1 second in the past
            voteAnchor[to] = uint64(_anchorTime() - recipientVotes / newbalance);
            return recipientVotes % newbalance; // we have lost 21 % 11 = 10 votes
        } else {
            // optimization for burn, vote anchor of null address does not matter
            return 0;
        }
    }

    /**
     * @notice Time stamp with some additional bits for higher resolution.
     */
    function _anchorTime() internal view returns (uint64) {
        return uint64(block.timestamp << TIME_RESOLUTION_BITS);
    }

    /**
     * @notice The relative voting power of the address.
     * @return A percentage with 1e18 being 100%
     */
    function relativeVotes(address holder) external view returns (uint256) {
        return (ONE_DEC18 * votes(holder)) / totalVotes();
    }

    /**
     * @notice The votes of the holder, excluding votes from delegates.
     */
    function votes(address holder) public view returns (uint256) {
        return balanceOf(holder) * (_anchorTime() - voteAnchor[holder]);
    }

    /**
     * @notice How long the holder already held onto their average JUICE in seconds.
     */
    function holdingDuration(address holder) public view returns (uint256) {
        return (_anchorTime() - voteAnchor[holder]) >> TIME_RESOLUTION_BITS;
    }

    /**
     * @notice Total number of votes in the system.
     */
    function totalVotes() public view returns (uint256) {
        return totalVotesAtAnchor + totalSupply() * (_anchorTime() - totalVotesAnchorTime);
    }

    /**
     * @notice The number of votes the sender commands when taking the support of the helpers into account.
     * @param sender    The address whose total voting power is of interest
     * @param helpers   An incrementally sorted list of helpers without duplicates and without the sender.
     *                  The call fails if the list contains an address that does not delegate to sender.
     *                  For indirect delegates, i.e. a -> b -> c, both a and b must be included for both to count.
     * @return          The total number of votes of sender at the current point in time.
     */
    function votesDelegated(address sender, address[] calldata helpers) public view returns (uint256) {
        uint256 _votes = votes(sender);
        require(_checkDuplicatesAndSorted(helpers));
        for (uint i = 0; i < helpers.length; i++) {
            address current = helpers[i];
            require(current != sender);
            require(_canVoteFor(sender, current));
            _votes += votes(current);
        }
        return _votes;
    }

    function _checkDuplicatesAndSorted(address[] calldata helpers) internal pure returns (bool ok) {
        if (helpers.length <= 1) {
            return true;
        } else {
            address prevAddress = helpers[0];
            for (uint i = 1; i < helpers.length; i++) {
                if (helpers[i] <= prevAddress) {
                    return false;
                }
                prevAddress = helpers[i];
            }
            return true;
        }
    }

    /**
     * @notice Checks whether the sender address is qualified given a list of helpers that delegated their votes
     * directly or indirectly to the sender. It is the responsibility of the caller to figure out whether
     * helpers are necessary and to identify them by scanning the blockchain for Delegation events.
     */
    function checkQualified(address sender, address[] calldata helpers) public view override {
        uint256 _votes = votesDelegated(sender, helpers);
        if (_votes * 10_000 < QUORUM * totalVotes()) revert NotQualified();
    }

    /**
     * @notice Increases the voting power of the delegate by your number of votes without taking away any voting power
     * from the sender.
     */
    function delegateVoteTo(address delegate) external {
        delegates[msg.sender] = delegate;
        emit Delegation(msg.sender, delegate);
    }

    function _canVoteFor(address delegate, address owner) internal view returns (bool) {
        if (owner == delegate) {
            return true;
        } else if (owner == address(0x0)) {
            return false;
        } else {
            return _canVoteFor(delegate, delegates[owner]);
        }
    }

    /**
     * @notice Since quorum is rather low, it is important to have a way to prevent malicious minority holders
     * from blocking the whole system. This method provides a way for the good guys to team up and destroy
     * the bad guy's votes (at the cost of also reducing their own votes). This mechanism potentially
     * gives full control over the system to whoever has 51% of the votes.
     *
     * Since this is a rather aggressive measure, delegation is not supported. Every holder must call this
     * method on their own.
     * @param targets          The target addresses to remove votes from
     * @param votesToDestroy   The maximum number of votes the caller is willing to sacrifice
     */
    function kamikaze(address[] calldata targets, uint256 votesToDestroy) external {
        uint256 budget = _reduceVotes(msg.sender, votesToDestroy);
        uint256 destroyedVotes = 0;
        for (uint256 i = 0; i < targets.length && destroyedVotes < budget; i++) {
            destroyedVotes += _reduceVotes(targets[i], budget - destroyedVotes);
        }
        require(destroyedVotes > 0); // sanity check
        totalVotesAtAnchor = uint192(totalVotes() - destroyedVotes - budget);
        totalVotesAnchorTime = _anchorTime();
    }

    function _reduceVotes(address target, uint256 amount) internal returns (uint256) {
        uint256 votesBefore = votes(target);
        if (amount >= votesBefore) {
            amount = votesBefore;
            voteAnchor[target] = _anchorTime();
            return votesBefore;
        } else {
            voteAnchor[target] = uint64(_anchorTime() - (votesBefore - amount) / balanceOf(target));
            return votesBefore - votes(target);
        }
    }

    /**
     * @notice Call this method to obtain newly minted pool shares in exchange for JuiceDollars.
     * No allowance required (i.e., it is hard-coded in the JuiceDollar token contract).
     * Make sure to invest at least 10e-12 * market cap to avoid rounding losses.
     *
     * @dev If equity is close to zero or negative, you need to send enough JUSD to bring equity back to 1_000 JUSD.
     *
     * @param amount            JuiceDollars to invest
     * @param expectedShares    Minimum amount of expected shares for front running protection
     */
    function invest(uint256 amount, uint256 expectedShares) external returns (uint256) {
        return _invest(_msgSender(), amount, expectedShares);
    }

    function investFor(address investor, uint256 amount, uint256 expectedShares) external returns (uint256) {
        if (!JUSD.isMinter(_msgSender())) revert NotMinter();
        return _invest(investor, amount, expectedShares);
    }

    function _invest(address investor, uint256 amount, uint256 expectedShares) internal returns (uint256) {
        JUSD.transferFrom(investor, address(this), amount);
        uint256 equity = JUSD.equity();
        if (equity < MINIMUM_EQUITY) revert InsufficientEquity(); // ensures that the initial deposit is at least 1_000 JUSD

        uint256 shares = _calculateShares(equity <= amount ? 0 : equity - amount, amount);
        require(shares >= expectedShares);
        _mint(investor, shares);
        emit Trade(investor, int(shares), amount, price());

        // limit the total supply to a reasonable amount to guard against overflows with price and vote calculations
        if(totalSupply() > type(uint96).max) revert TotalSupplyExceeded();
        return shares;
    }

    /**
     * @notice Calculate shares received when investing JuiceDollars
     * @param investment    JUSD to be invested
     * @return shares to be received in return
     */
    function calculateShares(uint256 investment) external view returns (uint256) {
        return _calculateShares(JUSD.equity(), investment);
    }

    function _calculateShares(uint256 capitalBefore, uint256 investment) internal view returns (uint256) {
        uint256 totalShares = totalSupply();
        uint256 investmentExFees = (investment * 980) / 1_000; // remove 2% fee
        // Assign 10_000_000 JUICE for the initial deposit, calculate the amount otherwise
        uint256 newTotalShares = (capitalBefore < MINIMUM_EQUITY || totalShares == 0)
            ? totalShares + 10_000_000 * ONE_DEC18
            : _mulD18(totalShares, _fifthRoot(_divD18(capitalBefore + investmentExFees, capitalBefore)));
        return newTotalShares - totalShares;
    }

    /**
     * @notice Redeem the given amount of shares owned by the sender and transfer the proceeds to the target.
     * @return The amount of JUSD transferred to the target
     */
    function redeem(address target, uint256 shares) external returns (uint256) {
        return _redeemFrom(msg.sender, target, shares);
    }

    /**
     * @notice Like redeem(...), but with an extra parameter to protect against front running.
     * @param expectedProceeds  The minimum acceptable redemption proceeds.
     */
    function redeemExpected(address target, uint256 shares, uint256 expectedProceeds) external returns (uint256) {
        uint256 proceeds = _redeemFrom(msg.sender, target, shares);
        require(proceeds >= expectedProceeds);
        return proceeds;
    }

    /**
     * @notice Redeem JUICE based on an allowance from the owner to the caller.
     * See also redeemExpected(...).
     */
    function redeemFrom(
        address owner,
        address target,
        uint256 shares,
        uint256 expectedProceeds
    ) external returns (uint256) {
        _spendAllowance(owner, msg.sender, shares);
        uint256 proceeds = _redeemFrom(owner, target, shares);
        require(proceeds >= expectedProceeds);
        return proceeds;
    }

    function _redeemFrom(address owner, address target, uint256 shares) internal returns (uint256) {
        if(!canRedeem(owner)) revert BelowMinimumHoldingPeriod();
        uint256 proceeds = calculateProceeds(shares);
        _burn(owner, shares);
        JUSD.transfer(target, proceeds);
        emit Trade(owner, -int(shares), proceeds, price());
        return proceeds;
    }

    /**
     * @notice Calculate JUSD received when depositing shares
     * @param shares number of shares we want to exchange for JUSD,
     *               in dec18 format
     * @return amount of JUSD received for the shares
     */
    function calculateProceeds(uint256 shares) public view returns (uint256) {
        uint256 totalShares = totalSupply();
        if (shares + ONE_DEC18 >= totalShares) revert TooManyShares(); // make sure there is always at least one share
        uint256 capital = JUSD.equity();
        uint256 reductionAfterFees = (shares * 980) / 1_000; // remove 2% fee
        uint256 newCapital = _mulD18(capital, _power5(_divD18(totalShares - reductionAfterFees, totalShares)));
        return capital - newCapital;
    }

    /**
     * @notice If there is less than 1_000 JUSD in equity left (maybe even negative), the system is at risk
     * and we should allow qualified JUICE holders to restructure the system.
     *
     * Example: there was a devastating loss and equity stands at -1'000'000. Most shareholders have lost hope in the
     * JuiceDollar system except for a group of small JUICE holders who still believe in it and are willing to provide
     * 2'000'000 JUSD to save it. These brave souls are essentially donating 1'000'000 to the minter reserve and it
     * would be wrong to force them to share the other million with the passive JUICE holders. Instead, they will get
     * the possibility to bootstrap the system again owning 100% of all JUICE shares.
     *
     * @param helpers          A list of addresses that delegate to the caller in incremental order
     * @param addressesToWipe  A list of addresses whose JUICE will be burned to zero
     */
    function restructureCapTable(address[] calldata helpers, address[] calldata addressesToWipe) external {
        require(JUSD.equity() < MINIMUM_EQUITY);
        checkQualified(msg.sender, helpers);
        for (uint256 i = 0; i < addressesToWipe.length; i++) {
            address current = addressesToWipe[i];
            _burn(current, balanceOf(current));
        }
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return
            interfaceId == type(IERC20).interfaceId ||
            interfaceId == type(ERC20Permit).interfaceId ||
            interfaceId == type(ERC3009).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
