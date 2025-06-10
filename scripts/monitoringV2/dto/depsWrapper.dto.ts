import { TransferEvent, WrapEvent, UnwrapEvent } from "./event.dto";

export interface DEPSWrapperState {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  underlyingAddress: string;
  underlyingSymbol: string;
}

export interface DEPSWrapperStateExtended extends DEPSWrapperState {
  transferEvents: TransferEvent[];
  wrapEvents: WrapEvent[];
  unwrapEvents: UnwrapEvent[];
}