import { colors } from '../utils/table';
import { EquityState, EventTrendData } from './types';
import monitorConfig from '../utils/monitorConfig';
import { Equity } from '../../typechain';
import { aggregateData, Operator, processEvents } from './utils';

/**
 * Fetches the state of the DecentralizedEURO contract
 * @param deuro DecentralizedEURO contract
 * @returns DecentralizedEuroState
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

async function processTradeEvents(deuro: Equity, color?: string): Promise<EventTrendData> {
  const events = await deuro.queryFilter(deuro.filters.Trade(), monitorConfig.deploymentBlock, 'latest');
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const tradeTrend = aggregateData(processedEvents, [
    { name: 'inflow', key: 'amount', ops: (a: number, b: number) => (b > 0 ? a + b : a) },
    { name: 'outflow', key: 'amount', ops: (a: number, b: number) => (b < 0 ? a + b : a) },
  ]);
  return {
    trend: tradeTrend,
    events: processedEvents,
  };
}

async function processDelegationEvents(deuro: Equity, color?: string): Promise<EventTrendData> {
  const events = await deuro.queryFilter(deuro.filters.Delegation(), monitorConfig.deploymentBlock, 'latest');
  const processedEvents = (await processEvents(events, color)).sort((a, b) => b.timestamp - a.timestamp);
  const delegationTrend = aggregateData(processedEvents, [{ name: 'delegation', key: '', ops: Operator.count }]);
  return {
    trend: delegationTrend,
    events: processedEvents,
  };
}
