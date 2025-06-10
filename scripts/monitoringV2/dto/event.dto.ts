export interface BaseEvent {
  txHash: string;
  timestamp: number;
}

export interface TransferEvent extends BaseEvent {
  from: string;
  to: string;
  value: bigint;
}

export interface MinterAppliedEvent extends BaseEvent {
  minter: string;
  applicationPeriod: bigint;
  applicationFee: bigint;
  message: string;
}

export interface MinterDeniedEvent extends BaseEvent {
  minter: string;
  message: string;
}

export interface LossEvent extends BaseEvent {
  reportingMinter: string;
  amount: bigint;
}

export interface ProfitEvent extends BaseEvent {
  reportingMinter: string;
  amount: bigint;
}

export interface ProfitDistributedEvent extends BaseEvent {
  recipient: string;
  amount: bigint;
}

export interface TradeEvent extends BaseEvent {
  who: string;
  amount: bigint;
  totPrice: bigint;
  newPrice: bigint;
}

export interface DelegationEvent extends BaseEvent {
  from: string;
  to: string;
}

export interface WrapEvent extends BaseEvent {
  to: string;
  value: bigint;
}

export interface UnwrapEvent extends BaseEvent {
  from: string;
  value: bigint;
}

export interface EventData {
  name: string;
  data: any;
  txHash: string;
  timestamp: number;
}

export interface MetricResult {
  value: {
    day: bigint;
    week: bigint;
    month: bigint;
    year: bigint;
  };
  count: {
    day: number;
    week: number;
    month: number;
    year: number;
  };
  last: EventData;
  valueFormatter: (value: bigint) => string;
}

export interface EventTrendData {
  trend: Record<string, MetricResult>;
  events: EventData[];
}
