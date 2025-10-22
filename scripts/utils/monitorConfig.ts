import { BridgeType, PositionStatus } from '../monitoring/types';

/**
 * Configuration for JUSD Protocol Monitoring System
 * Contains thresholds and parameters for monitoring tasks
 */
export const monitorConfig = {
  bridges: ['bridgeStartUSD'] as BridgeType[],
  deploymentBlock: 0, // TODO: Update with actual Citrea deployment block number
  blockTime: 12, // TODO: Update with actual Citrea block time (in seconds)
  thresholds: {
    // Equity thresholds
    equityCriticalLevel: 10000, // JUSD
    equityWarningLevel: 100000, // JUSD

    // Bridge thresholds
    bridgeUtilizationWarning: 60, // %
    bridgeUtilizationCritical: 80, // %
    bridgeExpirationWarning: 30, // days
    bridgeExpirationCritical: 20, // days

    // Position thresholds
    positionUtilizationWarning: 50, // %
    positionUtilizationCritical: 80, // %
    positionExpirationWarning: 7, // days
    positionExpirationCritical: 3, // days

    // Interest rate thresholds
    interestRateMinimum: 0.1, // %
    interestRateMaximum: 15, // %
  },

  // Time intervals for monitoring (in seconds)
  intervals: {
    // How far back to look for events
    recentEvents: 86400, // 24 hours
    savingsActivity: 604800, // 7 days
    interestRateChanges: 1209600, // 14 days
    positionChanges: 604800, // 7 days
  },

  limits: {
    challenges: 1000,
  },

  // Display limits
  displayLimits: {
    recentEvents: 20,
    positions: 20,
    challenges: 10,
    topSavers: 10,
    savingsActivity: 30,
    interestRateChanges: 10,
  },

  // Risk levels for positions
  riskLevels: {
    high: {
      states: [PositionStatus.CHALLENGED, PositionStatus.UNDERCOLLATERIZED],
      utilizationThreshold: 80,
    },
    medium: {
      states: [PositionStatus.EXPIRING, PositionStatus.COOLDOWN],
      utilizationThreshold: 50,
    },
    low: {
      states: [PositionStatus.OPEN],
      utilizationMax: 50,
    },
  },

  // Fraction of minimum collateral that is considered "dust" in PPM
  // (Based on audit finding from dEURO predecessor)
  dustFraction: 100000, // 10%
};

export default monitorConfig;
