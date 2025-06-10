export interface FrontendGatewayState {
  address: string;
  deuroAddress: string;
  equityAddress: string;
  depsAddress: string;
  mintingHubAddress: string;
  savingsAddress: string;
  feeRate: number;
  savingsFeeRate: number;
  mintingFeeRate: number;
  nextFeeRate: number;
  nextSavingsFeeRate: number;
  nextMintingFeeRate: number;
  changeTimeLock: bigint;
}