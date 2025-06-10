import { TradeEvent, DelegationEvent } from "./event.dto";

export interface EquityState {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  price: bigint;
  marketCap: bigint;
  totalVotes: bigint;
  dEuroAddress: string;
  valuationFactor: number;
  minHoldingDuration: bigint;
  quorum: number;
}

export interface EquityStateExtended extends EquityState {
  tradeEvents: TradeEvent[];
  delegationEvents: DelegationEvent[];
}