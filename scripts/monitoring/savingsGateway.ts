import { SavingsGatewayState, EventTrendData } from './types';
import monitorConfig from '../utils/monitorConfig';
import { DecentralizedEURO, SavingsGateway } from '../../typechain';
import { aggregateData, Operator, processEvents } from './utils';
import { colors } from '../utils/table';

/**
 * Fetches the state of the Leadrate contract
 * @param savingsGateway SavingsGateway contract
 * @param deuro DecentralizedEURO contract
 * @returns SavingsGatewayState
 */
export async function getSavingsGatewayState(
  savingsGateway: SavingsGateway,
  deuro: DecentralizedEURO,
): Promise<SavingsGatewayState> {
  const address = await savingsGateway.getAddress();
  const currentRatePPM = await savingsGateway.currentRatePPM();
  const nextRatePPM = await savingsGateway.nextRatePPM();
  const nextChange = await savingsGateway.nextChange();
  const hasPendingChange = currentRatePPM !== nextRatePPM;
  const changeTime = hasPendingChange ? new Date(Number(nextChange) * 1000).toLocaleString() : '';
  const totalSavings = await deuro.balanceOf(address);

  // events
  const savedEvents = await processSavedEvents(savingsGateway, colors.green);
  const interestCollectedEvents = await processInterestCollectedEvents(savingsGateway, colors.yellow);
  const withdrawnEvents = await processWithdrawnEvents(savingsGateway, colors.red);
  const rateProposedEvents = await processRateProposedEvents(savingsGateway, colors.yellow);
  const rateChangedEvents = await processRateChangedEvents(savingsGateway, colors.yellow);
  const uniqueSavers = new Set(savedEvents.events.map((event) => event.data.account)).size;

  return {
    address: await savingsGateway.getAddress(),
    currentRatePPM,
    nextRatePPM,
    nextChange,
    hasPendingChange,
    changeTime,
    tradeEvents: savedEvents,
    interestCollectedEvents,
    withdrawnEvents,
    rateProposedEvents,
    rateChangedEvents,
    uniqueSavers,
    totalSavings,
  };
}

async function processSavedEvents(savingsGateway: SavingsGateway, color?: string): Promise<EventTrendData> {
  const events = await savingsGateway.queryFilter(
    savingsGateway.filters.Saved(),
    monitorConfig.deploymentBlock,
    'latest',
  );
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const savedTrend = aggregateData(processedEvents, [{ name: 'amount', key: 'amount', ops: Operator.sum }]);
  return {
    trend: savedTrend,
    events: processedEvents,
  };
}

async function processInterestCollectedEvents(savingsGateway: SavingsGateway, color?: string): Promise<EventTrendData> {
  const events = await savingsGateway.queryFilter(
    savingsGateway.filters.InterestCollected(),
    monitorConfig.deploymentBlock,
    'latest',
  );
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const interestCollectedTrend = aggregateData(processedEvents, [
    { name: 'interest', key: 'interest', ops: Operator.sum },
  ]);
  return {
    trend: interestCollectedTrend,
    events: processedEvents,
  };
}

async function processWithdrawnEvents(savingsGateway: SavingsGateway, color?: string): Promise<EventTrendData> {
  const events = await savingsGateway.queryFilter(
    savingsGateway.filters.Withdrawn(),
    monitorConfig.deploymentBlock,
    'latest',
  );
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const withdrawnTrend = aggregateData(processedEvents, [{ name: 'withdrawn', key: 'amount', ops: Operator.sum }]);
  return {
    trend: withdrawnTrend,
    events: processedEvents,
  };
}

async function processRateProposedEvents(savingsGateway: SavingsGateway, color?: string): Promise<EventTrendData> {
  const events = await savingsGateway.queryFilter(
    savingsGateway.filters.RateProposed(),
    monitorConfig.deploymentBlock,
    'latest',
  );
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const rateProposedTrend = aggregateData(processedEvents, [{ name: 'rateProposed', key: '', ops: Operator.count }]);
  return {
    trend: rateProposedTrend,
    events: processedEvents,
  };
}

async function processRateChangedEvents(savingsGateway: SavingsGateway, color?: string): Promise<EventTrendData> {
  const events = await savingsGateway.queryFilter(
    savingsGateway.filters.RateChanged(),
    monitorConfig.deploymentBlock,
    'latest',
  );
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const rateChangedTrend = aggregateData(processedEvents, [{ name: 'rateChanged', key: '', ops: Operator.count }]);
  return {
    trend: rateChangedTrend,
    events: processedEvents,
  };
}
