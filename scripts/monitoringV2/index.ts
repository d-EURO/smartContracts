import { ethers } from 'ethers';
import {
  ADDRESS,
  DecentralizedEUROABI,
  EquityABI,
  DEPSWrapperABI,
  SavingsGatewayABI,
  StablecoinBridgeABI,
  FrontendGatewayABI,
  MintingHubGatewayABI,
  PositionRollerABI,
} from '@deuro/eurocoin';
import { decentralizedEuroState } from './contracts/decentralizedEURO';
import { equityState } from './contracts/equity';
import { depsWrapperState } from './contracts/depsWrapper';
import { savingsGatewayState } from './contracts/savingsGateway';
import { stablecoinBridgeState } from './contracts/stablecoinBridge';
import { frontendGatewayState } from './contracts/frontendGateway';
import { mintingHubState } from './contracts/mintingHub';
import {
  // State DTOs
  DecentralizedEuroState,
  EquityState,
  DEPSWrapperState,
  SavingsGatewayState,
  StablecoinBridgeState,
  Bridge,
  FrontendGatewayState,
  MintingHubState,
  PositionRollerState,

  // Event system DTOs
  DeuroTransferEvent,
  DepsTransferEvent,
  DeuroLossEvent,
  DeuroProfitEvent,
  DeuroMinterAppliedEvent,
  DeuroMinterDeniedEvent,
  DeuroProfitDistributedEvent,
  EquityTradeEvent,
  EquityDelegationEvent,
  DepsWrapEvent,
  DepsUnwrapEvent,
  SavingsSavedEvent,
  SavingsInterestCollectedEvent,
  SavingsWithdrawnEvent,
  SavingsRateProposedEvent,
  SavingsRateChangedEvent,
  MintingHubPositionOpenedEvent,
  RollerRollEvent,

  // Event system DTOs
  SystemEventsData,
  ContractSet,
} from './dto';
import { fetchEvents, mergeEvents, getDeploymentBlock } from './utils';
import { positionRollerState } from './contracts/positionRoller';

export class MonitoringModule {
  private provider: ethers.Provider;
  private blockchainId: number = 1;
  private eventsCacheTTL: number;
  private eventsCacheExpiry: number = 0;
  private eventsCache: SystemEventsData | null = null;
  private contracts: ContractSet | null = null;

  constructor(provider: ethers.Provider, blockchainId: number = 1, eventsCacheTTL: number = 3600000) {
    this.provider = provider;
    this.blockchainId = blockchainId;
    this.eventsCacheTTL = eventsCacheTTL;
  }

  private getContracts(): ContractSet {
    this.contracts ??= this.createAllContracts();
    return this.contracts;
  }

  async getAllEvents(forceRefresh: boolean = false): Promise<SystemEventsData> {
    if (!forceRefresh && this.eventsCache && Date.now() < this.eventsCacheExpiry) {
      return this.eventsCache;
    }

    const contracts = this.getContracts();
    const currentBlock = await this.provider.getBlockNumber();
    const fromBlock = this.eventsCache?.blockRange ? this.eventsCache.blockRange.to + 1 : getDeploymentBlock();
    
    console.log(`\x1b[33mFetching events from block ${fromBlock} to ${currentBlock}\x1b[0m`);
    const newEventsData = await this.fetchEventsInRange(contracts, fromBlock, currentBlock);
    this.eventsCache = this.eventsCache ? this.mergeEventsData(this.eventsCache, newEventsData) : newEventsData;
    this.eventsCacheExpiry = Date.now() + this.eventsCacheTTL;
    return this.eventsCache;
  }

  async getDecentralizedEuroState(): Promise<DecentralizedEuroState> {
    const contracts = this.getContracts();
    console.log(`Fetching DecentralizedEURO state`);
    return decentralizedEuroState(contracts.deuroContract);
  }

  async getEquityState(): Promise<EquityState> {
    const contracts = this.getContracts();
    console.log(`Fetching Equity state`);
    return equityState(contracts.equityContract);
  }

  async getDEPSWrapperState(): Promise<DEPSWrapperState> {
    const contracts = this.getContracts();
    console.log(`Fetching DEPSWrapper state`);
    return depsWrapperState(contracts.depsContract);
  }

  async getSavingsGatewayState(): Promise<SavingsGatewayState> {
    const contracts = this.getContracts();
    console.log(`Fetching SavingsGateway state`);
    return savingsGatewayState(contracts.savingsContract, contracts.deuroContract);
  }

  async getFrontendGatewayState(): Promise<FrontendGatewayState> {
    const contracts = this.getContracts();
    console.log(`Fetching FrontendGateway state`);
    return frontendGatewayState(contracts.frontendGatewayContract);
  }

  async getMintingHubState(positionEvents?: MintingHubPositionOpenedEvent[]): Promise<MintingHubState> {
    const contracts = this.getContracts();
    positionEvents ??= (await this.getAllEvents()).mintingHubPositionOpenedEvents;
    console.log(`Fetching MintingHub positions state`);
    return mintingHubState(contracts.mintingHubContract, positionEvents);
  }

  async getPositionRollerState(): Promise<PositionRollerState> {
    const contracts = this.getContracts();
    console.log(`Fetching PositionRoller state`);
    return positionRollerState(contracts.rollerContract);
  }

  async getBridgeState(bridgeType: Bridge): Promise<StablecoinBridgeState> {
    const bridgeAddress = ADDRESS[this.blockchainId][bridgeType as keyof (typeof ADDRESS)[1]];
    const bridge = new ethers.Contract(bridgeAddress, StablecoinBridgeABI, this.provider);
    console.log(`Fetching ${bridgeType} bridge state`);
    return stablecoinBridgeState(bridge, bridgeType);
  }

  async getAllBridgeStates(): Promise<StablecoinBridgeState[]> {
    const bridges = Object.values(Bridge);
    return Promise.all(bridges.map((bridge) => this.getBridgeState(bridge)));
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

  private async fetchEventsInRange(
    contracts: ContractSet,
    fromBlock: number,
    toBlock: number,
  ): Promise<SystemEventsData> {
    const [
      deuroTransferEvents,
      deuroLossEvents,
      deuroProfitEvents,
      deuroMinterAppliedEvents,
      deuroMinterDeniedEvents,
      deuroProfitsDistributedEvents,
      equityTradeEvents,
      equityDelegationEvents,
      depsTransferEvents,
      savingsSavedEvents,
      savingsInterestCollectedEvents,
      savingsWithdrawnEvents,
      savingsRateProposedEvents,
      savingsRateChangedEvents,
      mintingHubPositionOpenedEvents,
      rollerRollEvents,
    ] = await Promise.all([
      fetchEvents<DeuroTransferEvent>(
        contracts.deuroContract,
        contracts.deuroContract.filters.Transfer(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<DeuroLossEvent>(contracts.deuroContract, contracts.deuroContract.filters.Loss(), fromBlock, toBlock),
      fetchEvents<DeuroProfitEvent>(contracts.deuroContract, contracts.deuroContract.filters.Profit(), fromBlock, toBlock),
      fetchEvents<DeuroMinterAppliedEvent>(
        contracts.deuroContract,
        contracts.deuroContract.filters.MinterApplied(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<DeuroMinterDeniedEvent>(
        contracts.deuroContract,
        contracts.deuroContract.filters.MinterDenied(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<DeuroProfitDistributedEvent>(
        contracts.deuroContract,
        contracts.deuroContract.filters.ProfitDistributed(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<EquityTradeEvent>(contracts.equityContract, contracts.equityContract.filters.Trade(), fromBlock, toBlock),
      fetchEvents<EquityDelegationEvent>(
        contracts.equityContract,
        contracts.equityContract.filters.Delegation(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<DepsTransferEvent>(contracts.depsContract, contracts.depsContract.filters.Transfer(), fromBlock, toBlock),
      fetchEvents<SavingsSavedEvent>(contracts.savingsContract, contracts.savingsContract.filters.Saved(), fromBlock, toBlock),
      fetchEvents<SavingsInterestCollectedEvent>(
        contracts.savingsContract,
        contracts.savingsContract.filters.InterestCollected(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<SavingsWithdrawnEvent>(
        contracts.savingsContract,
        contracts.savingsContract.filters.Withdrawn(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<SavingsRateProposedEvent>(
        contracts.savingsContract,
        contracts.savingsContract.filters.RateProposed(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<SavingsRateChangedEvent>(
        contracts.savingsContract,
        contracts.savingsContract.filters.RateChanged(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<MintingHubPositionOpenedEvent>(
        contracts.mintingHubContract,
        contracts.mintingHubContract.filters.PositionOpened(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<RollerRollEvent>(contracts.rollerContract, contracts.rollerContract.filters.Roll(), fromBlock, toBlock),
    ]);

    const depsWrapEvents: DepsWrapEvent[] = depsTransferEvents
      .filter((event) => event.from === ethers.ZeroAddress)
      .map((event) => ({
        ...event,
        user: event.to,
        amount: event.value,
      }));

    const depsUnwrapEvents: DepsUnwrapEvent[] = depsTransferEvents
      .filter((event) => event.to === ethers.ZeroAddress)
      .map((event) => ({
        ...event,
        user: event.from,
        amount: event.value,
      }));

    return {
      deuroTransferEvents,
      deuroLossEvents,
      deuroProfitEvents,
      deuroMinterAppliedEvents,
      deuroMinterDeniedEvents,
      deuroProfitsDistributedEvents,
      equityTradeEvents,
      equityDelegationEvents,
      depsWrapEvents,
      depsUnwrapEvents,
      depsTransferEvents,
      savingsSavedEvents,
      savingsInterestCollectedEvents,
      savingsWithdrawnEvents,
      savingsRateProposedEvents,
      savingsRateChangedEvents,
      mintingHubPositionOpenedEvents,
      rollerRollEvents,

      // Meta data
      lastEventFetch: Date.now(),
      blockRange: { from: fromBlock, to: toBlock },
    };
  }

  private mergeEventsData(existing: SystemEventsData, newData: SystemEventsData): SystemEventsData {
    return {
      // DecentralizedEURO events
      deuroTransferEvents: mergeEvents(existing.deuroTransferEvents, newData.deuroTransferEvents),
      deuroLossEvents: mergeEvents(existing.deuroLossEvents, newData.deuroLossEvents),
      deuroProfitEvents: mergeEvents(existing.deuroProfitEvents, newData.deuroProfitEvents),
      deuroMinterAppliedEvents: mergeEvents(existing.deuroMinterAppliedEvents, newData.deuroMinterAppliedEvents),
      deuroMinterDeniedEvents: mergeEvents(existing.deuroMinterDeniedEvents, newData.deuroMinterDeniedEvents),
      deuroProfitsDistributedEvents: mergeEvents(existing.deuroProfitsDistributedEvents, newData.deuroProfitsDistributedEvents),

      // Equity events
      equityTradeEvents: mergeEvents(existing.equityTradeEvents, newData.equityTradeEvents),
      equityDelegationEvents: mergeEvents(existing.equityDelegationEvents, newData.equityDelegationEvents),

      // DEPSWrapper events
      depsWrapEvents: mergeEvents(existing.depsWrapEvents, newData.depsWrapEvents),
      depsUnwrapEvents: mergeEvents(existing.depsUnwrapEvents, newData.depsUnwrapEvents),
      depsTransferEvents: mergeEvents(existing.depsTransferEvents, newData.depsTransferEvents),

      // SavingsGateway events
      savingsSavedEvents: mergeEvents(existing.savingsSavedEvents, newData.savingsSavedEvents),
      savingsInterestCollectedEvents: mergeEvents(existing.savingsInterestCollectedEvents, newData.savingsInterestCollectedEvents),
      savingsWithdrawnEvents: mergeEvents(existing.savingsWithdrawnEvents, newData.savingsWithdrawnEvents),
      savingsRateProposedEvents: mergeEvents(existing.savingsRateProposedEvents, newData.savingsRateProposedEvents),
      savingsRateChangedEvents: mergeEvents(existing.savingsRateChangedEvents, newData.savingsRateChangedEvents),

      // MintingHub events
      mintingHubPositionOpenedEvents: mergeEvents(existing.mintingHubPositionOpenedEvents, newData.mintingHubPositionOpenedEvents),

      // PositionRoller events
      rollerRollEvents: mergeEvents(existing.rollerRollEvents, newData.rollerRollEvents),

      // Metadata
      lastEventFetch: Date.now(),
      blockRange: {
        from: Math.min(existing.blockRange.from, newData.blockRange.from),
        to: Math.max(existing.blockRange.to, newData.blockRange.to),
      },
    };
  }
}
