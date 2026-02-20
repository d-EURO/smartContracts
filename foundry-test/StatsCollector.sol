// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {TestHelper} from "./TestHelper.sol";
import {Position} from "../contracts/MintingHubV3/Position.sol";
import {console} from "forge-std/Test.sol";

/**
 * @title StatsCollector
 * @notice Utility contract to collect statistics about variable distributions during fuzzing tests
 */
contract StatsCollector is TestHelper {
    /// @dev Enable statistics collection
    bool public immutable STATS_LOGGING;

    constructor(bool _enabled) {
        STATS_LOGGING = _enabled;
    }

    // Statistics for tracking uint256 values
    struct VariableStats {
        uint256 totalSamples;
        uint256 minValue;
        uint256 maxValue;
        uint256 sum;
    }

    // Statistics for action calls and reverts
    struct ActionStats {
        uint256 totalCalls;
        uint256 totalReverts;
    }

    // Store statistics for different variables by name
    mapping(string => VariableStats) private variableStats;

    // Store statistics for different actions by name
    mapping(string => ActionStats) private actionStats;

    /**
     * @notice Record a value in the statistics
     * @param name Name of the variable
     * @param value The value to record
     */
    function recordValue(string memory name, uint256 value) public {
        if (!STATS_LOGGING) return;

        VariableStats storage stats = variableStats[name];

        // Initialize if not already
        if (stats.totalSamples == 0) {
            stats.minValue = type(uint256).max;
        }

        // Update basic statistics
        stats.totalSamples++;
        stats.sum += value;
        if (value < stats.minValue) stats.minValue = value;
        if (value > stats.maxValue) stats.maxValue = value;
    }

    /**
     * @notice Record an action call in the statistics
     */
    function recordAction(string memory name) public {
        if (!STATS_LOGGING) return;

        ActionStats storage stats = actionStats[name];
        stats.totalCalls++;
    }

    /**
     * @notice Record an action revert in the statistics
     */
    function recordRevert(string memory name) public {
        if (!STATS_LOGGING) return;

        ActionStats storage stats = actionStats[name];
        stats.totalReverts++;
    }

    /// @dev Print variable distribution statistics to evaluate fuzzing coverage
    function printStatistics() external view {
        console.log("> ACTIONS");
        logHorizontalDivider();
        logRow3("Action", ["# Calls", "# Reverts", "Success %"]);
        logHorizontalDivider();
        printActionStatistics("mintTo");
        printActionStatistics("repay");
        printActionStatistics("addCollateral");
        printActionStatistics("withdrawCollateral");
        printActionStatistics("adjustPrice");
        printActionStatistics("challengePosition");
        printActionStatistics("bidChallenge");
        printActionStatistics("buyExpiredCollateral");
        printActionStatistics("passCooldown");
        printActionStatistics("expirePosition");
        printActionStatistics("warpTime");
        console.log("");

        // Print basic statistics
        console.log("> COVERAGE");
        logHorizontalDivider();
        logRow3("Variable", ["Min", "Max", "Mean"]);
        logHorizontalDivider();
        printVariableStatistics("position.price", 18);
        printVariableStatistics("position.principal", 18);
        printVariableStatistics("position.collateral", 18);
        printVariableStatistics("position.interest", 18);
        printVariableStatistics("collateralUtilization", 0);
    }

    /**
     * @notice Print statistics to console for analysis
     * @param name Name of the variable to print
     * @param decimals Number of decimal places to display
     */
    function printVariableStatistics(string memory name, uint256 decimals) public view {
        if (!STATS_LOGGING) return;

        VariableStats storage stats = variableStats[name];

        logRow3(
            name,
            [
                formatUint256(stats.minValue, decimals), // min
                formatUint256(stats.maxValue, decimals), // max
                formatUint256(stats.sum / stats.totalSamples, decimals) // mean
            ]
        );
    }

    /**
     * @notice Print statistics to console for analysis
     * @param name Name of the action to print
     */
    function printActionStatistics(string memory name) public view {
        if (!STATS_LOGGING) return;

        ActionStats storage stats = actionStats[name];
        uint256 successRatio = stats.totalCalls > 0
            ? (100 * (stats.totalCalls - stats.totalReverts)) / stats.totalCalls
            : 100;

        logRow3(
            name,
            [
                uint256ToString(stats.totalCalls), // calls
                uint256ToString(stats.totalReverts), // reverts
                uint256ToString(successRatio) // success %
            ]
        );
    }
}
