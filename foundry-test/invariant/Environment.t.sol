// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {Position} from "../../contracts/MintingHubV2/Position.sol";
import {DecentralizedEURO} from "../../contracts/DecentralizedEURO.sol";
import {TestToken} from "../../contracts/test/TestToken.sol";
import {PositionFactory} from "../../contracts/MintingHubV2/PositionFactory.sol";
import {SavingsGateway} from "../../contracts/gateway/SavingsGateway.sol";
import {DEPSWrapper} from "../../contracts/utils/DEPSWrapper.sol";
import {FrontendGateway} from "../../contracts/gateway/FrontendGateway.sol";
import {MintingHubGateway} from "../../contracts/gateway/MintingHubGateway.sol";
import {PositionRoller} from "../../contracts/MintingHubV2/PositionRoller.sol";
import {Equity} from "../../contracts/Equity.sol";
import {TestHelper} from "../TestHelper.sol";
import {MintingHub} from "../../contracts/MintingHubV2/MintingHub.sol";
import {IPosition} from "../../contracts/MintingHubV2/interface/IPosition.sol";

contract Environment is TestHelper {
    DecentralizedEURO internal s_deuro;
    TestToken internal s_collateralToken;
    MintingHubGateway internal s_mintingHubGateway;
    PositionRoller internal s_positionRoller;
    PositionFactory internal s_positionFactory;
    DEPSWrapper internal s_depsWrapper;
    FrontendGateway internal s_frontendGateway;
    SavingsGateway internal s_savingsGateway;
    Position[] internal s_positions;
    address[] internal s_eoas; // EOAs
    address internal s_deployer;

    constructor() {
        s_deuro = new DecentralizedEURO(3 days);
        s_collateralToken = new TestToken("Collateral", "COL", 18);
        s_positionRoller = new PositionRoller(address(s_deuro));
        s_positionFactory = new PositionFactory();
        s_depsWrapper = new DEPSWrapper(Equity(address(s_deuro.reserve())));
        s_frontendGateway = new FrontendGateway(address(s_deuro), address(s_depsWrapper));
        s_savingsGateway = new SavingsGateway(s_deuro, 5, address(s_frontendGateway));
        s_mintingHubGateway = new MintingHubGateway(
            address(s_deuro),
            address(s_savingsGateway),
            address(s_positionRoller),
            address(s_positionFactory),
            address(s_frontendGateway)
        );

        // initialize contracts
        s_deployer = msg.sender;
        vm.label(s_deployer, "Deployer");
        s_frontendGateway.init(address(s_savingsGateway), address(s_mintingHubGateway));
        s_deuro.initialize(address(s_mintingHubGateway), "Make MintingHubGateway minter");
        s_deuro.initialize(s_deployer, "Make Invariants contract minter");
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
        mintDEURO(owner, openingFee);

        vm.startPrank(owner);
        s_deuro.approve(address(s_mintingHubGateway), openingFee); // approve open fee
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
    function deuro() public view returns (DecentralizedEURO) {
        return s_deuro;
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

    function depsWrapper() public view returns (DEPSWrapper) {
        return s_depsWrapper;
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

    function mintDEURO(address to, uint256 amount) public {
        uint256 toBalance = s_deuro.balanceOf(to);
        if (toBalance < amount) {
            vm.startPrank(s_deployer);
            s_deuro.mint(to, amount - toBalance);
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
