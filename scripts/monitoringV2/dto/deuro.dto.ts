import { 
  TransferEvent, 
  LossEvent, 
  ProfitEvent, 
  MinterAppliedEvent, 
  MinterDeniedEvent, 
  ProfitDistributedEvent 
} from "./event.dto";

export interface DecentralizedEuroState {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  reserveBalance: bigint;
  minterReserve: bigint;
  equity: bigint;
  equityAddress: string;
  minApplicationPeriod: bigint;
  minApplicationFee: bigint;
}

export interface DecentralizedEuroStateExtended extends DecentralizedEuroState {
  transferEvents: TransferEvent[];
  lossEvents: LossEvent[];
  profitEvents: ProfitEvent[];
  minterAppliedEvents: MinterAppliedEvent[];
  minterDeniedEvents: MinterDeniedEvent[];
  profitsDistributedEvents: ProfitDistributedEvent[];
}