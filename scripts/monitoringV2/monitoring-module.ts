import { ethers } from 'ethers';
import  { DecentralizedEUROABI }  from '../../exports/abis/core/DecentralizedEURO';
import  { EquityABI }  from '../../exports/abis/core/Equity';
import  { DEPSWrapperABI }  from '../../exports/abis/utils/DEPSWrapper';
import  { SavingsGatewayABI }  from '../../exports/abis/core/SavingsGateway';
import { ADDRESS } from '../../exports/address.config';
import { decentralizedEuroState } from './decentralizedEURO';
import { equityState } from './equity';
import { depsWrapperState } from './depsWrapper';
import { savingsGatewayState } from './savingsGateway';
import { DecentralizedEuroStateExtended } from './dto/deuro.dto';
import { EquityStateExtended } from './dto/equity.dto';
import { DEPSWrapperStateExtended } from './dto/depsWrapper.dto';
import { SavingsGatewayStateExtended } from './dto/savingsGateway.dto';

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

    async getDEPSWrapperState(): Promise<DEPSWrapperStateExtended> {
        const depsWrapper = new ethers.Contract(ADDRESS[this.blockchainId].DEPSwrapper, DEPSWrapperABI, this.provider);
        return depsWrapperState(depsWrapper);
    }

    async getSavingsGatewayState(): Promise<SavingsGatewayStateExtended> {
        const savingsGateway = new ethers.Contract(ADDRESS[this.blockchainId].savingsGateway, SavingsGatewayABI, this.provider);
        const deuro = new ethers.Contract(ADDRESS[this.blockchainId].decentralizedEURO, DecentralizedEUROABI, this.provider);
        return savingsGatewayState(savingsGateway, deuro);
    }
}