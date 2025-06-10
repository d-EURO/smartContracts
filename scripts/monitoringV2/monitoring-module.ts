import { ethers } from 'ethers';
import  { DecentralizedEUROABI }  from '../../exports/abis/core/DecentralizedEURO';
import  { EquityABI }  from '../../exports/abis/core/Equity';
import { ADDRESS } from '../../exports/address.config';
import { decentralizedEuroState } from './decentralizedEURO';
import { equityState } from './equity';
import { DecentralizedEuroStateExtended } from './dto/deuro.dto';
import { EquityStateExtended } from './dto/equity.dto';

export class MonitoringModule {
    private provider: ethers.Provider;
    private blockchainId: number = 1;

    constructor(provider: ethers.Provider, blockchainId: number = 1) {
        this.provider = provider;
        this.blockchainId = blockchainId;
    }

    async getDecentralizedEuroState(): Promise<DecentralizedEuroStateExtended> {
        const deuro = new ethers.Contract(ADDRESS[this.blockchainId].decentralizedEURO, DecentralizedEUROABI, this.provider);
        return decentralizedEuroState(deuro);
    }

    async getEquityState(): Promise<EquityStateExtended> {
        const equity = new ethers.Contract(ADDRESS[this.blockchainId].equity, EquityABI, this.provider);
        return equityState(equity);
    }
}