import { ethers } from 'ethers';
import {
  ADDRESS,
  DecentralizedEUROABI,
  EquityABI,
  DEPSWrapperABI,
  SavingsGatewayABI,
  FrontendGatewayABI,
  MintingHubGatewayABI,
  PositionRollerABI,
} from '@deuro/eurocoin';
import { SystemEventsData, SystemStateData, ContractSet, MintingHubPositionOpenedEvent } from './dto';
import { EventsService } from './services/eventsService';
import { StatesService } from './services/statesService';

export class MonitoringModule {
  private provider: ethers.Provider;
  private blockchainId: number;
  private contracts: ContractSet;
  private eventsService: EventsService;
  private statesService: StatesService;

  constructor(provider: ethers.Provider, blockchainId: number = 1) {
    this.provider = provider;
    this.blockchainId = blockchainId;
    this.contracts = this.createAllContracts();
    this.eventsService = new EventsService(this.contracts, this.provider);
    this.statesService = new StatesService(this.contracts, this.provider, this.blockchainId);
  }

  async getSystemEvents(fromBlock: number, toBlock: number): Promise<SystemEventsData> {
    return this.eventsService.getSystemEvents(fromBlock, toBlock);
  }

  async getSystemState(positionEvents: MintingHubPositionOpenedEvent[]): Promise<SystemStateData> {
    return this.statesService.getSystemState(positionEvents);
  }

  private createAllContracts(): ContractSet {
    return {
      deuroContract: new ethers.Contract(
        ADDRESS[this.blockchainId].decentralizedEURO,
        DecentralizedEUROABI,
        this.provider,
      ),
      equityContract: new ethers.Contract(ADDRESS[this.blockchainId].equity, EquityABI, this.provider),
      depsContract: new ethers.Contract(ADDRESS[this.blockchainId].DEPSwrapper, DEPSWrapperABI, this.provider),
      savingsContract: new ethers.Contract(ADDRESS[this.blockchainId].savingsGateway, SavingsGatewayABI, this.provider),
      frontendGatewayContract: new ethers.Contract(
        ADDRESS[this.blockchainId].frontendGateway,
        FrontendGatewayABI,
        this.provider,
      ),
      mintingHubContract: new ethers.Contract(
        ADDRESS[this.blockchainId].mintingHubGateway,
        MintingHubGatewayABI,
        this.provider,
      ),
      rollerContract: new ethers.Contract(ADDRESS[this.blockchainId].roller, PositionRollerABI, this.provider),
    };
  }
}
