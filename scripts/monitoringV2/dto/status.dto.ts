export enum PositionStatus {
  PROPOSED = 'PROPOSED',
  COOLDOWN = 'COOLDOWN',
  CHALLENGED = 'CHALLENGED',
  UNDERCOLLATERIZED = 'UNDERCOLLATERIZED',
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  EXPIRING = 'EXPIRING',
}

export enum HealthStatus {
  HEALTHY = 'HEALTHY',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
  EXPIRED = 'EXPIRED',
  CLOSED = 'CLOSED',
}

export enum ChallengeStatus {
  EXPIRED = 'EXPIRED',
  ACTIVE = 'ACTIVE',
}

export enum RiskStatus {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}