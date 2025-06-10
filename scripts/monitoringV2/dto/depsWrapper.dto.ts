export interface DEPSWrapperState {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  underlyingAddress: string;
  underlyingSymbol: string;
}