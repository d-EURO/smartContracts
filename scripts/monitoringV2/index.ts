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
  PositionV2ABI,
} from '@deuro/eurocoin';
import {
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

  // System DTOs
  SystemEventsData,
  ContractSet,
  SystemStateData,
} from './dto';
import { fetchEvents, getDeploymentBlock } from './utils';
import { db } from './database/client';
import { eventPersistence } from './database/eventPersistence';
import { statePersistence } from './database/statePersistence';
import {
  getStablecoinBridgesStates,
  getChallengesState,
  getCollateralState,
  getDecentralizedEuroState,
  getDepsWrapperState,
  getEquityState,
  getFrontendGatewayState,
  getMintingHubState,
  getPositionsState,
  getSavingsGatewayState,
} from './state';

export class MonitoringModule {
  private provider: ethers.Provider;
  private blockchainId: number;
  private contracts: ContractSet;

  constructor(provider: ethers.Provider, blockchainId: number = 1) {
    this.provider = provider;
    this.blockchainId = blockchainId;
    this.contracts = this.createAllContracts();
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

  async getSystemEvents(): Promise<SystemEventsData> {
    const currentBlock = await this.provider.getBlockNumber();
    const lastProcessedBlock = await db.getLastProcessedBlock();
    const fromBlock = lastProcessedBlock ? lastProcessedBlock + 1 : getDeploymentBlock();

    console.log(`\x1b[33mFetching fresh events from block ${fromBlock} to ${currentBlock}\x1b[0m`);
    const eventsData = await this.getEventsInRange(this.contracts, fromBlock, currentBlock);

    if (fromBlock <= currentBlock) {
      await this.persistEvents(eventsData);

      const totalEvents = Object.values(eventsData).reduce((sum, e) => sum + (Array.isArray(e) ? e.length : 0), 0);
      await db.recordMonitoringCycle(currentBlock, totalEvents, 0); // TODO: compute duration, currently set to 0
      console.log(`\x1b[32mProcessed ${totalEvents} new events\x1b[0m`);
    } else {
      console.log(`\x1b[32mNo new blocks to process\x1b[0m`);
    }

    return eventsData;
  }

  async getSystemState(positionEvents: MintingHubPositionOpenedEvent[]): Promise<SystemStateData> {
    console.log(`\x1b[33mFetching complete system state...\x1b[0m`);
    const systemState = await this.getSystemStateData(positionEvents);
    await this.persistSystemState(systemState);
    console.log(`\x1b[32mSystem state fetched and persisted successfully\x1b[0m`);
    return systemState;
  }

  private async getSystemStateData(positionEvents: MintingHubPositionOpenedEvent[]): Promise<SystemStateData> {
    const activePositionAddresses: string[] = await db.getActivePositionAddresses();

    const results = await Promise.allSettled([
      getDecentralizedEuroState(this.contracts.deuroContract),
      getEquityState(this.contracts.equityContract),
      getDepsWrapperState(this.contracts.depsContract),
      getSavingsGatewayState(this.contracts.savingsContract, this.contracts.deuroContract),
      getFrontendGatewayState(this.contracts.frontendGatewayContract),
      getMintingHubState(this.contracts.mintingHubContract),
      getPositionsState(this.contracts.mintingHubContract, activePositionAddresses, positionEvents),
      getChallengesState(this.contracts.mintingHubContract),
      getCollateralState(positionEvents, this.provider),
      getStablecoinBridgesStates(this.provider, this.blockchainId),
    ]);

    const [
      deuroState,
      equityState,
      depsState,
      savingsState,
      frontendState,
      mintingHubState,
      positionsState,
      challengesState,
      collateralState,
      bridgeStates,
    ] = results.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      console.error(`\x1b[31mState fetch failed for index ${index}:`, result.reason, '\x1b[0m');
      return null;
    });

    return {
      deuroState,
      equityState,
      depsState,
      savingsState,
      frontendState,
      mintingHubState,
      positionsState,
      challengesState,
      collateralState,
      bridgeStates,
    } as SystemStateData;
  }

  private async persistSystemState(systemState: SystemStateData): Promise<void> {
    console.log('\x1b[32mPersisting system state to database...\x1b[0m');
    await statePersistence.persistAllSystemState(systemState);
    console.log('\x1b[32mSystem state persisted successfully\x1b[0m');
  }

  private async getEventsInRange(
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
      fetchEvents<DeuroProfitEvent>(
        contracts.deuroContract,
        contracts.deuroContract.filters.Profit(),
        fromBlock,
        toBlock,
      ),
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
      fetchEvents<EquityTradeEvent>(
        contracts.equityContract,
        contracts.equityContract.filters.Trade(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<EquityDelegationEvent>(
        contracts.equityContract,
        contracts.equityContract.filters.Delegation(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<DepsTransferEvent>(
        contracts.depsContract,
        contracts.depsContract.filters.Transfer(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<SavingsSavedEvent>(
        contracts.savingsContract,
        contracts.savingsContract.filters.Saved(),
        fromBlock,
        toBlock,
      ),
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
      fetchEvents<RollerRollEvent>(
        contracts.rollerContract,
        contracts.rollerContract.filters.Roll(),
        fromBlock,
        toBlock,
      ),
    ]);

    // TODO: Review this and add additional filters to getActivePositionAddresses: isOriginal, isActive, etc.
    console.log(`\x1b[33mFetching PositionDenied from position contracts\x1b[0m`);
    const activePositionAddresses: string[] = await db.getActivePositionAddresses();
    const positionDeniedEvents: PositionDeniedEvent[] = await Promise.all(
      activePositionAddresses.map(async (p) => {
        const positionContract = new ethers.Contract(p, PositionV2ABI, this.provider);
        return fetchEvents<PositionDeniedEvent>(
          positionContract,
          positionContract.filters.PositionDenied(),
          fromBlock,
          toBlock,
        );
      }),
    ).then((events) => events.flat());

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

  private async persistEvents(eventsData: SystemEventsData): Promise<void> {
    console.log('\x1b[32mPersisting events to database...\x1b[0m');
    await eventPersistence.persistAllEvents(eventsData);
    console.log('\x1b[32mEvents persisted successfully\x1b[0m');
  }
}
