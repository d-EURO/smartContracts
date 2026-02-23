// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IJuiceDollar} from "./interface/IJuiceDollar.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TeamMinter
 * @notice Team compensation tokens backed by 50% of JUSD equity.
 *
 * On deployment, mints a fixed supply of TEAM tokens to the deployer.
 * Each TEAM token represents a claim on: equity() / (2 * initialSupply) JUSD.
 *
 * Team members decide individually when to redeem. Early = less (equity small),
 * late = more (equity has grown). No price gate — the incentive is built-in.
 *
 * Redeeming burns TEAM tokens and distributes JUSD from the equity reserve.
 */
contract TeamMinter is ERC20 {
    IJuiceDollar public immutable JUSD;
    uint256 public immutable initialSupply;

    event Redeemed(address indexed member, uint256 teamTokens, uint256 jusdAmount);

    error NothingToRedeem();

    constructor(
        address _jusd,
        uint256 _totalTeamTokens
    ) ERC20("TEAM", "TEAM") {
        JUSD = IJuiceDollar(_jusd);
        initialSupply = _totalTeamTokens;
        _mint(msg.sender, _totalTeamTokens);
    }

    /**
     * @notice Redeem all TEAM tokens for JUSD.
     */
    function redeem() external {
        _redeem(msg.sender, balanceOf(msg.sender));
    }

    /**
     * @notice Redeem a specific amount of TEAM tokens for JUSD.
     */
    function redeem(uint256 amount) external {
        _redeem(msg.sender, amount);
    }

    /**
     * @notice Current JUSD value of a given amount of TEAM tokens.
     */
    function redeemValue(uint256 amount) public view returns (uint256) {
        return (amount * JUSD.equity()) / (2 * initialSupply);
    }

    function _redeem(address member, uint256 amount) internal {
        if (amount == 0) revert NothingToRedeem();

        uint256 jusdAmount = redeemValue(amount);
        _burn(member, amount);
        JUSD.distributeProfits(member, jusdAmount);

        emit Redeemed(member, amount, jusdAmount);
    }
}
