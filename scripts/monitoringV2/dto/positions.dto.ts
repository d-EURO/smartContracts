import { BaseEvent } from './event.dto';

export interface PositionOpenedEvent extends BaseEvent {
  position: string;
  owner: string;
}

export interface PositionState {
  address: string;
  owner: string;
  original: string;
  collateralAddress: string;
  collateralBalance: bigint;
  price: bigint;
  virtualPrice: bigint;
  collateralRequirement: bigint;
  debt: bigint;
  interest: bigint;
  minimumCollateral: bigint;
  limit: bigint;
  principal: bigint;
  riskPremiumPPM: number;
  reserveContribution: number;
  fixedAnnualRatePPM: number;
  lastAccrual: bigint;
  start: bigint;
  cooldown: bigint;
  expiration: bigint;
  challengedAmount: bigint;
  challengePeriod: bigint;
  isClosed: boolean;
  created: number;
}

export interface PositionCollateralState {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface ChallengeData {
  id: number;
  challenger: string;
  position: string;
  start: number;
  size: bigint;
  collateralAddress: string;
  liqPrice: bigint;
  phase: number;
  currentPrice: bigint;
  positionOwner: string;
}

export interface PositionsStateExtended {
  positions: PositionState[];
  collaterals: PositionCollateralState[];
  challenges: ChallengeData[];
}