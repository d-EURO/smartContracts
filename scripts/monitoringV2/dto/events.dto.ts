import { ethers } from 'ethers';
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
  RollEvent
} from './event.dto';

export interface SystemEventsData {
  // DecentralizedEURO events
  transferEvents: TransferEvent[];
  lossEvents: LossEvent[];
  profitEvents: ProfitEvent[];
  minterAppliedEvents: MinterAppliedEvent[];
  minterDeniedEvents: MinterDeniedEvent[];
  profitsDistributedEvents: ProfitDistributedEvent[];
  
  // Equity events
  tradeEvents: TradeEvent[];
  delegationEvents: DelegationEvent[];
  
  // DEPSWrapper events
  wrapEvents: WrapEvent[];
  unwrapEvents: UnwrapEvent[];
  transferWrapperEvents: TransferEvent[];
  
  // SavingsGateway events
  savedEvents: SavedEvent[];
  interestCollectedEvents: InterestCollectedEvent[];
  withdrawnEvents: WithdrawnEvent[];
  rateProposedEvents: RateProposedEvent[];
  rateChangedEvents: RateChangedEvent[];
  
  // Positions events
  positionOpenedEvents: PositionOpenedEvent[];
  
  // PositionRoller events
  rollEvents: RollEvent[];
  
  // Metadata
  lastEventFetch: number;
  blockRange: { from: number; to: number };
}

export interface ContractSet {
  deuroContract: ethers.Contract;
  equityContract: ethers.Contract;
  depsContract: ethers.Contract;
  savingsContract: ethers.Contract;
  mintingHubContract: ethers.Contract;
  rollerContract: ethers.Contract;
}