// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title Functions for share valuation
 */
contract MathUtil {
    uint256 internal constant ONE_DEC18 = 10 ** 18;

    // Let's go for 12 digits of precision (18-6)
    uint256 internal constant THRESH_DEC18 = 10 ** 6;

    /**
     * @notice Fifth root with Halley approximation
     *         Number 1e18 decimal
     * @param _v     number for which we calculate x**(1/5)
     * @return returns _v**(1/5)
     */
    function _fifthRoot(uint256 _v) internal pure returns (uint256) {
        // Good first guess for _v slightly above 1.0, which is often the case in the JUSD system
        uint256 x = _v > ONE_DEC18 && _v < 10 ** 19 ? (_v - ONE_DEC18) / 5 + ONE_DEC18 : ONE_DEC18;
        uint256 diff;
        do {
            uint256 powX5 = _power5(x);
            uint256 xnew = (x * (2 * powX5 + 3 * _v)) / (3 * powX5 + 2 * _v);
            diff = xnew > x ? xnew - x : x - xnew;
            x = xnew;
        } while (diff > THRESH_DEC18);
        return x;
    }

    function _mulD18(uint256 _a, uint256 _b) internal pure returns (uint256) {
        return (_a * _b) / ONE_DEC18;
    }

    function _divD18(uint256 _a, uint256 _b) internal pure returns (uint256) {
        return (_a * ONE_DEC18) / _b;
    }

    function _power5(uint256 _x) internal pure returns (uint256) {
        return _mulD18(_mulD18(_mulD18(_mulD18(_x, _x), _x), _x), _x);
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
    
    /**
     * @notice Performs ceiling division for PPM calculations using formula: ceil(amount / (1 - ppm/1000000))
     * @param amount The base amount to divide
     * @param ppm Parts per million value (e.g., 200000 for 20%)
     * @return The result of ceiling division
     */
    function _ceilDivPPM(uint256 amount, uint24 ppm) internal pure returns (uint256) {
        return amount == 0 ? 0 : (amount * 1_000_000 - 1) / (1_000_000 - ppm) + 1;
    }
}
