import { colors } from '../utils/table';
import { EquityState, EventTrendData } from './types';
import monitorConfig from '../utils/monitorConfig';
import { Equity } from '../../typechain';
import { aggregateData, Operator, processEvents } from './utils';
import { batchedEventQuery } from '../utils/blockchain';

/**
 * Fetches the state of the Equity contract
 * @param equity Equity contract
 * @returns EquityState
 */
export async function getEquityState(equity: Equity): Promise<EquityState> {
  const address = await equity.getAddress();
  const totalSupply = await equity.totalSupply();
  const price = await equity.price();
  const marketCap = (price * totalSupply) / BigInt(10 ** 18);

  // events
  const tradeEvents = await processTradeEvents(equity, colors.red);
  const delegationEvents = await processDelegationEvents(equity, colors.green);

  return {
    address,
    totalSupply,
    price,
    marketCap,
    tradeEvents,
    delegationEvents,
  };
}

async function processTradeEvents(equity: Equity, color?: string): Promise<EventTrendData> {
  const events = await batchedEventQuery(equity, equity.filters.Trade(), monitorConfig.deploymentBlock);
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const tradeTrend = aggregateData(processedEvents, [
    { name: 'Inflow (JUSD)', key: 'totPrice', ops: Operator.sum, filter: (event) => event.data.amount > 0 },
    { name: 'Outflow (JUSD)', key: 'totPrice', ops: Operator.sum, filter: (event) => event.data.amount < 0 },
  ]);
  return {
    trend: tradeTrend,
    events: processedEvents,
  };
}

async function processDelegationEvents(equity: Equity, color?: string): Promise<EventTrendData> {
  const events = await batchedEventQuery(equity, equity.filters.Delegation(), monitorConfig.deploymentBlock);
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const delegationTrend = aggregateData(processedEvents, [
    { name: 'Delegation (occ.)', key: '', ops: Operator.count, valueFormatter: (value) => value.toString() },
  ]);
  return {
    trend: delegationTrend,
    events: processedEvents,
  };
}
