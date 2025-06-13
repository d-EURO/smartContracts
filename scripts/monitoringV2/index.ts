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
  PositionState,
  ChallengeState,
  CollateralState,
} from './dto';
import { fetchEvents, getDeploymentBlock } from './utils';
import { db } from './database/client';
import { eventPersistence } from './database/eventPersistence';
import { statePersistence } from './database/statePersistence';
import { positionsState } from './contracts/positions';
import { challengesState } from './contracts/challenges';
import { collateralState } from './contracts/collateral';

export class MonitoringModule {
  private provider: ethers.Provider;
  private blockchainId: number;
  private contracts: ContractSet;

  constructor(provider: ethers.Provider, blockchainId: number = 1) {
    this.provider = provider;
    this.blockchainId = blockchainId;
    this.contracts = this.createAllContracts();
  }

  async getEvents(): Promise<SystemEventsData> {
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

  async getDecentralizedEuroState(): Promise<DecentralizedEuroState> {
    console.log(`Fetching DecentralizedEURO state`);
    const state = await decentralizedEuroState(this.contracts.deuroContract);
    await statePersistence.persistDeuroState(state);
    return state;
  }

  async getEquityState(): Promise<EquityState> {
    console.log(`Fetching Equity state`);
    const state = await equityState(this.contracts.equityContract);
    await statePersistence.persistEquityState(state);
    return state;
  }

  async getDEPSWrapperState(): Promise<DEPSWrapperState> {
    console.log(`Fetching DEPSWrapper state`);
    const state = await depsWrapperState(this.contracts.depsContract);
    await statePersistence.persistDepsState(state);
    return state;
  }

  async getSavingsGatewayState(): Promise<SavingsGatewayState> {
    console.log(`Fetching SavingsGateway state`);
    const state = await savingsGatewayState(this.contracts.savingsContract, this.contracts.deuroContract);
    await statePersistence.persistSavingsState(state);
    return state;
  }

  async getFrontendGatewayState(): Promise<FrontendGatewayState> {
    console.log(`Fetching FrontendGateway state`);
    const state = await frontendGatewayState(this.contracts.frontendGatewayContract);
    await statePersistence.persistFrontendState(state);
    return state;
  }

  async getMintingHubState(): Promise<MintingHubState> {
    console.log(`Fetching MintingHub positions state`);
    const state = await mintingHubState(this.contracts.mintingHubContract);
    await statePersistence.persistMintingHubState(state);
    return state;
  }

  async getPositionsState(positionEvents: MintingHubPositionOpenedEvent[]): Promise<PositionState[]> {
    console.log(`Fetching positions state`);
    const activePositions: string[] = await db.getActivePositionAddresses();
    const state = await positionsState(this.contracts.mintingHubContract, activePositions, positionEvents);
    await statePersistence.persistPositionsState(state);
    return state;
  }

  async getChallengesState(): Promise<ChallengeState[]> {
    console.log(`Fetching challenges state`);
    const state = await challengesState(this.contracts.mintingHubContract);
    await statePersistence.persistChallengesState(state);
    return state;
  }

  async getCollateralState(positionEvents: MintingHubPositionOpenedEvent[]): Promise<CollateralState[]> {
    console.log(`Fetching collateral state`);
    const state = await collateralState(positionEvents, this.provider);
    await statePersistence.persistCollateralState(state);
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
