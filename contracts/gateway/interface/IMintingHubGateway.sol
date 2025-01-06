// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.10;

import {IMintingHub} from "../../MintingHubV2/interface/IMintingHub.sol";

interface IMintingHubGateway is IMintingHub {
    function notifyInterestPaid(uint256 amount) external;
}
