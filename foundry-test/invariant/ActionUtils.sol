// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {Position} from "../../contracts/MintingHubV2/Position.sol";
import {TestToken} from "../../contracts/test/TestToken.sol";
import {MintingHubGateway} from "../../contracts/gateway/MintingHubGateway.sol";

library ActionUtils {
    function mintToAllowed(Position self) public view returns (bool) {
        return !inCooldown(self) && !challenged(self) && !expired(self) && !closed(self);
    }

    function mintToBounds(Position self) public view returns (uint256 lb, uint256 ub) {
        uint256 currentPrincipal = self.principal();
        uint256 minimumCollateral = self.minimumCollateral();
        uint256 collateralReserve = self.collateral().balanceOf(address(self));
        uint256 relevantCollateral = collateralReserve < minimumCollateral ? 0 : collateralReserve;
        uint256 _maxPrincipal = (relevantCollateral * self.price()) / 1e18;
        uint256 availableForMinting = currentPrincipal + self.availableForMinting();
        _maxPrincipal = _maxPrincipal > availableForMinting ? availableForMinting : _maxPrincipal;
        return (0, _maxPrincipal > currentPrincipal ? _maxPrincipal - currentPrincipal : 0);
    }

    function repayBounds(Position self) public view returns (uint256 lb, uint256 ub) {
        return (0, self.getDebt() + 100e18);
    }

    function addCollateralBounds(Position self) public view returns (uint256 lb, uint256 ub) {
        uint256 collateralReserve = self.collateral().balanceOf(address(self));
        if (collateralReserve >= 10_000_000 * 1e18) return (0, 0);

        uint256 minimumCollateral = self.minimumCollateral();
        uint256 upperBound = collateralReserve < minimumCollateral ? minimumCollateral : collateralReserve;
        return (0, upperBound * 3);
    }

    function withdrawCollateralAllowed(Position self) public view returns (bool) {
        return !inCooldown(self) && !challenged(self);
    }

    function withdrawCollateralBounds(Position self) public view returns (uint256 lb, uint256 ub) {
        uint256 collateralReserve = self.collateral().balanceOf(address(self));
        uint256 requiredCollateral = (self.getCollateralRequirement() * 1e18) / self.price();
        uint256 minimumCollateral = self.minimumCollateral();
        requiredCollateral = requiredCollateral < minimumCollateral ? minimumCollateral : requiredCollateral;
        uint256 maxWithdraw = collateralReserve > requiredCollateral ? collateralReserve - requiredCollateral : 0;
        return (0, maxWithdraw);
    }

    function adjustPriceAllowed(Position self) public view returns (bool) {
        return !inCooldown(self) && !challenged(self) && !expired(self) && !closed(self);
    }

    function adjustPriceBounds(Position self) public view returns (uint256 lb, uint256 ub) {
        uint256 collateralReserve = self.collateral().balanceOf(address(self));
        uint256 requiredCollateralValue = self.getCollateralRequirement();
        uint256 maxMint = requiredCollateralValue + self.availableForMinting();
        if (collateralReserve == 0) return (0, 0);

        uint256 minPrice = (requiredCollateralValue * 1e18) / collateralReserve;
        uint256 maxPrice = (maxMint * 1e18) / collateralReserve;
        uint256 currentPrice = self.price();
        maxPrice = maxPrice > 2 * currentPrice ? 2 * currentPrice : maxPrice;
        return (minPrice, maxPrice);
    }

    function challengeAllowed(Position self) public view returns (bool) {
        return !expired(self) && !closed(self);
    }

    function challengeBounds(Position self) public view returns (uint256 lb, uint256 ub) {
        uint256 minimumCollateral = self.minimumCollateral();
        uint256 collateralReserve = self.collateral().balanceOf(address(self));
        uint256 minColAmount = min(minimumCollateral, collateralReserve);
        uint256 maxColAmount = (collateralReserve * 5) / 4; // 1.25 x collateralReserve
        return (minColAmount, maxColAmount);
    }

    function bidChallengeAllowed(Position self) public view returns (bool) {
        return challenged(self);
    }

    function bidChallengeBounds(Position self) public view returns (uint256 lb, uint256 ub) {
        uint256 challengedAmount = self.challengedAmount();
        return (1, challengedAmount);
    }

    function buyExpiredCollateralAllowed(Position self) public view returns (bool) {
        return expired(self) && !challenged(self);
    }

    function buyExpiredCollateralBounds(Position self) public view returns (uint256 lb, uint256 ub) {
        uint256 maxAmount = self.collateral().balanceOf(address(self));
        return (1, maxAmount);
    }

    function expirePositionAllowed(Position self) public view returns (bool) {
        return !expired(self) && !closed(self);
    }

    function passCooldownAllowed(Position self) public view returns (bool) {
        return inCooldown(self);
    }

    function inCooldown(Position self) internal view returns (bool) {
        return self.cooldown() > block.timestamp;
    }

    function challenged(Position self) internal view returns (bool) {
        return self.challengedAmount() > 0;
    }

    function expired(Position self) internal view returns (bool) {
        return block.timestamp >= self.expiration();
    }

    function closed(Position self) internal view returns (bool) {
        return self.isClosed();
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
