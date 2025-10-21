import { colors } from '../utils/table';
import { DEPSWrapperState, EventTrendData } from './types';
import monitorConfig from '../utils/monitorConfig';
import { DEPSWrapper, Equity__factory } from '../../typechain';
import { aggregateData, Operator, processEvents } from './utils';
import { batchedEventQuery } from '../utils/blockchain';

/**
 * Fetches the state of the DEPSWrapper contract
 * @param depsWrapper DEPSWrapper contract
 * @returns DEPSWrapperState
 */
export async function getDEPSWrapperState(depsWrapper: DEPSWrapper): Promise<DEPSWrapperState> {
  const address = await depsWrapper.getAddress();
  const totalSupply = await depsWrapper.totalSupply();
  const underlyingAddress = await depsWrapper.underlying();
  const equity = Equity__factory.connect(underlyingAddress, depsWrapper.runner);
  const underlyingSymbol = await equity.symbol();

  // Query Transfer events once and reuse for all processing
  const allTransferEvents = await batchedEventQuery(depsWrapper, depsWrapper.filters.Transfer(), monitorConfig.deploymentBlock);
  
  // Process events using the shared event data
  const transferEvents = await processTransferEvents(allTransferEvents, colors.blue);
  const wrapEvents = await processWrapEvents(allTransferEvents, colors.green);
  const unwrapEvents = await processUnwrapEvents(allTransferEvents, colors.yellow);

  return {
    address,
    totalSupply,
    underlyingAddress,
    underlyingSymbol,
    transferEvents,
    wrapEvents,
    unwrapEvents,
  };
}

// Wrap events tracked via Transfer events (from zero address)
async function processWrapEvents(allEvents: any[], color?: string): Promise<EventTrendData> {
  const wrapEvents = allEvents.filter((event) => event.args.from === '0x0000000000000000000000000000000000000000');
  const processedEvents = (await processEvents(wrapEvents, color)).sort((a, b) => b.timestamp - a.timestamp);
  const wrapTrend = aggregateData(processedEvents, [{ name: 'Wrap (DEPS)', key: 'value', ops: Operator.sum }]);

  return {
    trend: wrapTrend,
    events: processedEvents,
  };
}

// Unwrap events tracked via Transfer events (to zero address)
async function processUnwrapEvents(allEvents: any[], color?: string): Promise<EventTrendData> {
  const unwrapEvents = allEvents.filter((event) => event.args.to === '0x0000000000000000000000000000000000000000');
  const processedEvents = (await processEvents(unwrapEvents, color)).sort((a, b) => b.timestamp - a.timestamp);
  const unwrapTrend = aggregateData(processedEvents, [{ name: 'Unwrap (DEPS)', key: 'value', ops: Operator.sum }]);

  return {
    trend: unwrapTrend,
    events: processedEvents,
  };
}

async function processTransferEvents(allEvents: any[], color?: string): Promise<EventTrendData> {
  const transferEvents = allEvents.filter(
    (event) =>
      event.args.from !== '0x0000000000000000000000000000000000000000' &&
      event.args.to !== '0x0000000000000000000000000000000000000000',
  );
  const processedEvents = (await processEvents(transferEvents, color)).sort((a, b) => b.timestamp - a.timestamp);
  const transferTrend = aggregateData(processedEvents, [{ name: 'Transfer (DEPS)', key: 'value', ops: Operator.sum }]);

  return {
    trend: transferTrend,
    events: processedEvents,
  };
}