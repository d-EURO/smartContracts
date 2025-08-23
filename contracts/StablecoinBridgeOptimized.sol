// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IDecentralizedEURO} from "./interface/IDecentralizedEURO.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title Optimized Stablecoin Bridge
 * @notice Gas-optimized version with packed storage and optimized fee handling
 */
contract StablecoinBridgeOptimized {
    using SafeERC20 for IERC20;

    IERC20 public immutable eur;
    IDecentralizedEURO public immutable dEURO;
    address public immutable reserve;
    
    // Pack into single storage slot (32 bytes)
    struct BridgeConfig {
        uint40 horizon;        // 5 bytes - timestamp (good until year 36812)
        uint24 mintFeePPM;     // 3 bytes - up to 16.7M PPM 
        uint24 burnFeePPM;     // 3 bytes - up to 16.7M PPM
        uint8 eurDecimals;     // 1 byte
        uint8 dEURODecimals;   // 1 byte
        // Total: 13 bytes, fits in single slot with room to spare
    }
    
    BridgeConfig public config;
    uint256 public immutable limit;
    uint256 public minted;

    error Limit(uint256 amount, uint256 limit);
    error Expired(uint256 time, uint256 expiration);

    constructor(
        address other, 
        address dEUROAddress, 
        uint256 limit_, 
        uint256 weeks_, 
        uint24 mintFeePPM_,
        uint24 burnFeePPM_
    ) {
        require(mintFeePPM_ <= 1000000 && burnFeePPM_ <= 1000000, "Fee exceeds 100%");
        
        eur = IERC20(other);
        dEURO = IDecentralizedEURO(dEUROAddress);
        reserve = address(dEURO.reserve());
        limit = limit_;
        
        // Pack configuration into single storage slot
        config = BridgeConfig({
            horizon: uint40(block.timestamp + weeks_ * 1 weeks),
            mintFeePPM: mintFeePPM_,
            burnFeePPM: burnFeePPM_,
            eurDecimals: IERC20Metadata(other).decimals(),
            dEURODecimals: IERC20Metadata(dEUROAddress).decimals()
        });
    }

    /**
     * @notice Optimized mint with single-pass fee calculation
     */
    function mint(uint256 amount) external {
        // Load config once (single SLOAD)
        BridgeConfig memory cfg = config;
        
        // Check expiration
        if (block.timestamp > cfg.horizon) 
            revert Expired(block.timestamp, cfg.horizon);
        
        // Transfer source tokens
        eur.safeTransferFrom(msg.sender, address(this), amount);
        
        // Convert amount if needed
        uint256 targetAmount = _convertAmount(amount, cfg.eurDecimals, cfg.dEURODecimals);
        
        // Update minted (single SSTORE)
        uint256 newMinted = minted + targetAmount;
        if (newMinted > limit) revert Limit(targetAmount, limit);
        minted = newMinted;
        
        // Calculate amounts
        uint256 userAmount = targetAmount;
        uint256 feeAmount = 0;
        
        if (cfg.mintFeePPM > 0) {
            feeAmount = targetAmount * cfg.mintFeePPM / 1_000_000;
            userAmount = targetAmount - feeAmount;
        }
        
        // Single mint with fee distribution (requires dEURO contract modification)
        _mintWithFee(msg.sender, userAmount, feeAmount);
    }

    /**
     * @notice Optimized burn with packed operations
     */
    function burn(uint256 amount) external {
        // Load config once
        BridgeConfig memory cfg = config;
        
        uint256 sourceAmount = amount;
        uint256 feeAmount = 0;
        
        if (cfg.burnFeePPM > 0) {
            feeAmount = amount * cfg.burnFeePPM / 1_000_000;
            sourceAmount = amount - feeAmount;
            
            // Burn and transfer fee in optimal order
            dEURO.burnFrom(msg.sender, sourceAmount);
            dEURO.transferFrom(msg.sender, reserve, feeAmount);
        } else {
            dEURO.burnFrom(msg.sender, amount);
        }
        
        // Update minted
        minted -= sourceAmount;
        
        // Return source tokens
        uint256 returnAmount = _convertAmount(sourceAmount, cfg.dEURODecimals, cfg.eurDecimals);
        eur.safeTransfer(msg.sender, returnAmount);
    }

    /**
     * @notice This would require a new function in dEURO contract for optimal gas usage
     * For now, falls back to two separate mints
     */
    function _mintWithFee(address user, uint256 userAmount, uint256 feeAmount) private {
        if (feeAmount > 0) {
            // Ideally: dEURO.mintBatch([user, reserve], [userAmount, feeAmount]);
            // Current fallback:
            dEURO.mint(user, userAmount);
            dEURO.mint(reserve, feeAmount);
        } else {
            dEURO.mint(user, userAmount);
        }
    }

    function _convertAmount(uint256 amount, uint8 fromDecimals, uint8 toDecimals) 
        private 
        pure 
        returns (uint256) 
    {
        if (fromDecimals == toDecimals) return amount;
        if (fromDecimals < toDecimals) {
            return amount * 10**(toDecimals - fromDecimals);
        }
        return amount / 10**(fromDecimals - toDecimals);
    }
}