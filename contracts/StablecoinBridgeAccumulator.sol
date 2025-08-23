// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IDecentralizedEURO} from "./interface/IDecentralizedEURO.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title Stablecoin Bridge with Fee Accumulator
 * @notice Accumulates fees and allows batch transfer to reserve, saving gas per transaction
 */
contract StablecoinBridgeAccumulator {
    using SafeERC20 for IERC20;

    IERC20 public immutable eur;
    IDecentralizedEURO public immutable dEURO;
    address public immutable reserve;
    uint8 private immutable eurDecimals;
    uint8 private immutable dEURODecimals;

    uint256 public immutable horizon;
    uint256 public immutable limit;
    uint256 public immutable mintFeePPM;
    uint256 public immutable burnFeePPM;
    
    uint256 public minted;
    uint256 public accumulatedFees; // Accumulated dEURO fees to be sent to reserve

    error Limit(uint256 amount, uint256 limit);
    error Expired(uint256 time, uint256 expiration);

    event FeesCollected(uint256 amount);

    constructor(
        address other, 
        address dEUROAddress, 
        uint256 limit_, 
        uint256 weeks_, 
        uint256 mintFeePPM_,
        uint256 burnFeePPM_
    ) {
        require(mintFeePPM_ <= 1000000 && burnFeePPM_ <= 1000000, "Fee exceeds 100%");
        
        eur = IERC20(other);
        dEURO = IDecentralizedEURO(dEUROAddress);
        reserve = address(dEURO.reserve());
        eurDecimals = IERC20Metadata(other).decimals();
        dEURODecimals = IERC20Metadata(dEUROAddress).decimals();
        horizon = block.timestamp + weeks_ * 1 weeks;
        limit = limit_;
        mintFeePPM = mintFeePPM_;
        burnFeePPM = burnFeePPM_;
    }

    /**
     * @notice Mint with accumulated fees (gas-efficient)
     */
    function mint(uint256 amount) external {
        if (block.timestamp > horizon) revert Expired(block.timestamp, horizon);
        
        eur.safeTransferFrom(msg.sender, address(this), amount);
        uint256 targetAmount = _convertAmount(amount, eurDecimals, dEURODecimals);
        
        uint256 userAmount = targetAmount;
        
        if (mintFeePPM > 0) {
            uint256 feeAmount = targetAmount * mintFeePPM / 1_000_000;
            userAmount = targetAmount - feeAmount;
            accumulatedFees += feeAmount; // Just accumulate, don't mint yet
        }
        
        minted += targetAmount;
        if (minted > limit) revert Limit(targetAmount, limit);
        
        // Only one mint call per transaction
        dEURO.mint(msg.sender, userAmount);
    }

    /**
     * @notice Burn with accumulated fees
     */
    function burn(uint256 amount) external {
        if (burnFeePPM > 0) {
            uint256 feeAmount = amount * burnFeePPM / 1_000_000;
            uint256 burnAmount = amount - feeAmount;
            
            dEURO.burnFrom(msg.sender, burnAmount);
            // Transfer fee to this contract for accumulation
            dEURO.transferFrom(msg.sender, address(this), feeAmount);
            accumulatedFees += feeAmount;
            
            minted -= burnAmount;
            
            uint256 sourceAmount = _convertAmount(burnAmount, dEURODecimals, eurDecimals);
            eur.safeTransfer(msg.sender, sourceAmount);
        } else {
            dEURO.burnFrom(msg.sender, amount);
            minted -= amount;
            
            uint256 sourceAmount = _convertAmount(amount, dEURODecimals, eurDecimals);
            eur.safeTransfer(msg.sender, sourceAmount);
        }
    }

    /**
     * @notice Collect accumulated fees and send to reserve
     * @dev Can be called by anyone, saves gas for users
     */
    function collectFees() external {
        uint256 fees = accumulatedFees;
        if (fees > 0) {
            accumulatedFees = 0;
            
            // Check if we have the fees as balance
            uint256 balance = dEURO.balanceOf(address(this));
            if (balance < fees) {
                // Mint the difference
                dEURO.mint(reserve, fees - balance);
                if (balance > 0) {
                    dEURO.transfer(reserve, balance);
                }
            } else {
                // Transfer existing balance
                dEURO.transfer(reserve, fees);
            }
            
            emit FeesCollected(fees);
        }
    }

    /**
     * @notice Get pending fees that haven't been collected yet
     */
    function pendingFees() external view returns (uint256) {
        return accumulatedFees;
    }

    function _convertAmount(uint256 amount, uint8 fromDecimals, uint8 toDecimals) 
        internal 
        pure 
        returns (uint256) 
    {
        if (fromDecimals < toDecimals) {
            return amount * 10**(toDecimals - fromDecimals);
        } else if (fromDecimals > toDecimals) {
            return amount / 10**(fromDecimals - toDecimals);
        }
        return amount;
    }
}