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
  SystemEventsData,
  ContractSet,

  // Event DTOs
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

  async getMintingHubState(positionEvents?: PositionOpenedEvent[]): Promise<MintingHubState> {
    const contracts = this.getContracts();
    positionEvents ??= (await this.getAllEvents()).positionOpenedEvents;
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
      fetchEvents<TransferEvent>(
        contracts.deuroContract,
        contracts.deuroContract.filters.Transfer(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<LossEvent>(contracts.deuroContract, contracts.deuroContract.filters.Loss(), fromBlock, toBlock),
      fetchEvents<ProfitEvent>(contracts.deuroContract, contracts.deuroContract.filters.Profit(), fromBlock, toBlock),
      fetchEvents<MinterAppliedEvent>(
        contracts.deuroContract,
        contracts.deuroContract.filters.MinterApplied(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<MinterDeniedEvent>(
        contracts.deuroContract,
        contracts.deuroContract.filters.MinterDenied(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<ProfitDistributedEvent>(
        contracts.deuroContract,
        contracts.deuroContract.filters.ProfitDistributed(),
        fromBlock,
        toBlock,
      ),

      // Equity events
      fetchEvents<TradeEvent>(contracts.equityContract, contracts.equityContract.filters.Trade(), fromBlock, toBlock),
      fetchEvents<DelegationEvent>(
        contracts.equityContract,
        contracts.equityContract.filters.Delegation(),
        fromBlock,
        toBlock,
      ),

      // DEPSWrapper events
      fetchEvents<TransferEvent>(contracts.depsContract, contracts.depsContract.filters.Transfer(), fromBlock, toBlock),

      // Savings events
      fetchEvents<SavedEvent>(contracts.savingsContract, contracts.savingsContract.filters.Saved(), fromBlock, toBlock),
      fetchEvents<InterestCollectedEvent>(
        contracts.savingsContract,
        contracts.savingsContract.filters.InterestCollected(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<WithdrawnEvent>(
        contracts.savingsContract,
        contracts.savingsContract.filters.Withdrawn(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<RateProposedEvent>(
        contracts.savingsContract,
        contracts.savingsContract.filters.RateProposed(),
        fromBlock,
        toBlock,
      ),
      fetchEvents<RateChangedEvent>(
        contracts.savingsContract,
        contracts.savingsContract.filters.RateChanged(),
        fromBlock,
        toBlock,
      ),

      // Position events
      fetchEvents<PositionOpenedEvent>(
        contracts.mintingHubContract,
        contracts.mintingHubContract.filters.PositionOpened(),
        fromBlock,
        toBlock,
      ),

      // Roller events
      fetchEvents<RollEvent>(contracts.rollerContract, contracts.rollerContract.filters.Roll(), fromBlock, toBlock),
    ]);

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
      blockRange: { from: fromBlock, to: toBlock },
    };
  }

  private mergeEventsData(existing: SystemEventsData, newData: SystemEventsData): SystemEventsData {
    return {
      // DecentralizedEURO events
      transferEvents: mergeEvents(existing.transferEvents, newData.transferEvents),
      lossEvents: mergeEvents(existing.lossEvents, newData.lossEvents),
      profitEvents: mergeEvents(existing.profitEvents, newData.profitEvents),
      minterAppliedEvents: mergeEvents(existing.minterAppliedEvents, newData.minterAppliedEvents),
      minterDeniedEvents: mergeEvents(existing.minterDeniedEvents, newData.minterDeniedEvents),
      profitsDistributedEvents: mergeEvents(existing.profitsDistributedEvents, newData.profitsDistributedEvents),

      // Equity events
      tradeEvents: mergeEvents(existing.tradeEvents, newData.tradeEvents),
      delegationEvents: mergeEvents(existing.delegationEvents, newData.delegationEvents),

      // DEPSWrapper events
      wrapEvents: mergeEvents(existing.wrapEvents, newData.wrapEvents),
      unwrapEvents: mergeEvents(existing.unwrapEvents, newData.unwrapEvents),
      transferWrapperEvents: mergeEvents(existing.transferWrapperEvents, newData.transferWrapperEvents),

      // SavingsGateway events
      savedEvents: mergeEvents(existing.savedEvents, newData.savedEvents),
      interestCollectedEvents: mergeEvents(existing.interestCollectedEvents, newData.interestCollectedEvents),
      withdrawnEvents: mergeEvents(existing.withdrawnEvents, newData.withdrawnEvents),
      rateProposedEvents: mergeEvents(existing.rateProposedEvents, newData.rateProposedEvents),
      rateChangedEvents: mergeEvents(existing.rateChangedEvents, newData.rateChangedEvents),

      // Positions events
      positionOpenedEvents: mergeEvents(existing.positionOpenedEvents, newData.positionOpenedEvents),

      // PositionRoller events
      rollEvents: mergeEvents(existing.rollEvents, newData.rollEvents),

      // Metadata
      lastEventFetch: Date.now(),
      blockRange: {
        from: Math.min(existing.blockRange.from, newData.blockRange.from),
        to: Math.max(existing.blockRange.to, newData.blockRange.to),
      },
    };
  }
}
