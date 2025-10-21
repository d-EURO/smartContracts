import { formatEther, ZeroAddress } from 'ethers';
import { colors } from '../utils/table';
import { DecentralizedEuroState, EventTrendData, HealthStatus } from './types';
import monitorConfig from '../utils/monitorConfig';
import { DecentralizedEURO } from '../../typechain';
import { aggregateData, Operator, processEvents } from './utils';
import { batchedEventQuery } from '../utils/blockchain';

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
  const minApplicationPeriod = await deuro.MIN_APPLICATION_PERIOD();
  const minApplicationFee = await deuro.MIN_FEE();
  const solvencyStatus = computeSolvencyStatus(
    equity,
    monitorConfig.thresholds.equityCriticalLevel,
    monitorConfig.thresholds.equityWarningLevel,
  );
  const dailyVolume = await getDailyVolume(deuro);

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
    minApplicationPeriod,
    minApplicationFee,
    dailyVolume,
    lossEvents,
    profitEvents,
    minterAppliedEvents,
    minterDeniedEvents,
    profitsDistributedEvents,
  };
}

// Compute the 24h volume of dEURO transfers (excluding minting and burning)
async function getDailyVolume(deuro: DecentralizedEURO): Promise<bigint> {
  const provider = deuro.runner?.provider;
  if (!provider) return 0n;

  const currentBlock = await provider.getBlockNumber();
  const oneDayBlocks = Math.round(86400 / monitorConfig.blockTime);
  const fromBlock = Math.max(currentBlock - oneDayBlocks, 0);
  const events = await batchedEventQuery(deuro, deuro.filters.Transfer(), fromBlock);

  let volume = 0n;
  for (const event of events) {
    const { from, to, value } = event.args;
    if (from !== ZeroAddress && to !== ZeroAddress) {
      volume += value;
    }
  }

  return volume;
}

async function processLossEvents(deuro: DecentralizedEURO, color?: string): Promise<EventTrendData> {
  const events = await batchedEventQuery(deuro, deuro.filters.Loss(), monitorConfig.deploymentBlock);
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const lossTrend = aggregateData(processedEvents, [{ name: 'Loss (dEURO)', key: 'amount', ops: Operator.sum }]);
  return {
    trend: lossTrend,
    events: processedEvents,
  };
}

async function processProfitEvents(deuro: DecentralizedEURO, color?: string): Promise<EventTrendData> {
  const events = await batchedEventQuery(deuro, deuro.filters.Profit(), monitorConfig.deploymentBlock);
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const profitTrend = aggregateData(processedEvents, [{ name: 'Profit (dEURO)', key: 'amount', ops: Operator.sum }]);
  return {
    trend: profitTrend,
    events: processedEvents,
  };
}

async function processMinterAppliedEvents(deuro: DecentralizedEURO, color?: string): Promise<EventTrendData> {
  const events = await batchedEventQuery(deuro, deuro.filters.MinterApplied(), monitorConfig.deploymentBlock);
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const minterAppliedTrend = aggregateData(processedEvents, [
    {
      name: 'MinterApplied (occ.)',
      key: '',
      ops: Operator.count,
      valueFormatter: (value) => value.toString(),
    },
  ]);
  return {
    trend: minterAppliedTrend,
    events: processedEvents,
  };
}

async function processMinterDeniedEvents(deuro: DecentralizedEURO, color?: string): Promise<EventTrendData> {
  const events = await batchedEventQuery(deuro, deuro.filters.MinterDenied(), monitorConfig.deploymentBlock);
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const minterDeniedTrend = aggregateData(processedEvents, [
    { name: 'MinterDenied (occ.)', key: '', ops: Operator.count, valueFormatter: (value) => value.toString() },
  ]);
  return {
    trend: minterDeniedTrend,
    events: processedEvents,
  };
}

async function processProfitsDistributedEvents(deuro: DecentralizedEURO, color?: string): Promise<EventTrendData> {
  const events = await batchedEventQuery(deuro, deuro.filters.ProfitDistributed(), monitorConfig.deploymentBlock);
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const profitsDistributedTrend = aggregateData(processedEvents, [
    { name: 'ProfitsDistributed (dEURO)', key: 'amount', ops: Operator.sum },
  ]);
  return {
    trend: profitsDistributedTrend,
    events: processedEvents,
  };
}

/**
 * Computes the solvency status based on equity and thresholds
 * @param equity Equity amount in wei
 * @param equityCriticalLevel Minimum equity threshold
 * @param equityWarningLevel Warning level for equity
 * @returns HealthStatus indicating the solvency status
 */
function computeSolvencyStatus(equity: bigint, equityCriticalLevel: number, equityWarningLevel: number): HealthStatus {
  const solvencyLevel = Number(formatEther(equity));
  if (solvencyLevel < equityCriticalLevel) {
    return HealthStatus.CRITICAL;
  } else if (solvencyLevel < equityWarningLevel) {
    return HealthStatus.WARNING;
  } else {
    return HealthStatus.HEALTHY;
  }
}
