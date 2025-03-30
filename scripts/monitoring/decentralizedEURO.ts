import { formatEther } from 'ethers';
import { colors } from '../utils/table';
import { DecentralizedEuroState, EventTrendData, HealthStatus } from './types';
import monitorConfig from '../utils/monitorConfig';
import { DecentralizedEURO } from '../../typechain';
import { aggregateData, Operator, processEvents } from './utils';

/**
 * Fetches the state of the DecentralizedEURO contract
 * @param deuro DecentralizedEURO contract
 * @returns DecentralizedEuroState
 */
export async function getDecentralizedEuroState(deuro: DecentralizedEURO): Promise<DecentralizedEuroState> {
  const address = await deuro.getAddress();
  const totalSupply = await deuro.totalSupply();
  const equityAddress = await deuro.reserve();
  const reserveBalance = await deuro.balanceOf(equityAddress);
  const minterReserve = await deuro.minterReserve();
  const equity = await deuro.equity();
  const solvencyStatus = computeSolvencyStatus(
    equity,
    monitorConfig.thresholds.minimumEquity,
    monitorConfig.thresholds.equityWarningLevel,
  );

  // events
  const lossEvents = await processLossEvents(deuro, colors.red);
  const profitEvents = await processProfitEvents(deuro, colors.green);
  const minterAppliedEvents = await processMinterAppliedEvents(deuro, colors.yellow);
  const minterDeniedEvents = await processMinterDeniedEvents(deuro, colors.red);
  const profitsDistributedEvents = await processProfitsDistributedEvents(deuro, colors.green);

  return {
    address,
    totalSupply,
    reserveBalance,
    minterReserve,
    equity,
    equityAddress,
    solvencyStatus,
    lossEvents,
    profitEvents,
    minterAppliedEvents,
    minterDeniedEvents,
    profitsDistributedEvents,
  };
}

async function processLossEvents(deuro: DecentralizedEURO, color?: string): Promise<EventTrendData> {
  const events = await deuro.queryFilter(deuro.filters.Loss(), monitorConfig.deploymentBlock, 'latest');
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const lossTrend = aggregateData(processedEvents, [{ name: 'loss', key: 'amount', ops: Operator.sum }]);
  return {
    trend: lossTrend,
    events: processedEvents,
  };
}

async function processProfitEvents(deuro: DecentralizedEURO, color?: string): Promise<EventTrendData> {
  const events = await deuro.queryFilter(deuro.filters.Profit(), monitorConfig.deploymentBlock, 'latest');
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const profitTrend = aggregateData(processedEvents, [{ name: 'profit', key: 'amount', ops: Operator.sum }]);
  return {
    trend: profitTrend,
    events: processedEvents,
  };
}

async function processMinterAppliedEvents(deuro: DecentralizedEURO, color?: string): Promise<EventTrendData> {
  const events = await deuro.queryFilter(deuro.filters.MinterApplied(), monitorConfig.deploymentBlock, 'latest');
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const minterAppliedTrend = aggregateData(processedEvents, [{ name: 'minterApplied', key: '', ops: Operator.count }]);
  return {
    trend: minterAppliedTrend,
    events: processedEvents,
  };
}

async function processMinterDeniedEvents(deuro: DecentralizedEURO, color?: string): Promise<EventTrendData> {
  const events = await deuro.queryFilter(deuro.filters.MinterDenied(), monitorConfig.deploymentBlock, 'latest');
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const minterDeniedTrend = aggregateData(processedEvents, [{ name: 'minterDenied', key: '', ops: Operator.count }]);
  return {
    trend: minterDeniedTrend,
    events: processedEvents,
  };
}

async function processProfitsDistributedEvents(deuro: DecentralizedEURO, color?: string): Promise<EventTrendData> {
  const events = await deuro.queryFilter(deuro.filters.ProfitDistributed(), monitorConfig.deploymentBlock, 'latest');
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const profitsDistributedTrend = aggregateData(processedEvents, [
    { name: 'profitsDistributed', key: 'amount', ops: Operator.sum },
  ]);
  return {
    trend: profitsDistributedTrend,
    events: processedEvents,
  };
}

/**
 * Computes the solvency status based on equity and thresholds
 * @param equity Equity amount in wei
 * @param minimumEquity Minimum equity threshold
 * @param equityWarningLevel Warning level for equity
 * @returns HealthStatus indicating the solvency status
 */
function computeSolvencyStatus(equity: bigint, minimumEquity: number, equityWarningLevel: number): HealthStatus {
  const solvencyLevel = Number(formatEther(equity));
  if (solvencyLevel < minimumEquity) {
    return HealthStatus.CRITICAL;
  } else if (solvencyLevel < equityWarningLevel) {
    return HealthStatus.WARNING;
  } else {
    return HealthStatus.HEALTHY;
  }
}
