import { formatEther, ZeroAddress } from 'ethers';
import { colors } from '../utils/table';
import { JuiceDollarState, EventTrendData, HealthStatus } from './types';
import monitorConfig from '../utils/monitorConfig';
import { JuiceDollar } from '../../typechain';
import { aggregateData, Operator, processEvents } from './utils';
import { batchedEventQuery } from '../utils/blockchain';

/**
 * Fetches the state of the JuiceDollar contract
 * @param jusd JuiceDollar contract
 * @returns JuiceDollarState
 */
export async function getJuiceDollarState(jusd: JuiceDollar): Promise<JuiceDollarState> {
  const address = await jusd.getAddress();
  const totalSupply = await jusd.totalSupply();
  const equityAddress = await jusd.reserve();
  const reserveBalance = await jusd.balanceOf(equityAddress);
  const minterReserve = await jusd.minterReserve();
  const equity = await jusd.equity();
  const minApplicationPeriod = await jusd.MIN_APPLICATION_PERIOD();
  const minApplicationFee = await jusd.MIN_FEE();
  const solvencyStatus = computeSolvencyStatus(
    equity,
    monitorConfig.thresholds.equityCriticalLevel,
    monitorConfig.thresholds.equityWarningLevel,
  );
  const dailyVolume = await getDailyVolume(jusd);

  // events
  const lossEvents = await processLossEvents(jusd, colors.red);
  const profitEvents = await processProfitEvents(jusd, colors.green);
  const minterAppliedEvents = await processMinterAppliedEvents(jusd, colors.yellow);
  const minterDeniedEvents = await processMinterDeniedEvents(jusd, colors.red);
  const profitsDistributedEvents = await processProfitsDistributedEvents(jusd, colors.green);

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

// Compute the 24h volume of JUSD transfers (excluding minting and burning)
async function getDailyVolume(jusd: JuiceDollar): Promise<bigint> {
  const provider = jusd.runner?.provider;
  if (!provider) return 0n;

  const currentBlock = await provider.getBlockNumber();
  const oneDayBlocks = Math.round(86400 / monitorConfig.blockTime);
  const fromBlock = Math.max(currentBlock - oneDayBlocks, 0);
  const events = await batchedEventQuery(jusd, jusd.filters.Transfer(), fromBlock);

  let volume = 0n;
  for (const event of events) {
    const { from, to, value } = event.args;
    if (from !== ZeroAddress && to !== ZeroAddress) {
      volume += value;
    }
  }

  return volume;
}

async function processLossEvents(jusd: JuiceDollar, color?: string): Promise<EventTrendData> {
  const events = await batchedEventQuery(jusd, jusd.filters.Loss(), monitorConfig.deploymentBlock);
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const lossTrend = aggregateData(processedEvents, [{ name: 'Loss (JUSD)', key: 'amount', ops: Operator.sum }]);
  return {
    trend: lossTrend,
    events: processedEvents,
  };
}

async function processProfitEvents(jusd: JuiceDollar, color?: string): Promise<EventTrendData> {
  const events = await batchedEventQuery(jusd, jusd.filters.Profit(), monitorConfig.deploymentBlock);
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const profitTrend = aggregateData(processedEvents, [{ name: 'Profit (JUSD)', key: 'amount', ops: Operator.sum }]);
  return {
    trend: profitTrend,
    events: processedEvents,
  };
}

async function processMinterAppliedEvents(jusd: JuiceDollar, color?: string): Promise<EventTrendData> {
  const events = await batchedEventQuery(jusd, jusd.filters.MinterApplied(), monitorConfig.deploymentBlock);
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

async function processMinterDeniedEvents(jusd: JuiceDollar, color?: string): Promise<EventTrendData> {
  const events = await batchedEventQuery(jusd, jusd.filters.MinterDenied(), monitorConfig.deploymentBlock);
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const minterDeniedTrend = aggregateData(processedEvents, [
    { name: 'MinterDenied (occ.)', key: '', ops: Operator.count, valueFormatter: (value) => value.toString() },
  ]);
  return {
    trend: minterDeniedTrend,
    events: processedEvents,
  };
}

async function processProfitsDistributedEvents(jusd: JuiceDollar, color?: string): Promise<EventTrendData> {
  const events = await batchedEventQuery(jusd, jusd.filters.ProfitDistributed(), monitorConfig.deploymentBlock);
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const profitsDistributedTrend = aggregateData(processedEvents, [
    { name: 'ProfitsDistributed (JUSD)', key: 'amount', ops: Operator.sum },
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
