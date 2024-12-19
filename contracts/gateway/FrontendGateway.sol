// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Equity} from "../Equity.sol";
import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DEPSWrapper} from "../utils/DEPSWrapper.sol";

contract FrontendGateway is Context {

    IERC20 public immutable DEURO;
    Equity public immutable EQUITY;
    DEPSWrapper public immutable DEPS;
    uint256 public immutable FEE_RATE; // Fee rate in PPM (parts per thousand), for example 10 = 1%

    struct FrontendBalance {
        uint256 outstanding;
    }

    mapping(bytes32 => address) public frontendCodes;
    mapping(bytes32 => uint256) public frontendCodesBalances;

    constructor(address deuro_, address deps_) {
        DEURO = IERC20(deuro_);
        EQUITY = Equity(address(IDecentralizedEURO(deuro_).reserve()));
        DEPS = DEPSWrapper(deps_);
        FEE_RATE = 10; // 10/1000 = 1% fee
    }

    // ToDo: Invest
    function invest(uint256 amount, uint256 expectedShares, bytes32 frontendCode) external returns (uint256) {
        uint256 actualShares = EQUITY.investFor(_msgSender(), amount, expectedShares);
        frontendCodesBalances[frontendCode] += (amount * FEE_RATE) / 1000;
        return actualShares;
    }

    // ToDo: Redeem
    function redeem(address target, uint256 shares, bytes32 frontendCode) external returns (uint256) {
        uint256 expectedProceeds = EQUITY.calculateProceeds(shares);
        uint256 actualProceeds = EQUITY.redeemFrom(_msgSender(), address(this), shares, expectedProceeds);
        frontendCodesBalances[frontendCode] += (actualProceeds * FEE_RATE) / 1000;
        return actualProceeds;
    }

    function unwrapAndSell(uint256 amount, bytes32 frontendCode) external returns (uint256) {
        DEPS.transferFrom(_msgSender(), address(this), amount);
        uint256 actualProceeds = DEPS.unwrapAndSell(amount);
        DEURO.transfer(_msgSender(), actualProceeds);

        frontendCodesBalances[frontendCode] += (actualProceeds * 10) / 1000;
        return actualProceeds;
    }

    function registerFrontendCode(bytes32 frontendCode) external returns (bool) {
        require(frontendCodes[frontendCode] == address(0), "Frontend code already exists");
        frontendCodes[frontendCode] = _msgSender();
        return true;
    }

    function withdrawRewards(bytes32 frontendCode) external returns (uint256) {
        require(frontendCodes[frontendCode] == _msgSender(), "Only the owner can claim the rewards");
        uint256 amount = frontendCodesBalances[frontendCode];
        delete frontendCodesBalances[frontendCode];
        IDecentralizedEURO(address(DEURO)).coverLoss(_msgSender(), amount);
        return amount;
    }

    // ToDo: Save
    // ToDo: WithdrawSaving
    // ToDo: Mint

    // ToDo: 2. ClonePosition
    // ToDo: 2.1. Create Position https://etherscan.io/address/0x86db50a14b35f71c2d81a0ae19eb20503587f596#writeContract
    // ToDo: 3. Adjust
    // ToDo: 3.1. Save https://etherscan.io/address/0xf55f2d6679cf712f62b6c034abf7060a170ec127#writeContract

}
