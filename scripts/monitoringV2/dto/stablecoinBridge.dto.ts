export enum Bridge {
  EURT = 'bridgeEURT',
  EURS = 'bridgeEURS',
  VEUR = 'bridgeVEUR',
  EURC = 'bridgeEURC',
  EURR = 'bridgeEURR',
  EUROP = 'bridgeEUROP',
  EURI = 'bridgeEURI',
  EURE = 'bridgeEURE',
}

export interface StablecoinBridgeState {
  bridgeType: Bridge;
  address: string;
  eurAddress: string;
  eurSymbol: string;
  eurDecimals: number;
  dEuroAddress: string;
  limit: bigint;
  minted: bigint;
  horizon: bigint;
}
