// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {console} from "forge-std/Test.sol";
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

contract Handler is TestHelper {
    /// @dev Contract deployer
    address internal s_deployer;

    /// @dev Alice address
    address internal s_alice;

    /// @dev DecentralizedEURO
    DecentralizedEURO internal s_deuro;

    /// @dev TestToken
    TestToken internal s_collateralToken;

    /// @dev MintingHubGateway
    MintingHubGateway internal s_mintingHubGateway;

    /// @dev Alice's positions
    Position[] internal s_positionsAlice;

    // OUTPUT VARS - used to print a summary of calls and reverts during certain actions

    /// @dev The number of calls to createPosition
    uint256 internal s_createPositionCalls;
    /// @dev The number of reverts on calling `createPosition`
    uint256 internal s_createPositionReverts;

    /// @dev The number of calls to adjustMint
    uint256 internal s_adjustMintCalls;
    /// @dev The number of reverts on calling `adjustMint`
    uint256 internal s_adjustMintReverts;

    constructor(
        DecentralizedEURO deuro,
        TestToken collateralToken,
        MintingHubGateway mintingHubGateway, 
        address deployer
    ) {
        s_deuro = deuro;
        s_collateralToken = collateralToken;
        s_mintingHubGateway = mintingHubGateway;
        s_deployer = deployer;

        s_alice = vm.addr(1); 
        vm.label(s_alice, "Alice");
    }

    /// @dev creatPosition
    function createPosition(
        uint256 minCollateral,
        uint256 initialCollateral,
        uint256 initialLimit,
        uint40 initPeriod,
        uint40 duration,
        uint40 challengePeriod,
        uint256 liqPrice,
        uint24 reservePPM,
        bytes32 frontendCode,
        uint24 riskPremiumPPM
    ) public {
        s_createPositionCalls++;

        // start out with just one position // TODO: remove
        if (s_positionsAlice.length > 0) return;

        // bound inputs
        minCollateral = bound(minCollateral, 1e18, 1e20);
        initialCollateral = bound(initialCollateral, minCollateral, 1e22);
        liqPrice = bound(liqPrice, 5000e36 / minCollateral, 1e24); // minCollateral * liqPrice >= 5000 dEURO
        initialLimit = bound(initialLimit, 1e27, 1e30);
        initPeriod = uint40(bound(initPeriod, 3 days, 10 days)); // min 3 days
        duration = uint40(bound(duration, 1 days, 30 days));
        challengePeriod = uint40(bound(challengePeriod, 1 days, 3 days));
        reservePPM = uint24(bound(reservePPM, 0, 500_000));
        riskPremiumPPM = uint24(bound(riskPremiumPPM, 0, 500_000));

        // Mint collateral token to Alice (5x initialCollateral)
        vm.prank(s_deployer);
        s_collateralToken.transfer(s_alice, 5 * initialCollateral);

        // Mint position opening fee (1000 dEURO)
        vm.prank(s_deployer);
        s_deuro.mint(s_alice, 1000e18);

        // Alice creates a new position
        vm.prank(s_alice);
        s_collateralToken.approve(address(s_mintingHubGateway), initialCollateral);

        vm.prank(s_alice);
        try s_mintingHubGateway.openPosition(
            address(s_collateralToken),            
            minCollateral,  
            initialCollateral,
            initialLimit,
            initPeriod,    
            duration,      
            challengePeriod,
            riskPremiumPPM, 
            liqPrice,  
            reservePPM,
            frontendCode
        ) returns (address position) {
            s_positionsAlice.push(Position(position));
            // TODO: Mint some dEURO to Alice
        } catch {
            s_createPositionReverts++;
        }
    }

    /// @dev adjustMint
    function adjustMint(uint256 positionIdx, uint256 newPrincipal) public {
        s_adjustMintCalls++;

        // Get the position
        Position position = s_positionsAlice[positionIdx % s_positionsAlice.length];

        // Bound newPrincipal
        uint256 basePrice = position.price();
        uint256 minimumCollateral = position.minimumCollateral();
        uint256 collateralReserve = s_collateralToken.balanceOf(address(position));
        uint256 relevantCollateral = collateralReserve < minimumCollateral ? 0 : collateralReserve;
        uint256 maxEligiblePrincipal = relevantCollateral * basePrice / 1e18;
        newPrincipal = bound(newPrincipal, 0, maxEligiblePrincipal);
        if (newPrincipal < minimumCollateral) newPrincipal = 0;

        // Alice adjusts the position principal
        vm.prank(s_alice);
        try position.adjust(newPrincipal, relevantCollateral, basePrice) {
            // success
        } catch {
            s_adjustMintReverts++;
        }
    }

    /// @dev Prints a call summary of calls and reverts to certain actions
    function callSummary() external view {
        console.log("createPosition Calls: %s", s_createPositionCalls);
        console.log("createPosition Reverts: %s", s_createPositionReverts);
        console.log("adjustMint Calls: %s", s_adjustMintCalls);
        console.log("adjustMint Reverts: %s", s_adjustMintReverts);
        console.log("Number of Alice's positions: %s", s_positionsAlice.length);
        console.log("Alice collateral balance: %s", s_collateralToken.balanceOf(s_alice));
        console.log("Alice dEURO balance: %s", s_deuro.balanceOf(s_alice));
    }

    // Helper functions

    /// @dev Get Alice's positions
    function getPositionsAlice() external view returns (Position[] memory) {
        return s_positionsAlice;
    }
}