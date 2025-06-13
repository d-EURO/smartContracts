export interface EquityState {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  price: bigint;
  totalVotes: bigint;
  dEuroAddress: string;
  valuationFactor: number;
  minHoldingDuration: bigint;
}