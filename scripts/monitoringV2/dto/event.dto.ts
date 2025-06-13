export interface BaseEvent {
  txHash: string;
  timestamp: number;
  logIndex: number;
}

export interface TransferEvent extends BaseEvent {
  from: string;
  to: string;
  value: bigint;
}

export type DeuroTransferEvent = TransferEvent;
export type DepsTransferEvent = TransferEvent;

export interface DeuroMinterAppliedEvent extends BaseEvent {
  minter: string;
  applicationPeriod: bigint;
  applicationFee: bigint;
  message: string;
}

export interface DeuroMinterDeniedEvent extends BaseEvent {
  minter: string;
  message: string;
}

export interface DeuroLossEvent extends BaseEvent {
  reportingMinter: string;
  amount: bigint;
}

export interface DeuroProfitEvent extends BaseEvent {
  reportingMinter: string;
  amount: bigint;
}

export interface DeuroProfitDistributedEvent extends BaseEvent {
  recipient: string;
  amount: bigint;
}

export interface EquityTradeEvent extends BaseEvent {
  who: string;
  amount: bigint;
  totPrice: bigint;
  newPrice: bigint;
}

export interface EquityDelegationEvent extends BaseEvent {
  from: string;
  to: string;
}

export interface DepsWrapEvent extends BaseEvent {
  from: string;
  to: string;
  value: bigint;
  user: string;
  amount: bigint;
}

export interface DepsUnwrapEvent extends BaseEvent {
  from: string;
  to: string;
  value: bigint;
  user: string;
  amount: bigint;
}

export interface SavingsSavedEvent extends BaseEvent {
  account: string;
  amount: bigint;
}

export interface SavingsInterestCollectedEvent extends BaseEvent {
  account: string;
  interest: bigint;
}

export interface SavingsWithdrawnEvent extends BaseEvent {
  account: string;
  amount: bigint;
}

export interface SavingsRateProposedEvent extends BaseEvent {
  who: string;
  nextRate: bigint;
  nextChange: bigint;
}

export interface SavingsRateChangedEvent extends BaseEvent {
  newRate: bigint;
}

export interface MintingHubPositionOpenedEvent extends BaseEvent {
  owner: string;  
  position: string;
  original: string;
  collateral: string;
}

export interface RollerRollEvent extends BaseEvent {
  source: string;
  collWithdraw: bigint;
  repay: bigint;
  target: string;
  collDeposit: bigint;
  mint: bigint;
}

export interface PositionDeniedEvent extends BaseEvent {
  position: string;
  sender: string;
  message: string;
}

