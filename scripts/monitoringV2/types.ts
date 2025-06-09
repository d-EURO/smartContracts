// depricated

import {
  DecentralizedEURO,
  DEPSWrapper,
  Equity,
  MintingHubGateway,
  SavingsGateway,
  StablecoinBridge,
} from '../../typechain';
import { MetricResult } from './utils';
import { EventData } from './dto/event.dto';
import { HealthStatus, PositionStatus, RiskStatus } from './dto/status.dto';

export interface EventTrendData {
  trend: Record<string, MetricResult>;
  events: EventData[];
}

export interface DEPSWrapperState {
  address: string;
  totalSupply: bigint;
  underlyingAddress: string;
  underlyingSymbol: string; // nDEPS
  transferEvents: EventTrendData;
  wrapEvents: EventTrendData;
  unwrapEvents: EventTrendData;
}

export type BridgeType = 'bridgeEURC' | 'bridgeEURT' | 'bridgeVEUR' | 'bridgeEURS';

export interface DeploymentAddresses {
  deployer: string;
  decentralizedEURO: string;
  equity: string;
  mintingHubGateway: string;
  savingsGateway: string;
  depsWrapper: string;
  bridgeEURC: BridgeType;
  bridgeEURT: BridgeType;
  bridgeVEUR: BridgeType;
  bridgeEURS: BridgeType;
}

export interface DeploymentContracts {
  decentralizedEURO: DecentralizedEURO;
  equity: Equity;
  mintingHubGateway: MintingHubGateway;
  savingsGateway: SavingsGateway;
  depsWrapper: DEPSWrapper;
  bridgeEURC: StablecoinBridge;
  bridgeEURT: StablecoinBridge;
  bridgeVEUR: StablecoinBridge;
  bridgeEURS: StablecoinBridge;
}

export interface EquityState {
  address: string;
  totalSupply: bigint;
  price: bigint;
  marketCap: bigint;
  tradeEvents: EventTrendData;
  delegationEvents: EventTrendData;
}

export interface BridgeState {
  name: string;
  address: string;
  eur: string;
  symbol: string;
  limit: bigint;
  minted: bigint;
  utilization: number;
  horizon: bigint;
  expirationStatus: HealthStatus;
  utilizationStatus: HealthStatus;
}

export interface TopSaver {
  account: string;
  amount: bigint;
  interest: bigint;
  total: bigint;
}

export interface SavingsGatewayState {
  address: string;
  currentRatePPM: bigint;
  nextRatePPM: bigint;
  nextChange: bigint;
  hasPendingChange: boolean;
  changeTime: string;
  savedEvents: EventTrendData;
  interestCollectedEvents: EventTrendData;
  withdrawnEvents: EventTrendData;
  rateProposedEvents: EventTrendData;
  rateChangedEvents: EventTrendData;
  totalSavings: bigint;
  uniqueSavers: number;
}



export interface PositionState {
  owner: string;
  address: string;
  original: string;
  debt: bigint;
  interest: bigint;
  price: bigint;
  virtualPrice: bigint;
  collateralAddress: string;
  collateralSymbol: string;
  collateralBalance: bigint;
  collateralValue: bigint;
  collateralDecimals: bigint;
  challengedAmount: bigint;
  challengePeriod: bigint;
  utilization: number;
  marketPrice?: string;
  utilizationMarket: number;
  created: number;
  start: bigint;
  expiration: bigint;
  cooldown: bigint;
  isClosed: boolean;
  state: PositionStatus;
  riskLevel: RiskStatus;
  minimumCollateral: bigint;
  liveVirtualPrice: bigint;
}

export interface ChallengeState {
  id: number;
  challenger: string;
  start: number;
  position: string;
  collateralSymbol: string;
  size: string;
  liqPrice: string;
  currentPrice: string;
  positionOwner: string;
  status: string;
  collateralAddress: string;
}

export interface SavingsEvent {
  event: string;
  account: string;
  amount: string;
  timestamp: number;
  blockNumber: number;
  transactionHash: string;
}

export interface RateChangeEvent {
  event: string;
  rate: string;
  timestamp: number;
  blockNumber: number;
  transactionHash: string;
}
