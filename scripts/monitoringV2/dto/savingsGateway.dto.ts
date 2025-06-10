import { SavedEvent, InterestCollectedEvent, WithdrawnEvent, RateProposedEvent, RateChangedEvent } from "./event.dto";

export interface SavingsGatewayState {
  address: string;
  currentRatePPM: bigint;
  nextRatePPM: bigint;
  nextChange: bigint;
  hasPendingChange: boolean;
  gatewayAddress: string;
  equityAddress: string;
  deuroAddress: string;
  totalSavings: bigint;
  currentTicks: bigint;
}

export interface SavingsGatewayStateExtended extends SavingsGatewayState {
  savedEvents: SavedEvent[];
  interestCollectedEvents: InterestCollectedEvent[];
  withdrawnEvents: WithdrawnEvent[];
  rateProposedEvents: RateProposedEvent[];
  rateChangedEvents: RateChangedEvent[];
}