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