export interface PositionState {
  address: string;
  owner: string;
  original: string;
  collateralAddress: string;
  collateralBalance: bigint;
  price: bigint;
  virtualPrice: bigint;
  expiredPurchasePrice: bigint;
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
  created?: number;
}

export interface CollateralState {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface ChallengeState {
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

export interface MintingHubState {
  openingFee: number;
  challengerReward: number;
  expiredPriceFactor: number;
  positionFactory: string;
  deuro: string;
  positionRoller: string;
  rate: string;
}