// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Position} from "../MintingHubV2/Position.sol";
import {MintingHubGateway} from "../gateway/MintingHubGateway.sol";
import {IMintingHubGateway} from "../gateway/interface/IMintingHubGateway.sol";
import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {TestToken} from "./TestToken.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract PositionExpirationTest {
    MintingHubGateway public hub;
    TestToken public col;
    IDecentralizedEURO public deuro;
    bytes32 public frontendCode;

    constructor(address hub_) {
        hub = MintingHubGateway(hub_);
        col = new TestToken("Some Collateral", "COL", uint8(0));
        deuro = hub.DEURO();
    }

    function openPositionFor(address owner, bytes32 frontendCode_) public returns (address) {
        frontendCode = frontendCode_;
        col.mint(address(this), 100);
        col.approve(address(hub), 100);
        deuro.approve(address(hub), hub.OPENING_FEE());
        address pos;
        if (IERC165(hub).supportsInterface(type(IMintingHubGateway).interfaceId)) {
            pos = hub.openPosition(
                address(col),
                10,
                100 /* collateral */,
                1000000 * 10 ** 18,
                7 days,
                30 days,
                1 days,
                50000,
                1000 * 10 ** 36 /* price */,
                200000,
                frontendCode
            );
        } else {
            pos = hub.openPosition(
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
        }
        Position(pos).transferOwnership(owner);
        return pos;
    }

    function approveDEURO(address spender, uint256 amount) external {
        deuro.approve(spender, amount);
    }

    function forceBuy(address pos, uint256 amount) public {
        uint256 price = hub.expiredPurchasePrice(Position(pos));
        uint256 balanceBefore = deuro.balanceOf(address(this));
        uint256 colBalBefore = col.balanceOf(address(this));
        amount = hub.buyExpiredCollateral(Position(pos), amount);
        uint256 balanceAfter = deuro.balanceOf(address(this));
        uint256 colBalAfter = col.balanceOf(address(this));
        require(colBalAfter - colBalBefore == amount, "collateral amount");
        require((balanceBefore - balanceAfter) == ((amount * price) / 10 ** 18), "price paid");
    }
}
