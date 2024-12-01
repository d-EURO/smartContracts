// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Equity} from "../Equity.sol";
import {IDecentralizedEURO} from "../interface/IDecentralizedEURO.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FrontendGateway is Context {

    IERC20 public immutable DEURO;
    Equity public immutable EQUITY;

    mapping(bytes32 => address) public frontendCodes;
    mapping(bytes32 => uint256) public frontendCodesBalances;

    constructor(IDecentralizedEURO deuro_){
        DEURO = deuro_;
    }

    function save(address owner, uint192 amount, bytes32 frontendCode) public {

    }

    function invest(uint256 amount, uint256 expectedShares, bytes32 frontendCode) external returns (uint256) {
        DEURO.transferFrom(_msgSender(), address(this), amount);
        EQUITY.invest(amount, expectedShares);

        return 0;
    }

    // ToDo: Save
    // ToDo: WithdrawSaving
    // ToDo: Mint
    // ToDo: Invest
    // ToDo: Redeem
}
