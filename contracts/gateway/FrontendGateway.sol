// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Equity} from "../Equity.sol";
import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FrontendGateway is Context {

    IERC20 public immutable DEURO;
    Equity public immutable EQUITY;
    uint256 public immutable FEE_RATE; // Fee rate in PPM (parts per thousand), for example 10 = 1%

    struct FrontendBalance {
        uint256 outstanding;
    }

    mapping(bytes32 => address) public frontendCodes;
    mapping(bytes32 => uint256) public frontendCodesBalances;

    constructor(address deuro_){
        DEURO = IERC20(deuro_);
        EQUITY = Equity(address(IDecentralizedEURO(deuro_).reserve()));
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

    function registerFrontendCode(bytes32 frontendCode) external returns (bool) {
        require(frontendCodes[frontendCode] == address(0), "Frontend code already registered");
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

}
