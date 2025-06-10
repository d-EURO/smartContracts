import { ethers } from 'ethers';
import  { DecentralizedEUROABI }  from '../../exports/abis/core/DecentralizedEURO';
import  { EquityABI }  from '../../exports/abis/core/Equity';
import  { DEPSWrapperABI }  from '../../exports/abis/utils/DEPSWrapper';
import  { SavingsGatewayABI }  from '../../exports/abis/core/SavingsGateway';
import  { StablecoinBridgeABI }  from '../../exports/abis/utils/StablecoinBridge';
import  { FrontendGatewayABI }  from '../../exports/abis/core/FrontendGateway';
import { ADDRESS } from '../../exports/address.config';
import { decentralizedEuroState } from './decentralizedEURO';
import { equityState } from './equity';
import { depsWrapperState } from './depsWrapper';
import { savingsGatewayState } from './savingsGateway';
import { stablecoinBridgeState } from './stablecoinBridge';
import { frontendGatewayState } from './frontendGateway';
import { DecentralizedEuroStateExtended } from './dto/deuro.dto';
import { EquityStateExtended } from './dto/equity.dto';
import { DEPSWrapperStateExtended } from './dto/depsWrapper.dto';
import { SavingsGatewayStateExtended } from './dto/savingsGateway.dto';
import { StablecoinBridgeState, Bridge } from './dto/stablecoinBridge.dto';
import { FrontendGatewayState } from './dto/frontendGateway.dto';

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

    async getFrontendGatewayState(): Promise<FrontendGatewayState> {
        const frontendGateway = new ethers.Contract(ADDRESS[this.blockchainId].frontendGateway, FrontendGatewayABI, this.provider);
        return frontendGatewayState(frontendGateway);
    }

    async getBridgeState(bridgeType: Bridge): Promise<StablecoinBridgeState> {
        const bridgeAddress = ADDRESS[this.blockchainId][bridgeType as keyof typeof ADDRESS[1]];
        const bridge = new ethers.Contract(bridgeAddress, StablecoinBridgeABI, this.provider);
        return stablecoinBridgeState(bridge, bridgeType);
    }

    async getAllBridgeStates(): Promise<StablecoinBridgeState[]> {
        const bridges = Object.values(Bridge);
        return Promise.all(
            bridges.map(bridge => this.getBridgeState(bridge))
        );
    }
}