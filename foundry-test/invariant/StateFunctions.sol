// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {Position} from "../../contracts/MintingHubV2/Position.sol";
import {PositionState, SystemState, MintingHubState} from "./HandlerTypes.sol";
import {TestHelper} from "../TestHelper.sol";

/**
 * @title StateFunctions
 * @notice Utility contract with functions for state management and transitions
 * @dev Contains reusable state validation and calculation functions
 */
abstract contract StateFunctions is TestHelper {
    /**
     * @notice Determine the current state of a position
     * @param position The position to check
     * @return state The current state of the position
     */
    function getPositionState(Position position) internal view returns (PositionState) {
        if (position.isClosed()) return PositionState.CLOSED;
        if (block.timestamp >= position.expiration()) return PositionState.EXPIRED;
        if (position.challengedAmount() > 0) return PositionState.CHALLENGED;
        if (position.cooldown() > block.timestamp) return PositionState.COOLDOWN;
        return PositionState.ACTIVE;
    }

    /**
     * @notice Check if a position is valid for minting
     * @param position The position to check
     * @return True if the position can be used for minting
     */
    function canMint(Position position) internal view returns (bool) {
        return position.cooldown() <= block.timestamp && 
               position.challengedAmount() == 0 &&
               block.timestamp < position.expiration() &&
               !position.isClosed() &&
               hasMinimumCollateral(position);
    }

    /**
     * @notice Check if a position has at least the minimum required collateral
     * @param position The position to check
     * @return True if the position has at least the minimum collateral
     */
    function hasMinimumCollateral(Position position) internal view returns (bool) {
        return getCollateralBalance(position) >= position.minimumCollateral();
    }

    /**
     * @notice Get the collateral balance of a position from its collateral token
     * This abstracts away the need to directly access the collateral token
     * @param position The position to check
     * @return The current collateral balance
     */
    function getCollateralBalance(Position position) internal view virtual returns (uint256);

    /**
     * @notice Calculate the maximum principal a position can support
     * @param position The position to check
     * @return The maximum principal value
     */
    function maxPrincipal(Position position) internal view virtual returns (uint256);

    /**
     * @notice Calculate the required collateral for a position
     * @param position The position to check
     * @return The required collateral amount
     */
    function requiredCollateral(Position position) internal view virtual returns (uint256);

    /**
     * @notice Calculate the valid price range for a position
     * @param position The position to check
     * @return minPrice The minimum valid price
     * @return maxPrice The maximum valid price
     */
    function priceRange(Position position) internal view virtual returns (uint256, uint256);
}