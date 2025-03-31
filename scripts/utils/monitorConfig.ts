import { BridgeType, PositionStatus } from '../monitoring/types';

/**
 * Configuration for dEuro Protocol Monitoring System
 * Contains thresholds and parameters for monitoring tasks
 */
export const monitorConfig = {
  bridges: ['bridgeEURC', 'bridgeEURT', 'bridgeVEUR', 'bridgeEURS'] as BridgeType[],
  deploymentBlock: 22088283, // Deployment block number for the dEuro protocol
  thresholds: {
    // Equity thresholds
    minimumEquity: 1000, // dEURO
    equityWarningLevel: 5000, // dEURO

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
};

export default monitorConfig;
