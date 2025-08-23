// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDecentralizedEURO} from "./interface/IDecentralizedEURO.sol";
import {IStablecoinBridge} from "./interface/IStablecoinBridge.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Stablecoin Bridge V2
 * @notice A minting contract for another Euro stablecoin ('source stablecoin') that we trust.
 * @author dEURO Association
 */
contract StablecoinBridgeV2 is IStablecoinBridge {
    using SafeERC20 for IERC20;

    IERC20 public immutable EURO; // the source stablecoin
    IDecentralizedEURO public immutable DEURO; // the dEURO
    uint8 private immutable EURO_DECIMALS;
    uint8 private immutable DEURO_DECIMALS;

    /**
     * @notice The fee for minting (converting source EURO to dEURO) in parts per million
     */
    uint24 public immutable MINT_FEE_PPM;

    /**
     * @notice The fee for burning (converting dEURO back to source EURO) in parts per million
     */
    uint24 public immutable BURN_FEE_PPM;

    /**
     * @notice The time horizon after which this bridge expires and needs to be replaced by a new contract.
     */
    uint40 public immutable HORIZON;

    /**
     * @notice The maximum amount of outstanding converted source stablecoins.
     */
    uint256 public immutable LIMIT;
    uint256 public minted;

    error Limit(uint256 amount, uint256 limit);
    error Expired(uint256 time, uint256 expiration);
    error InvalidFee(uint24 suggestedFeePPM, uint24 maxFeePPM);

    constructor(
        address other,
        address dEUROAddress,
        uint256 limit_,
        uint256 weeks_,
        uint24 mintFeePPM_,
        uint24 burnFeePPM_
    ) {
        if (mintFeePPM_ > 1_000_000) revert InvalidFee(mintFeePPM_, 1_000_000);
        if (burnFeePPM_ > 1_000_000) revert InvalidFee(burnFeePPM_, 1_000_000);

        EURO = IERC20(other);
        DEURO = IDecentralizedEURO(dEUROAddress);
        EURO_DECIMALS = IERC20Metadata(other).decimals();
        DEURO_DECIMALS = IERC20Metadata(dEUROAddress).decimals();
        HORIZON = uint40(block.timestamp + weeks_ * 1 weeks);
        MINT_FEE_PPM = mintFeePPM_;
        BURN_FEE_PPM = burnFeePPM_;
        LIMIT = limit_;
        minted = 0;
    }

    /**
     * @notice Convenience method for mint(msg.sender, amount)
     */
    function mint(uint256 amount) external {
        _mint(msg.sender, amount);
    }

    /**
     * @notice Mint the target amount of dEUROs, taking the equal amount of source coins from the sender.
     * @dev This only works if an allowance for the source coins has been set and the caller has enough of them.
     * @param amount The amount of the source stablecoin to bridge (convert).
     */
    function mintTo(address target, uint256 amount) external {
        _mint(target, amount);
    }

    function _mint(address target, uint256 amount) internal {
        uint256 targetAmount = _convertAmount(amount, EURO_DECIMALS, DEURO_DECIMALS);
        minted += targetAmount;

        if (block.timestamp > HORIZON) revert Expired(block.timestamp, HORIZON);
        if (minted > LIMIT) revert Limit(targetAmount, LIMIT);

        EURO.safeTransferFrom(msg.sender, address(this), amount);

        uint256 feeAmount = (targetAmount * MINT_FEE_PPM) / 1_000_000;
        DEURO.mint(address(this), targetAmount);
        DEURO.collectProfits(address(this), feeAmount);
        DEURO.transfer(target, targetAmount - feeAmount);
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
        uint256 feeAmount = (amount * BURN_FEE_PPM) / 1_000_000;
        DEURO.collectProfits(dEUROHolder, feeAmount);

        uint256 sendAmount = amount - feeAmount;
        DEURO.burnFrom(dEUROHolder, sendAmount);

        uint256 sourceAmount = _convertAmount(sendAmount, DEURO_DECIMALS, EURO_DECIMALS);
        EURO.safeTransfer(target, sourceAmount);
        minted -= sendAmount;
    }

    /**
     * @notice Converts an amount between two tokens with different decimal places.
     * @param amount The amount to convert.
     * @param fromDecimals The decimal places of the source token.
     * @param toDecimals The decimal places of the target token.
     */
    function _convertAmount(uint256 amount, uint8 fromDecimals, uint8 toDecimals) internal pure returns (uint256) {
        if (fromDecimals < toDecimals) {
            return amount * 10 ** (toDecimals - fromDecimals);
        } else if (fromDecimals > toDecimals) {
            return amount / 10 ** (fromDecimals - toDecimals);
        } else {
            return amount;
        }
    }
}
