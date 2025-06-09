import { ethers } from 'ethers';
import  { DecentralizedEUROABI }  from '../../exports/abis/core/DecentralizedEURO';
import { ADDRESS } from '../../exports/address.config';
import { decentralizedEuroState } from './decentralizedEURO';
import { DecentralizedEuroStateExtended } from './dto/deuro.dto';

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
}