// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IDecentralizedEURO} from "./interface/IDecentralizedEURO.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title Stablecoin Bridge V2
 * @notice Gas-optimized bridge with storage packing and fee accumulator
 * @dev Combines storage packing and fee accumulation for maximum gas efficiency
 */
contract StablecoinBridgeV2 {
    using SafeERC20 for IERC20;

    // Immutable variables (no storage slots)
    IERC20 public immutable eur;
    IDecentralizedEURO public immutable dEURO;
    address public immutable reserve;
    uint256 public immutable limit;

    // Packed into single storage slot (32 bytes total)
    struct BridgeConfig {
        uint40 horizon;        // 5 bytes - timestamp (good until year 36812)
        uint24 mintFeePPM;     // 3 bytes - up to 16.7M PPM 
        uint24 burnFeePPM;     // 3 bytes - up to 16.7M PPM
        uint8 eurDecimals;     // 1 byte
        uint8 dEURODecimals;   // 1 byte
        // Total: 13 bytes (19 bytes free in slot)
    }
    
    // Single storage slot for config
    BridgeConfig public config;
    
    // Separate storage slots for frequently updated values
    uint256 public minted;
    uint256 public accumulatedMintFees;  // dEURO fees from minting
    uint256 public accumulatedBurnFees;  // dEURO fees from burning

    error Limit(uint256 amount, uint256 limit);
    error Expired(uint256 time, uint256 expiration);

    event FeesCollected(uint256 mintFees, uint256 burnFees, address indexed collector);
    event Minted(address indexed user, uint256 sourceAmount, uint256 dEUROAmount, uint256 fee);
    event Burned(address indexed user, uint256 dEUROAmount, uint256 sourceAmount, uint256 fee);

    constructor(
        address other, 
        address dEUROAddress, 
        uint256 limit_, 
        uint256 weeks_, 
        uint24 mintFeePPM_,
        uint24 burnFeePPM_
    ) {
        require(mintFeePPM_ <= 1_000_000, "Mint fee cannot exceed 100%");
        require(burnFeePPM_ <= 1_000_000, "Burn fee cannot exceed 100%");
        
        eur = IERC20(other);
        dEURO = IDecentralizedEURO(dEUROAddress);
        reserve = address(dEURO.reserve());
        limit = limit_;
        
        // Pack all config into single storage slot
        config = BridgeConfig({
            horizon: uint40(block.timestamp + weeks_ * 1 weeks),
            mintFeePPM: mintFeePPM_,
            burnFeePPM: burnFeePPM_,
            eurDecimals: IERC20Metadata(other).decimals(),
            dEURODecimals: IERC20Metadata(dEUROAddress).decimals()
        });
    }

    /**
     * @notice Mint dEURO with optimized gas usage
     * @param amount Amount of source EUR to convert
     */
    function mint(uint256 amount) external {
        mintTo(msg.sender, amount);
    }

    /**
     * @notice Mint dEURO to specific address with fee accumulation
     * @param target Recipient of the dEURO
     * @param amount Amount of source EUR to convert
     */
    function mintTo(address target, uint256 amount) public {
        // Load entire config in one SLOAD
        BridgeConfig memory cfg = config;
        
        // Check expiration
        if (block.timestamp > cfg.horizon) 
            revert Expired(block.timestamp, cfg.horizon);
        
        // Transfer source tokens
        eur.safeTransferFrom(msg.sender, address(this), amount);
        
        // Convert amount if decimals differ
        uint256 targetAmount = _convertAmount(amount, cfg.eurDecimals, cfg.dEURODecimals);
        
        // Calculate user amount and fee
        uint256 userAmount = targetAmount;
        uint256 feeAmount = 0;
        
        if (cfg.mintFeePPM > 0) {
            feeAmount = (targetAmount * cfg.mintFeePPM) / 1_000_000;
            userAmount = targetAmount - feeAmount;
            // Accumulate fee instead of minting to reserve
            accumulatedMintFees += feeAmount;
        }
        
        // Update minted amount and check limit
        uint256 newMinted = minted + targetAmount;
        if (newMinted > limit) revert Limit(targetAmount, limit);
        minted = newMinted;
        
        // Single mint to user only
        dEURO.mint(target, userAmount);
        
        emit Minted(target, amount, userAmount, feeAmount);
    }

    /**
     * @notice Burn dEURO with optimized gas usage
     * @param amount Amount of dEURO to burn
     */
    function burn(uint256 amount) external {
        burnAndSend(msg.sender, amount);
    }

    /**
     * @notice Burn dEURO and send source EUR to specific address
     * @param target Recipient of the source EUR
     * @param amount Amount of dEURO to burn
     */
    function burnAndSend(address target, uint256 amount) public {
        // Load entire config in one SLOAD
        BridgeConfig memory cfg = config;
        
        uint256 burnAmount = amount;
        uint256 feeAmount = 0;
        
        if (cfg.burnFeePPM > 0) {
            feeAmount = (amount * cfg.burnFeePPM) / 1_000_000;
            burnAmount = amount - feeAmount;
            
            // Burn the net amount
            dEURO.burnFrom(msg.sender, burnAmount);
            
            // Transfer fee to this contract for accumulation
            dEURO.transferFrom(msg.sender, address(this), feeAmount);
            accumulatedBurnFees += feeAmount;
        } else {
            // No fee - direct burn
            dEURO.burnFrom(msg.sender, amount);
        }
        
        // Update minted tracker
        minted -= burnAmount;
        
        // Convert and return source tokens
        uint256 sourceAmount = _convertAmount(burnAmount, cfg.dEURODecimals, cfg.eurDecimals);
        eur.safeTransfer(target, sourceAmount);
        
        emit Burned(msg.sender, amount, sourceAmount, feeAmount);
    }

    /**
     * @notice Collect accumulated fees and send to reserve
     * @dev Can be called by anyone - incentivizes MEV bots/keepers to collect fees
     * @return mintFees The amount of mint fees collected
     * @return burnFees The amount of burn fees collected
     */
    function collectFees() external returns (uint256 mintFees, uint256 burnFees) {
        mintFees = accumulatedMintFees;
        burnFees = accumulatedBurnFees;
        
        if (mintFees > 0 || burnFees > 0) {
            // Reset accumulators
            accumulatedMintFees = 0;
            accumulatedBurnFees = 0;
            
            uint256 totalFees = mintFees + burnFees;
            
            if (totalFees > 0) {
                // Check contract's dEURO balance
                uint256 balance = dEURO.balanceOf(address(this));
                
                if (balance >= burnFees) {
                    // We have the burn fees as actual dEURO
                    dEURO.transfer(reserve, burnFees);
                    
                    // Mint the mint fees
                    if (mintFees > 0) {
                        dEURO.mint(reserve, mintFees);
                    }
                } else {
                    // Transfer what we have
                    if (balance > 0) {
                        dEURO.transfer(reserve, balance);
                    }
                    
                    // Mint the rest
                    uint256 toMint = totalFees - balance;
                    if (toMint > 0) {
                        dEURO.mint(reserve, toMint);
                    }
                }
            }
            
            emit FeesCollected(mintFees, burnFees, msg.sender);
        }
        
        return (mintFees, burnFees);
    }

    /**
     * @notice Get total pending fees
     * @return mintFees Accumulated mint fees
     * @return burnFees Accumulated burn fees  
     * @return total Total pending fees
     */
    function pendingFees() external view returns (
        uint256 mintFees,
        uint256 burnFees,
        uint256 total
    ) {
        mintFees = accumulatedMintFees;
        burnFees = accumulatedBurnFees;
        total = mintFees + burnFees;
    }

    /**
     * @notice Check if bridge is expired
     */
    function isExpired() external view returns (bool) {
        return block.timestamp > config.horizon;
    }

    /**
     * @notice Get remaining capacity
     */
    function remainingCapacity() external view returns (uint256) {
        return limit > minted ? limit - minted : 0;
    }

    /**
     * @notice Internal function to convert between different decimals
     */
    function _convertAmount(uint256 amount, uint8 fromDecimals, uint8 toDecimals) 
        private 
        pure 
        returns (uint256) 
    {
        if (fromDecimals == toDecimals) {
            return amount;
        } else if (fromDecimals < toDecimals) {
            return amount * 10**(toDecimals - fromDecimals);
        } else {
            return amount / 10**(fromDecimals - toDecimals);
        }
    }
}