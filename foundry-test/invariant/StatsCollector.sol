// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {console} from "forge-std/Test.sol";
import {TestHelper} from "../TestHelper.sol";

/**
 * @title StatsCollector
 * @notice Utility contract to collect statistics about variable distributions during fuzzing tests
 */
contract StatsCollector is TestHelper {
    /// @dev Enable statistics collection
    bool constant ENABLED = false;

    /// @dev Number of samples to process for statistics (to avoid out-of-gas errors)
    uint256 constant SAMPLE_LIMIT = 100;

    // Statistics for tracking uint256 values
    struct Statistics {
        uint256 totalSamples;
        uint256 minValue;
        uint256 maxValue;
        uint256 sum;
        uint256[] values; // samples
    }

    // Store statistics for different variables by name
    mapping(string => Statistics) private stats;

    /**
     * @notice Initialize statistics for a variable
     * @param name Name of the variable to track
     */
    function initStatistics(string memory name) public {
        if (!ENABLED) return;

        stats[name].totalSamples = 0;
        stats[name].minValue = type(uint256).max;
        stats[name].maxValue = 0;
        stats[name].sum = 0;
    }
    
    /**
     * @notice Record a value in the statistics
     * @param name Name of the variable
     * @param value The value to record
     */
    function recordValue(string memory name, uint256 value) public {
        if (!ENABLED) return;

        Statistics storage stat = stats[name];
        
        // Initialize if not already
        if (stat.totalSamples == 0) {
            initStatistics(name);
        }
        
        // Update basic statistics
        stat.totalSamples++;
        stat.sum += value;
        if (value < stat.minValue) stat.minValue = value;
        if (value > stat.maxValue) stat.maxValue = value;
        
        // Store for percentile calculations
        stat.values.push(value);
    }

    /**
     * @notice Calculate the median of an array of values
     * @param values Sorted array of values
     * @return The median value
     */
    function calculateMedian(uint256[] memory values) internal pure returns (uint256) {
        if (values.length == 0) return 0;
        
        if (values.length % 2 == 0) {
            // Even number of elements - average the middle two
            uint256 mid1 = values[values.length / 2 - 1];
            uint256 mid2 = values[values.length / 2];
            return (mid1 + mid2) / 2;
        } else {
            // Odd number of elements - return the middle one
            return values[values.length / 2];
        }
    }

    /**
     * @notice Calculate a percentile of an array of values
     * @param values Sorted array of values
     * @param percentile The percentile to calculate (0-100)
     * @return The value at the specified percentile
     */
    function calculatePercentile(uint256[] memory values, uint256 percentile) internal pure returns (uint256) {
        if (values.length == 0) return 0;
        if (percentile >= 100) return values[values.length - 1];
        
        uint256 index = (values.length * percentile) / 100;
        if (index >= values.length) index = values.length - 1;
        return values[index];
    }

    /**
     * @notice Calculate the standard deviation
     * @param values Array of values
     * @param mean The mean value
     * @return The standard deviation
     */
    function calculateStdDev(uint256[] memory values, uint256 mean) internal pure returns (uint256) {
        if (values.length <= 1) return 0;
        
        uint256 sumSquaredDiff;
        for (uint i = 0; i < values.length; i++) {
            if (values[i] > mean) {
                sumSquaredDiff += (values[i] - mean) * (values[i] - mean);
            } else {
                sumSquaredDiff += (mean - values[i]) * (mean - values[i]);
            }
        }
        
        return sqrt(sumSquaredDiff / values.length);
    }
    
    /**
     * @notice Square root function using Babylonian method
     * @param x Value to find square root of
     * @return Square root of x
     */
    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        
        return y;
    }
    
    /**
     * @notice Sort an array of values (using quicksort)
     * @param arr Array to sort
     */
    function quickSort(uint256[] memory arr, int left, int right) internal pure {
        int i = left;
        int j = right;
        if (i == j) return;
        uint pivot = arr[uint(left + (right - left) / 2)];
        while (i <= j) {
            while (arr[uint(i)] < pivot) i++;
            while (pivot < arr[uint(j)]) j--;
            if (i <= j) {
                (arr[uint(i)], arr[uint(j)]) = (arr[uint(j)], arr[uint(i)]);
                i++;
                j--;
            }
        }
        if (left < j)
            quickSort(arr, left, j);
        if (i < right)
            quickSort(arr, i, right);
    }
    
    /**
     * @notice Print statistics to console for analysis
     * @param name Name of the variable to print
     * @param decimals Number of decimal places to display
     * @param sampleLimit Optional limit to number of samples to process (to avoid out-of-gas errors)
     */
    function printStatistics(string memory name, uint256 decimals, uint256 sampleLimit) public view {
        if (!ENABLED) return;

        Statistics storage stat = stats[name];
        if (stat.totalSamples == 0) {
            console.log("========================================");
            console.log("Statistics for: %s (no samples)", name);
            console.log("========================================");
            return;
        }

        // Calculate total samples to process (either all samples or limited by sampleLimit)
        uint256 samplesToProcess = sampleLimit > 0 && stat.totalSamples > sampleLimit 
            ? sampleLimit 
            : stat.totalSamples;

        // Make a copy of the values array for sorting (can't sort in storage)
        uint256[] memory valuesCopy = new uint256[](samplesToProcess);
        for (uint i = 0; i < samplesToProcess; i++) {
            // Use evenly distributed sampling if limiting samples
            uint256 index = sampleLimit > 0 && stat.totalSamples > sampleLimit
                ? i * stat.totalSamples / samplesToProcess
                : i;
            valuesCopy[i] = stat.values[index];
        }
        
        // Sort the values for percentile calculations
        if (valuesCopy.length > 1) {
            quickSort(valuesCopy, int(0), int(valuesCopy.length - 1));
        }
        
        // Calculate statistics
        uint256 mean = stat.sum / stat.totalSamples;
        uint256 median = calculateMedian(valuesCopy);
        uint256 stdDev = calculateStdDev(valuesCopy, mean);
        uint256 p25 = calculatePercentile(valuesCopy, 25);
        uint256 p75 = calculatePercentile(valuesCopy, 75);
        uint256 p10 = calculatePercentile(valuesCopy, 10);
        uint256 p90 = calculatePercentile(valuesCopy, 90);
        
        // Print results with formatted numbers
        console.log("========================================");
        console.log("Statistics for:    %s", name);
        console.log("========================================");
        console.log("Processed samples: %s/%s", samplesToProcess, stat.totalSamples);
        console.log("Min value:         %s", formatUint256(stat.minValue, decimals));
        console.log("Max value:         %s", formatUint256(stat.maxValue, decimals));
        console.log("Mean:              %s", formatUint256(mean, decimals));
        console.log("Median:            %s", formatUint256(median, decimals));
        console.log("Std Deviation:     %s", formatUint256(stdDev, decimals));
        console.log("10th percentile:   %s", formatUint256(p10, decimals));
        console.log("25th percentile:   %s", formatUint256(p25, decimals));
        console.log("75th percentile:   %s", formatUint256(p75, decimals));
        console.log("90th percentile:   %s", formatUint256(p90, decimals));
    }
    
    /**
     * @notice Print statistics to console for analysis (using default sample limit)
     * @param name Name of the variable to print
     * @param decimals Number of decimal places to display
     */
    function printStatistics(string memory name, uint256 decimals) public view {
        printStatistics(name, decimals, SAMPLE_LIMIT);
    }
}