// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Position} from "../MintingHubV3/Position.sol";
import {MintingHub} from "../MintingHubV3/MintingHub.sol";
import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {TestToken} from "./TestToken.sol";

contract PositionExpirationTest {
    MintingHub public hub;
    TestToken public col;
    IDecentralizedEURO public deuro;

    constructor(address hub_) {
        hub = MintingHub(payable(hub_));
        col = new TestToken("Some Collateral", "COL", uint8(0));
        deuro = hub.DEURO();
    }

    function openPositionFor(address owner) public returns (address) {
        col.mint(address(this), 100);
        col.approve(address(hub), 100);
        deuro.approve(address(hub), hub.OPENING_FEE());
        address pos = hub.openPosition(
            address(col),
            10,
            100 /* collateral */,
            1000000 * 10 ** 18,
            7 days,
            30 days,
            1 days,
            50000,
            1000 * 10 ** 36 /* price */,
            200000
        );
        Position(payable(pos)).transferOwnership(owner);
        return pos;
    }

    function approveDEURO(address spender, uint256 amount) external {
        deuro.approve(spender, amount);
    }

    function forceBuy(address pos, uint256 amount) public {
        uint256 price = hub.expiredPurchasePrice(Position(payable(pos)));
        uint256 balanceBefore = deuro.balanceOf(address(this));
        uint256 colBalBefore = col.balanceOf(address(this));
        amount = hub.buyExpiredCollateral(Position(payable(pos)), amount);
        uint256 balanceAfter = deuro.balanceOf(address(this));
        uint256 colBalAfter = col.balanceOf(address(this));
        require(colBalAfter - colBalBefore == amount, "collateral amount");
        require((balanceBefore - balanceAfter) == ((amount * price) / 10 ** 18), "price paid");
    }
}
