import { colors } from '../utils/table';
import { DEPSWrapperState, EventTrendData } from './types';
import monitorConfig from '../utils/monitorConfig';
import { DEPSWrapper, Equity__factory } from '../../typechain';
import { aggregateData, Operator, processEvents } from './utils';

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

  // Process events
  const transferEvents = await processTransferEvents(depsWrapper, colors.blue);
  const wrapEvents = await processWrapEvents(depsWrapper, colors.green);
  const unwrapEvents = await processUnwrapEvents(depsWrapper, colors.yellow);

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
async function processWrapEvents(depsWrapper: DEPSWrapper, color?: string): Promise<EventTrendData> {
  const events = await depsWrapper.queryFilter(depsWrapper.filters.Transfer(), monitorConfig.deploymentBlock, 'latest');
  const wrapEvents = events.filter((event) => event.args.from === '0x0000000000000000000000000000000000000000');
  const processedEvents = (await processEvents(wrapEvents, color)).sort((a, b) => b.timestamp - a.timestamp);
  const wrapTrend = aggregateData(processedEvents, [{ name: 'Wrap (DEPS)', key: 'value', ops: Operator.sum }]);

  return {
    trend: wrapTrend,
    events: processedEvents,
  };
}

// Wrap events tracked via Transfer events (to zero address)
async function processUnwrapEvents(depsWrapper: DEPSWrapper, color?: string): Promise<EventTrendData> {
  const events = await depsWrapper.queryFilter(depsWrapper.filters.Transfer(), monitorConfig.deploymentBlock, 'latest');
  const unwrapEvents = events.filter((event) => event.args.to === '0x0000000000000000000000000000000000000000');
  const processedEvents = (await processEvents(unwrapEvents, color)).sort((a, b) => b.timestamp - a.timestamp);
  const unwrapTrend = aggregateData(processedEvents, [{ name: 'Unwrap (DEPS)', key: 'value', ops: Operator.sum }]);

  return {
    trend: unwrapTrend,
    events: processedEvents,
  };
}

async function processTransferEvents(depsWrapper: DEPSWrapper, color?: string): Promise<EventTrendData> {
  const events = await depsWrapper.queryFilter(depsWrapper.filters.Transfer(), monitorConfig.deploymentBlock, 'latest');
  const transferEvents = events.filter(
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