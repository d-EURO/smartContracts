// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IDecentralizedEURO} from "./interface/IDecentralizedEURO.sol";
import {IReserve} from "./interface/IReserve.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title Stablecoin Bridge
 * @notice A minting contract for another Euro stablecoin ('source stablecoin') that we trust.
 */
contract StablecoinBridge {
    using SafeERC20 for IERC20;

    uint32 private constant EMERGENCY_QUORUM = 1000; // 10% in basis points

    IERC20 public immutable eur; // the source stablecoin
    IDecentralizedEURO public immutable dEURO; // the dEURO
    uint8 private immutable eurDecimals;
    uint8 private immutable dEURODecimals;

    /**
     * @notice The time horizon after which this bridge expires and needs to be replaced by a new contract.
     */
    uint256 public immutable horizon;

    /**
     * @notice The maximum amount of outstanding converted source stablecoins.
     */
    uint256 public immutable limit;
    uint256 public minted;

    bool public stopped;

    event EmergencyStopped(address indexed caller, string message);

    error Limit(uint256 amount, uint256 limit);
    error Expired(uint256 time, uint256 expiration);
    error UnsupportedToken(address token);
    error Stopped();
    error AlreadyStopped();
    error NotQualified();
    error NoGovernance();

    constructor(address other, address dEUROAddress, uint256 limit_, uint256 weeks_) {
        eur = IERC20(other);
        dEURO = IDecentralizedEURO(dEUROAddress);
        eurDecimals = IERC20Metadata(other).decimals();
        dEURODecimals = IERC20Metadata(dEUROAddress).decimals();
        horizon = block.timestamp + weeks_ * 1 weeks;
        limit = limit_;
        minted = 0;
    }

    /**
     * @notice Convenience method for mint(msg.sender, amount)
     */
    function mint(uint256 amount) external {
        mintTo(msg.sender, amount);
    }

    /**
     * @notice Mint the target amount of dEUROs, taking the equal amount of source coins from the sender.
     * @dev This only works if an allowance for the source coins has been set and the caller has enough of them.
     * @param amount The amount of the source stablecoin to bridge (convert).
     */
    function mintTo(address target, uint256 amount) public {
        if (stopped) revert Stopped();
        eur.safeTransferFrom(msg.sender, address(this), amount);

        uint256 targetAmount = _convertAmount(amount, eurDecimals, dEURODecimals);
        _mint(target, targetAmount);
    }

    function _mint(address target, uint256 amount) internal {
        if (stopped) revert Stopped();
        if (block.timestamp > horizon) revert Expired(block.timestamp, horizon);
        dEURO.mint(target, amount);
        minted += amount;
        if (minted > limit) revert Limit(amount, limit);
    }

    /**
     * @notice Convenience method for burnAndSend(msg.sender, amount)
     * @param amount The amount of dEURO to burn.
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, msg.sender, amount);
    }

    /**
     * @notice Burn the indicated amount of dEURO and send the same number of source coins to the caller.
     */
    function burnAndSend(address target, uint256 amount) external {
        _burn(msg.sender, target, amount);
    }

    function _burn(address dEUROHolder, address target, uint256 amount) internal {
        uint256 sourceAmount = _convertAmount(amount, dEURODecimals, eurDecimals);
        dEURO.burnFrom(dEUROHolder, amount);
        eur.safeTransfer(target, sourceAmount);
        minted -= amount;
    }

    /**
     * @notice Permanently stop the bridge in an emergency (e.g., depeg of source stablecoin).
     * Requires the caller (with helpers) to hold at least 10% of the voting power.
     * Users can still burn dEURO to retrieve their stablecoins after stopping.
     */
    function emergencyStop(address[] calldata _helpers, string calldata _message) external {
        if (stopped) revert AlreadyStopped();
        IReserve reserve = dEURO.reserve();
        if (address(reserve) == address(0)) revert NoGovernance();
        uint256 total = reserve.totalVotes();
        if (total == 0) revert NoGovernance();
        uint256 votes = reserve.votesDelegated(msg.sender, _helpers);
        if (votes * 10_000 < EMERGENCY_QUORUM * total) revert NotQualified();
        stopped = true;
        emit EmergencyStopped(msg.sender, _message);
    }

    /**
     * @notice Converts an amount between two tokens with different decimal places.
     * @param amount The amount to convert.
     * @param fromDecimals The decimal places of the source token.
     * @param toDecimals The decimal places of the target token.
     */
    function _convertAmount(uint256 amount, uint8 fromDecimals, uint8 toDecimals) internal pure returns (uint256) {
        if (fromDecimals < toDecimals) {
            return amount * 10**(toDecimals - fromDecimals);
        } else if (fromDecimals > toDecimals) {
            return amount / 10**(fromDecimals - toDecimals);
        } else {
            return amount;
        }
    }
}
