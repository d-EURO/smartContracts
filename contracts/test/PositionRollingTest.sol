// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// import "./Strings.sol";
import "./TestToken.sol";
import "../Equity.sol";
import "../MintingHubV2/Position.sol";
import "../MintingHubV2/MintingHub.sol";
import "../StablecoinBridge.sol";
import "../MintingHubV2/interface/IPosition.sol";
import "../interface/IReserve.sol";
import "../interface/IDecentralizedEURO.sol";

contract PositionRollingTest {
    MintingHub hub;
    TestToken col;
    IDecentralizedEURO deuro;
    PositionRoller roller;

    IPosition public p1;
    IPosition public p2;

    constructor(address hub_) {
        hub = MintingHub(hub_);
        col = new TestToken("Some Collateral", "COL", uint8(0));
        deuro = hub.DEURO();
        roller = hub.ROLLER();
    }

    function openTwoPositions() public {
        deuro.approve(address(hub), hub.OPENING_FEE());
        p1 = IPosition(openPosition(100, uint40(3 days)));
        deuro.approve(address(hub), hub.OPENING_FEE());
        p2 = IPosition(openPosition(10, uint40(7 days)));
    }

    function mintFromFirstPosition(uint256 amount) public {
        p1.mint(address(this), amount);
    }

    function openPosition(uint256 collateral, uint40 initializationDelay) public returns (address) {
        col.mint(address(this), collateral);
        col.approve(address(hub), collateral);
        return
            hub.openPosition(
                address(col),
                10,
                collateral,
                1000000 * 10 ** 18,
                initializationDelay,
                30 days,
                1 days,
                50000,
                1000 * 10 ** 36,
                200000
            );
    }

    function roll() public {
        col.approve(address(roller), col.balanceOf(address(p1))); // approve full balance
        roller.rollFully(p1, p2);
        require(p1.getDebt() == 0);
        require(deuro.balanceOf(address(this)) == 0);
    }
}
