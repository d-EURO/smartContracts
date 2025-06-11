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
  RollerRollEvent
} from './event.dto';

export interface SystemEventsData {
  deuroTransferEvents: DeuroTransferEvent[];
  deuroLossEvents: DeuroLossEvent[];
  deuroProfitEvents: DeuroProfitEvent[];
  deuroMinterAppliedEvents: DeuroMinterAppliedEvent[];
  deuroMinterDeniedEvents: DeuroMinterDeniedEvent[];
  deuroProfitsDistributedEvents: DeuroProfitDistributedEvent[];
  equityTradeEvents: EquityTradeEvent[];
  equityDelegationEvents: EquityDelegationEvent[];
  depsWrapEvents: DepsWrapEvent[];
  depsUnwrapEvents: DepsUnwrapEvent[];
  depsTransferEvents: DepsTransferEvent[];
  savingsSavedEvents: SavingsSavedEvent[];
  savingsInterestCollectedEvents: SavingsInterestCollectedEvent[];
  savingsWithdrawnEvents: SavingsWithdrawnEvent[];
  savingsRateProposedEvents: SavingsRateProposedEvent[];
  savingsRateChangedEvents: SavingsRateChangedEvent[];
  mintingHubPositionOpenedEvents: MintingHubPositionOpenedEvent[];
  rollerRollEvents: RollerRollEvent[];

  // Meta data
  lastEventFetch: number;
  blockRange: { from: number; to: number };
}

export interface ContractSet {
  deuroContract: ethers.Contract;
  equityContract: ethers.Contract;
  depsContract: ethers.Contract;
  savingsContract: ethers.Contract;
  frontendGatewayContract: ethers.Contract;
  mintingHubContract: ethers.Contract;
  rollerContract: ethers.Contract;
}