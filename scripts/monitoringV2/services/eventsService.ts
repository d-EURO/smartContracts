import { ethers } from 'ethers';
import {
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
  SystemEventsData,
  ContractSet,
} from '../dto';
import { PositionV2ABI } from '@deuro/eurocoin';
import { fetchEvents } from '../utils';
import { db } from '../database/client';
import { eventPersistence } from '../database/eventPersistence';

export class EventsService {
  constructor(
    private contracts: ContractSet,
    private provider: ethers.Provider,
  ) {}

  async getSystemEvents(fromBlock: number, toBlock: number): Promise<SystemEventsData> {
    const startTime = Date.now();
    const eventsData = await this.getEventsInRange(this.contracts, fromBlock, toBlock);
    await this.persistEvents(eventsData);
    const duration = Date.now() - startTime;
    await this.recordMonitoringCycle(toBlock, eventsData, duration);
    return eventsData;
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

  private async recordMonitoringCycle(
    currentBlock: number,
    eventsData: SystemEventsData,
    duration: number,
  ): Promise<void> {
    const totalEvents = Object.entries(eventsData).reduce((sum, [key, value]) => {
      if (key === 'lastEventFetch' || key === 'blockRange') return sum;
      return sum + (Array.isArray(value) ? value.length : 0);
    }, 0);
    await db.recordMonitoringCycle(currentBlock, totalEvents, duration);
    console.log(`\x1b[32mProcessed ${totalEvents} new events in ${duration}ms\x1b[0m`);
  }
}
