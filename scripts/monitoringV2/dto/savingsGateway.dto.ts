export interface SavingsGatewayState {
  address: string;
  currentRatePPM: bigint;
  nextRatePPM: bigint;
  nextChange: bigint;
  gatewayAddress: string;
  equityAddress: string;
  deuroAddress: string;
  totalSavings: bigint;
  currentTicks: bigint;
}