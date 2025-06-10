import { ethers } from 'ethers';
import { DecentralizedEUROABI } from '../../exports/abis/core/DecentralizedEURO';
import { EquityABI } from '../../exports/abis/core/Equity';
import { DEPSWrapperABI } from '../../exports/abis/utils/DEPSWrapper';
import { SavingsGatewayABI } from '../../exports/abis/core/SavingsGateway';
import { StablecoinBridgeABI } from '../../exports/abis/utils/StablecoinBridge';
import { FrontendGatewayABI } from '../../exports/abis/core/FrontendGateway';
import { MintingHubGatewayABI } from '../../exports/abis/core/MintingHubGateway';
import { PositionRollerABI } from '../../exports/abis/MintingHubV2/PositionRoller';
import { ADDRESS } from '../../exports/address.config';
import { decentralizedEuroState } from './decentralizedEURO';
import { equityState } from './equity';
import { depsWrapperState } from './depsWrapper';
import { savingsGatewayState } from './savingsGateway';
import { stablecoinBridgeState } from './stablecoinBridge';
import { frontendGatewayState } from './frontendGateway';
import { positionsState } from './positions';
import { DecentralizedEuroState } from './dto/deuro.dto';
import { EquityState } from './dto/equity.dto';
import { DEPSWrapperState } from './dto/depsWrapper.dto';
import { SavingsGatewayState } from './dto/savingsGateway.dto';
import { StablecoinBridgeState, Bridge } from './dto/stablecoinBridge.dto';
import { FrontendGatewayState } from './dto/frontendGateway.dto';
import { PositionsStateExtended } from './dto/positions.dto';
import { SystemEventsData, ContractSet } from './dto/events.dto';
import { fetchEvents } from './utils';
import {
  TransferEvent,
  LossEvent,
  ProfitEvent,
  MinterAppliedEvent,
  MinterDeniedEvent,
  ProfitDistributedEvent,
  TradeEvent,
  DelegationEvent,
  WrapEvent,
  UnwrapEvent,
  SavedEvent,
  InterestCollectedEvent,
  WithdrawnEvent,
  RateProposedEvent,
  RateChangedEvent,
  PositionOpenedEvent,
  RollEvent,
} from './dto/event.dto';
import { PositionRollerState } from './dto/positionRoller.dto';
import { positionRollerState } from './positionRoller';

export class MonitoringModule {
  private provider: ethers.Provider;
  private blockchainId: number = 1;
  private eventsCache: SystemEventsData | null = null;
  private eventsCacheExpiry: number = 0;
  private readonly EVENTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(provider: ethers.Provider, blockchainId: number = 1) {
    this.provider = provider;
    this.blockchainId = blockchainId;
  }

  async getAllEvents(forceRefresh: boolean = false): Promise<SystemEventsData> {
    const now = Date.now();

    if (!forceRefresh && this.eventsCache && now < this.eventsCacheExpiry) {
      return this.eventsCache;
    }

    const contracts = this.createAllContracts();
    const eventsData = await this.fetchAllEventsParallel(contracts);

    this.eventsCache = eventsData;
    this.eventsCacheExpiry = now + this.EVENTS_CACHE_TTL;

    return eventsData;
  }

  async getDecentralizedEuroState(): Promise<DecentralizedEuroState> {
    const deuro = new ethers.Contract(
      ADDRESS[this.blockchainId].decentralizedEURO,
      DecentralizedEUROABI,
      this.provider,
    );
    return decentralizedEuroState(deuro);
  }

  async getEquityState(): Promise<EquityState> {
    const equity = new ethers.Contract(ADDRESS[this.blockchainId].equity, EquityABI, this.provider);
    return equityState(equity);
  }

  async getDEPSWrapperState(): Promise<DEPSWrapperState> {
    const depsWrapper = new ethers.Contract(ADDRESS[this.blockchainId].DEPSwrapper, DEPSWrapperABI, this.provider);
    return depsWrapperState(depsWrapper);
  }

  async getSavingsGatewayState(): Promise<SavingsGatewayState> {
    const savingsGateway = new ethers.Contract(
      ADDRESS[this.blockchainId].savingsGateway,
      SavingsGatewayABI,
      this.provider,
    );
    const deuro = new ethers.Contract(
      ADDRESS[this.blockchainId].decentralizedEURO,
      DecentralizedEUROABI,
      this.provider,
    );
    return savingsGatewayState(savingsGateway, deuro);
  }

  async getFrontendGatewayState(): Promise<FrontendGatewayState> {
    const frontendGateway = new ethers.Contract(
      ADDRESS[this.blockchainId].frontendGateway,
      FrontendGatewayABI,
      this.provider,
    );
    return frontendGatewayState(frontendGateway);
  }

  async getPositionsState(positionEvents?: PositionOpenedEvent[]): Promise<PositionsStateExtended> {
    const mintingHubGateway = new ethers.Contract(
      ADDRESS[this.blockchainId].mintingHubGateway,
      MintingHubGatewayABI,
      this.provider,
    );

    // If no events provided, get them from cache or fetch fresh
    if (!positionEvents) {
      const events = await this.getAllEvents();
      positionEvents = events.positionOpenedEvents;
    }

    return positionsState(mintingHubGateway, positionEvents);
  }

  async getPositionRollerState(): Promise<PositionRollerState> {
    const positionRoller = new ethers.Contract(ADDRESS[this.blockchainId].roller, PositionRollerABI, this.provider);
    return positionRollerState(positionRoller);
  }

  async getBridgeState(bridgeType: Bridge): Promise<StablecoinBridgeState> {
    const bridgeAddress = ADDRESS[this.blockchainId][bridgeType as keyof (typeof ADDRESS)[1]];
    const bridge = new ethers.Contract(bridgeAddress, StablecoinBridgeABI, this.provider);
    return stablecoinBridgeState(bridge, bridgeType);
  }

  async getAllBridgeStates(): Promise<StablecoinBridgeState[]> {
    const bridges = Object.values(Bridge);
    return Promise.all(bridges.map((bridge) => this.getBridgeState(bridge)));
  }

  // Helper: Create all contract instances
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
      mintingHubContract: new ethers.Contract(
        ADDRESS[this.blockchainId].mintingHubGateway,
        MintingHubGatewayABI,
        this.provider,
      ),
      rollerContract: new ethers.Contract(ADDRESS[this.blockchainId].roller, PositionRollerABI, this.provider),
    };
  }

  // Helper: Fetch all events in parallel
  private async fetchAllEventsParallel(contracts: ContractSet): Promise<SystemEventsData> {
    const currentBlock = await this.provider.getBlockNumber();

    const [
      // DecentralizedEURO events
      transferEvents,
      lossEvents,
      profitEvents,
      minterAppliedEvents,
      minterDeniedEvents,
      profitsDistributedEvents,

      // Equity events
      tradeEvents,
      delegationEvents,

      // DEPSWrapper events
      transferWrapperEvents,

      // Savings events
      savedEvents,
      interestCollectedEvents,
      withdrawnEvents,
      rateProposedEvents,
      rateChangedEvents,

      // Position events
      positionOpenedEvents,

      // Roller events
      rollEvents,
    ] = await Promise.all([
      // DecentralizedEURO events
      fetchEvents<TransferEvent>(contracts.deuroContract, contracts.deuroContract.filters.Transfer()),
      fetchEvents<LossEvent>(contracts.deuroContract, contracts.deuroContract.filters.Loss()),
      fetchEvents<ProfitEvent>(contracts.deuroContract, contracts.deuroContract.filters.Profit()),
      fetchEvents<MinterAppliedEvent>(contracts.deuroContract, contracts.deuroContract.filters.MinterApplied()),
      fetchEvents<MinterDeniedEvent>(contracts.deuroContract, contracts.deuroContract.filters.MinterDenied()),
      fetchEvents<ProfitDistributedEvent>(contracts.deuroContract, contracts.deuroContract.filters.ProfitDistributed()),

      // Equity events
      fetchEvents<TradeEvent>(contracts.equityContract, contracts.equityContract.filters.Trade()),
      fetchEvents<DelegationEvent>(contracts.equityContract, contracts.equityContract.filters.Delegation()),

      // DEPSWrapper events
      fetchEvents<TransferEvent>(contracts.depsContract, contracts.depsContract.filters.Transfer()),

      // Savings events
      fetchEvents<SavedEvent>(contracts.savingsContract, contracts.savingsContract.filters.Saved()),
      fetchEvents<InterestCollectedEvent>(
        contracts.savingsContract,
        contracts.savingsContract.filters.InterestCollected(),
      ),
      fetchEvents<WithdrawnEvent>(contracts.savingsContract, contracts.savingsContract.filters.Withdrawn()),
      fetchEvents<RateProposedEvent>(contracts.savingsContract, contracts.savingsContract.filters.RateProposed()),
      fetchEvents<RateChangedEvent>(contracts.savingsContract, contracts.savingsContract.filters.RateChanged()),

      // Position events
      fetchEvents<PositionOpenedEvent>(
        contracts.mintingHubContract,
        contracts.mintingHubContract.filters.PositionOpened(),
      ),

      // Roller events
      fetchEvents<RollEvent>(contracts.rollerContract, contracts.rollerContract.filters.Roll()),
    ]);

    // Process DEPSWrapper events (filter transfers into wrap/unwrap)
    const wrapEvents: WrapEvent[] = transferWrapperEvents
      .filter((event) => event.from === ethers.ZeroAddress)
      .map((event) => ({
        ...event,
        user: event.to,
        amount: event.value,
      }));

    const unwrapEvents: UnwrapEvent[] = transferWrapperEvents
      .filter((event) => event.to === ethers.ZeroAddress)
      .map((event) => ({
        ...event,
        user: event.from,
        amount: event.value,
      }));

    return {
      // DecentralizedEURO events
      transferEvents,
      lossEvents,
      profitEvents,
      minterAppliedEvents,
      minterDeniedEvents,
      profitsDistributedEvents,

      // Equity events
      tradeEvents,
      delegationEvents,

      // DEPSWrapper events
      wrapEvents,
      unwrapEvents,
      transferWrapperEvents,

      // SavingsGateway events
      savedEvents,
      interestCollectedEvents,
      withdrawnEvents,
      rateProposedEvents,
      rateChangedEvents,

      // Positions events
      positionOpenedEvents,

      // PositionRoller events
      rollEvents,

      // Metadata
      lastEventFetch: Date.now(),
      blockRange: { from: 0, to: currentBlock },
    };
  }
}
