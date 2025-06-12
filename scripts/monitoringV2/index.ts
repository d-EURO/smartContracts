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
  PositionV2ABI,
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
  PositionDeniedEvent,

  // Event system DTOs
  SystemEventsData,
  ContractSet,
} from './dto';
import { fetchEvents, mergeEvents, getDeploymentBlock } from './utils';
import { db } from './database/client';
import { eventPersistence } from './database/eventPersistence';
import { statePersistence } from './database/statePersistence';

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
    const cacheValid = !forceRefresh && this.eventsCache && Date.now() < this.eventsCacheExpiry;
    
    if (cacheValid) {
      console.log('\x1b[32m[Cache] Using cached events data\x1b[0m');
      // TODO: Does eventsCache make sense as it's currently implemented? 
      return this.eventsCache!;
    }

    const contracts = this.getContracts();
    const currentBlock = await this.provider.getBlockNumber();
    const lastProcessedBlock = await db.getLastProcessedBlock();
    const fromBlock = lastProcessedBlock ? lastProcessedBlock + 1 : getDeploymentBlock();
    const newEventsData = await this.fetchEventsInRange(contracts, fromBlock, currentBlock);
    await this.persistEvents(newEventsData);
    
    const totalEvents = Object.values(newEventsData).reduce((sum, events) => {
      return sum + (Array.isArray(events) ? events.length : 0);
    }, 0);
    await db.recordMonitoringCycle(currentBlock, totalEvents, 0);
    
    // TODO: Is mergeEventsData really necessary at all?
    if (this.eventsCache && fromBlock > getDeploymentBlock()) {
      this.eventsCache = this.mergeEventsData(this.eventsCache, newEventsData);
    } else {
      this.eventsCache = newEventsData;
    }
    
    this.eventsCacheExpiry = Date.now() + this.eventsCacheTTL;
    console.log(`\x1b[32m[Cache] Updated events cache with ${totalEvents} new events\x1b[0m`);
    return this.eventsCache;
  }

  getCacheStats() {
    const now = Date.now();
    const cacheValid = this.eventsCache && now < this.eventsCacheExpiry;
    const timeToExpiry = cacheValid ? Math.round((this.eventsCacheExpiry - now) / 1000) : 0;
    
    return {
      eventsCacheValid: cacheValid,
      eventsCacheTimeToExpirySeconds: timeToExpiry,
      eventsCacheSizeApprox: this.eventsCache ? Object.keys(this.eventsCache).length : 0,
    };
  }

  clearCaches() {
    this.eventsCache = null;
    this.eventsCacheExpiry = 0;
    console.log('\x1b[33m[Cache] Cleared all caches\x1b[0m');
  }

  async getDecentralizedEuroState(): Promise<DecentralizedEuroState> {
    const contracts = this.getContracts();
    console.log(`Fetching DecentralizedEURO state`);
    const state = await decentralizedEuroState(contracts.deuroContract);
    await statePersistence.persistDeuroState(state);
    
    return state;
  }

  async getEquityState(): Promise<EquityState> {
    const contracts = this.getContracts();
    console.log(`Fetching Equity state`);
    const state = await equityState(contracts.equityContract);
    await statePersistence.persistEquityState(state);
    
    return state;
  }

  async getDEPSWrapperState(): Promise<DEPSWrapperState> {
    const contracts = this.getContracts();
    console.log(`Fetching DEPSWrapper state`);
    const state = await depsWrapperState(contracts.depsContract);
    await statePersistence.persistDepsState(state);
    
    return state;
  }

  async getSavingsGatewayState(): Promise<SavingsGatewayState> {
    const contracts = this.getContracts();
    console.log(`Fetching SavingsGateway state`);
    const state = await savingsGatewayState(contracts.savingsContract, contracts.deuroContract);
    await statePersistence.persistSavingsState(state);
    
    return state;
  }

  async getFrontendGatewayState(): Promise<FrontendGatewayState> {
    const contracts = this.getContracts();
    console.log(`Fetching FrontendGateway state`);
    const state = await frontendGatewayState(contracts.frontendGatewayContract);
    await statePersistence.persistFrontendState(state);
    
    return state;
  }

  async getMintingHubState(positionEvents?: MintingHubPositionOpenedEvent[]): Promise<MintingHubState> {
    const contracts = this.getContracts();
    positionEvents ??= (await this.getAllEvents()).mintingHubPositionOpenedEvents;
    console.log(`Fetching MintingHub positions state`);
    const state = await mintingHubState(contracts.mintingHubContract, positionEvents);
    await statePersistence.persistPositionsState(state);
    
    return state;
  }

  // TODO: Would it be possible to identify Bridges by their ABI and simply filter them from the 
  // set of active minters? This way we don't have to make any changes when a new bridge is deployed.
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
    console.log(`\x1b[33mFetching events from block ${fromBlock} to ${toBlock}\x1b[0m`);

    const [
      deuroTransferEvents,
      deuroLossEvents,
      deuroProfitEvents,
      deuroMinterAppliedEvents,
      deuroMinterDeniedEvents,
      deuroProfitDistributedEvents,
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

    // TODO: This won't work as intended. We instead need to fetch all active (not closed) positions from the database,
    // filter those that have not passed their start time yet and then fetch PositionDenied events for those.
    console.log(`\x1b[33mFetching PositionDenied events from ${mintingHubPositionOpenedEvents.length} position contracts\x1b[0m`);
    const openedPositions = Array.from(
      new Set(mintingHubPositionOpenedEvents.map(event => event.position))
    ).filter(address => address && address !== ethers.ZeroAddress);

    const positionDeniedEventsPromises = openedPositions.map(async (positionAddress) => {
      try {
        const positionContract = new ethers.Contract(positionAddress, PositionV2ABI, this.provider);
        const events = await fetchEvents<PositionDeniedEvent>(
          positionContract,
          positionContract.filters.PositionDenied(),
          fromBlock,
          toBlock
        );
        // Add the position address to each event for context
        return events.map(event => ({
          ...event,
          position: positionAddress,
        }));
      } catch (error) {
        console.warn(`\x1b[33mFailed to fetch PositionDenied events from position ${positionAddress}:`, error instanceof Error ? error.message : String(error), '\x1b[0m');
        return [];
      }
    });

    const positionDeniedEventsArrays = await Promise.all(positionDeniedEventsPromises);
    const positionDeniedEvents: PositionDeniedEvent[] = positionDeniedEventsArrays.flat();

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
      deuroProfitDistributedEvents,
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
      positionDeniedEvents,

      // Meta data
      lastEventFetch: Date.now(),
      blockRange: { from: fromBlock, to: toBlock },
    };
  }

  // TODO: Same question as above - is this really necessary?
  private mergeEventsData(existing: SystemEventsData, newData: SystemEventsData): SystemEventsData {
    return {
      // DecentralizedEURO events
      deuroTransferEvents: mergeEvents(existing.deuroTransferEvents, newData.deuroTransferEvents),
      deuroLossEvents: mergeEvents(existing.deuroLossEvents, newData.deuroLossEvents),
      deuroProfitEvents: mergeEvents(existing.deuroProfitEvents, newData.deuroProfitEvents),
      deuroMinterAppliedEvents: mergeEvents(existing.deuroMinterAppliedEvents, newData.deuroMinterAppliedEvents),
      deuroMinterDeniedEvents: mergeEvents(existing.deuroMinterDeniedEvents, newData.deuroMinterDeniedEvents),
      deuroProfitDistributedEvents: mergeEvents(existing.deuroProfitDistributedEvents, newData.deuroProfitDistributedEvents),

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

      // Position events
      positionDeniedEvents: mergeEvents(existing.positionDeniedEvents, newData.positionDeniedEvents),

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

  private async persistEvents(eventsData: SystemEventsData): Promise<void> {
    console.log('\x1b[32mPersisting events to database...\x1b[0m');
    await eventPersistence.persistAllEvents(eventsData);
    console.log('\x1b[32mEvents persisted successfully\x1b[0m');
  }
}
