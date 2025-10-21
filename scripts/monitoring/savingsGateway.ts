import { SavingsGatewayState, EventTrendData } from './types';
import monitorConfig from '../utils/monitorConfig';
import { JuiceDollar, SavingsGateway } from '../../typechain';
import { aggregateData, Operator, processEvents } from './utils';
import { colors } from '../utils/table';
import { batchedEventQuery } from '../utils/blockchain';

/**
 * Fetches the state of the Leadrate contract
 * @param savingsGateway SavingsGateway contract
 * @param jusd JuiceDollar contract
 * @returns SavingsGatewayState
 */
export async function getSavingsGatewayState(
  savingsGateway: SavingsGateway,
  jusd: JuiceDollar,
): Promise<SavingsGatewayState> {
  const address = await savingsGateway.getAddress();
  const currentRatePPM = await savingsGateway.currentRatePPM();
  const nextRatePPM = await savingsGateway.nextRatePPM();
  const nextChange = await savingsGateway.nextChange();
  const hasPendingChange = currentRatePPM !== nextRatePPM;
  const changeTime = hasPendingChange ? new Date(Number(nextChange) * 1000).toLocaleString() : '';
  const totalSavings = await jusd.balanceOf(address);

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
    savedEvents,
    interestCollectedEvents,
    withdrawnEvents,
    rateProposedEvents,
    rateChangedEvents,
    uniqueSavers,
    totalSavings,
  };
}

async function processSavedEvents(savingsGateway: SavingsGateway, color?: string): Promise<EventTrendData> {
  const events = await batchedEventQuery(savingsGateway, savingsGateway.filters.Saved(), monitorConfig.deploymentBlock);
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const savedTrend = aggregateData(processedEvents, [{ name: 'Saved (JUSD)', key: 'amount', ops: Operator.sum }]);
  return {
    trend: savedTrend,
    events: processedEvents,
  };
}

async function processInterestCollectedEvents(savingsGateway: SavingsGateway, color?: string): Promise<EventTrendData> {
  const events = await batchedEventQuery(
    savingsGateway,
    savingsGateway.filters.InterestCollected(),
    monitorConfig.deploymentBlock,
  );
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const interestCollectedTrend = aggregateData(processedEvents, [
    { name: 'Interest Collected (JUSD)', key: 'interest', ops: Operator.sum },
  ]);
  return {
    trend: interestCollectedTrend,
    events: processedEvents,
  };
}

async function processWithdrawnEvents(savingsGateway: SavingsGateway, color?: string): Promise<EventTrendData> {
  const events = await batchedEventQuery(
    savingsGateway,
    savingsGateway.filters.Withdrawn(),
    monitorConfig.deploymentBlock,
  );
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const withdrawnTrend = aggregateData(processedEvents, [
    { name: 'Withdrawn (JUSD)', key: 'amount', ops: Operator.sum },
  ]);
  return {
    trend: withdrawnTrend,
    events: processedEvents,
  };
}

async function processRateProposedEvents(savingsGateway: SavingsGateway, color?: string): Promise<EventTrendData> {
  const events = await batchedEventQuery(
    savingsGateway,
    savingsGateway.filters.RateProposed(),
    monitorConfig.deploymentBlock,
  );
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const rateProposedTrend = aggregateData(processedEvents, [
    { name: 'Rate Proposed (occ.)', key: '', ops: Operator.count, valueFormatter: (value) => value.toString() },
  ]);
  return {
    trend: rateProposedTrend,
    events: processedEvents,
  };
}

async function processRateChangedEvents(savingsGateway: SavingsGateway, color?: string): Promise<EventTrendData> {
  const events = await batchedEventQuery(
    savingsGateway,
    savingsGateway.filters.RateChanged(),
    monitorConfig.deploymentBlock,
  );
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const rateChangedTrend = aggregateData(processedEvents, [
    { name: 'Rate Changed (occ.)', key: '', ops: Operator.count, valueFormatter: (value) => value.toString() },
  ]);
  return {
    trend: rateChangedTrend,
    events: processedEvents,
  };
}
