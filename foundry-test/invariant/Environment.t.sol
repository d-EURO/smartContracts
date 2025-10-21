// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {Position} from "../../contracts/MintingHubV2/Position.sol";
import {JuiceDollar} from "../../contracts/JuiceDollar.sol";
import {TestToken} from "../../contracts/test/TestToken.sol";
import {PositionFactory} from "../../contracts/MintingHubV2/PositionFactory.sol";
import {SavingsGateway} from "../../contracts/gateway/SavingsGateway.sol";
import {FrontendGateway} from "../../contracts/gateway/FrontendGateway.sol";
import {MintingHubGateway} from "../../contracts/gateway/MintingHubGateway.sol";
import {PositionRoller} from "../../contracts/MintingHubV2/PositionRoller.sol";
import {Equity} from "../../contracts/Equity.sol";
import {TestHelper} from "../TestHelper.sol";
import {MintingHub} from "../../contracts/MintingHubV2/MintingHub.sol";
import {IPosition} from "../../contracts/MintingHubV2/interface/IPosition.sol";

contract Environment is TestHelper {
    JuiceDollar internal s_JUSD;
    TestToken internal s_collateralToken;
    MintingHubGateway internal s_mintingHubGateway;
    PositionRoller internal s_positionRoller;
    PositionFactory internal s_positionFactory;
    Equity internal s_equity;
    FrontendGateway internal s_frontendGateway;
    SavingsGateway internal s_savingsGateway;
    Position[] internal s_positions;
    address[] internal s_eoas; // EOAs
    address internal s_deployer;

    constructor() {
        s_JUSD = new JuiceDollar(3 days);
        s_collateralToken = new TestToken("Collateral", "COL", 18);
        s_positionRoller = new PositionRoller(address(s_JUSD));
        s_positionFactory = new PositionFactory();
        s_equity = Equity(address(s_JUSD.reserve()));
        s_frontendGateway = new FrontendGateway(address(s_JUSD));
        s_savingsGateway = new SavingsGateway(s_JUSD, 5, address(s_frontendGateway));
        s_mintingHubGateway = new MintingHubGateway(
            address(s_JUSD),
            address(s_savingsGateway),
            address(s_positionRoller),
            address(s_positionFactory),
            address(s_frontendGateway)
        );

        // initialize contracts
        s_deployer = msg.sender;
        vm.label(s_deployer, "Deployer");
        s_frontendGateway.init(address(s_savingsGateway), address(s_mintingHubGateway));
        s_JUSD.initialize(address(s_mintingHubGateway), "Make MintingHubGateway minter");
        s_JUSD.initialize(s_deployer, "Make Invariants contract minter");
        increaseBlocks(1);

        // create EOAs
        address alice = vm.addr(1);
        vm.label(alice, "Alice");
        address bob = vm.addr(2);
        vm.label(bob, "Bob");
        address charlie = vm.addr(3);
        vm.label(charlie, "Charlie");
        address david = vm.addr(4);
        vm.label(david, "David");
        address eve = vm.addr(5);
        vm.label(eve, "Eve");
        s_eoas = [alice, bob, charlie, david, eve];

        // create positions
        createPosition(alice);
        increaseTime(5 days); // >= initPeriod
    }

    function createPosition(address owner) internal {
        address collateral = address(s_collateralToken); // collateral token
        uint256 minCollateral = 1e18; // min collateral
        uint256 initialCollateral = 110e18; // initial collateral
        uint256 initialLimit = 550_000e18; // initial limit / minting maximum
        uint40 initPeriod = 3 days; // init period
        uint40 duration = 365 days; // expiration / duration
        uint40 challengePeriod = 3 days; // challenge period
        uint24 riskPremium = 10_000; // risk premium
        uint256 liqPrice = 5000 * 10 ** (36 - s_collateralToken.decimals()); // liquidation price
        uint24 reservePPM = 100_000; // reserve PPM
        bytes32 frontendCode = bytes32(keccak256(abi.encodePacked(owner))); // frontend code

        // Mint opening fee and collateral
        uint256 openingFee = s_mintingHubGateway.OPENING_FEE();
        mintCOL(owner, initialCollateral);
        mintJUSD(owner, openingFee);

        vm.startPrank(owner);
        s_JUSD.approve(address(s_mintingHubGateway), openingFee); // approve open fee
        s_collateralToken.approve(address(s_mintingHubGateway), initialCollateral); // approve collateral
        address position = s_mintingHubGateway.openPosition( // open position
                collateral,
                minCollateral,
                initialCollateral,
                initialLimit,
                initPeriod,
                duration,
                challengePeriod,
                riskPremium,
                liqPrice,
                reservePPM,
                frontendCode
            );
        vm.stopPrank();
        s_positions.push(Position(position));
    }

    /// Getters
    function jusd() public view returns (JuiceDollar) {
        return s_JUSD;
    }

    function collateralToken() public view returns (TestToken) {
        return s_collateralToken;
    }

    function mintingHubGateway() public view returns (MintingHubGateway) {
        return s_mintingHubGateway;
    }

    function positionRoller() public view returns (PositionRoller) {
        return s_positionRoller;
    }

    function positionFactory() public view returns (PositionFactory) {
        return s_positionFactory;
    }

    function frontendGateway() public view returns (FrontendGateway) {
        return s_frontendGateway;
    }

    function savingsGateway() public view returns (SavingsGateway) {
        return s_savingsGateway;
    }

    function getPosition(uint256 index) public view returns (Position) {
        return s_positions[index % s_positions.length];
    }

    function getPositions() public view returns (Position[] memory) {
        return s_positions;
    }

    function positionCount() public view returns (uint256) {
        return s_positions.length;
    }

    function getChallenge(
        uint32 index,
        uint32 maxIndex
    ) public view returns (uint32 validIndex, MintingHub.Challenge memory) {
        MintingHub.Challenge memory challenge;

        for (uint32 i = 0; i < maxIndex; i++) {
            uint32 idx = (index + i) % maxIndex;
            (address challenger, uint40 start, IPosition pos, uint256 size) = s_mintingHubGateway.challenges(idx);
            if (pos != IPosition(address(0))) {
                challenge = MintingHub.Challenge(challenger, start, pos, size);
                return (idx, challenge);
            }
        }

        return (maxIndex + 1, challenge);
    }

    function eoas(uint256 index) public view returns (address) {
        return s_eoas[index % s_eoas.length];
    }

    /// Helpers

    function mintJUSD(address to, uint256 amount) public {
        uint256 toBalance = s_JUSD.balanceOf(to);
        if (toBalance < amount) {
            vm.startPrank(s_deployer);
            s_JUSD.mint(to, amount - toBalance);
            vm.stopPrank();
        }
    }

    function mintCOL(address to, uint256 amount) public {
        uint256 toBalance = s_collateralToken.balanceOf(to);
        if (toBalance < amount) {
            vm.startPrank(s_deployer);
            s_collateralToken.mint(to, amount - toBalance);
            vm.stopPrank();
        }
    }
}
