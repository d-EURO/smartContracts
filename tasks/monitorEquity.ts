import { task } from 'hardhat/config';
import { formatHash } from '../scripts/utils/utils';
import { colors, formatCurrencyFromWei, formatDateTime, createTable } from '../scripts/utils/table';
import MonitoringModule from '../scripts/monitoring';
import { EventData } from '../scripts/monitoring/types';
import { createEventTrendsTable, eventTrendDataToArray, printTitle } from '../scripts/monitoring/utils';

// npx hardhat monitor-equity --network mainnet
task('monitor-equity', 'Monitor Equity contract state')
  .addFlag('includeEventTxs', 'Include detailed transaction events')
  .setAction(async ({ includeEventTxs }, hre) => {
    let monitoringModule = new MonitoringModule(hre);
    monitoringModule = await monitoringModule.init();
    const equityState = await monitoringModule.getEquityState();

    printTitle('Equity State (Core)');

    const metricsTable = createTable<{ key: string; value: string }>();
    metricsTable.setColumns([
      {
        header: '',
        width: 20,
        align: 'left',
        format: (row) => row.key,
      },
      {
        header: 'Amount',
        width: 20,
        align: 'right',
        format: (row) => row.value,
      },
    ]);

    metricsTable.setData([
      { key: 'Total Supply', value: formatCurrencyFromWei(equityState.totalSupply) + ' nDEPS' },
      { key: 'Price', value: formatCurrencyFromWei(equityState.price, 4) + ' dEURO' },
      { key: 'Market Cap', value: formatCurrencyFromWei(equityState.marketCap) + ' dEURO' },
    ]);

    metricsTable.showHeaderSeparator(true);
    metricsTable.setColumnSeparator('  ');
    metricsTable.setRowSpacing(false);
    metricsTable.print();

    // Event trends
    console.log();
    const eventTrendsTable = createEventTrendsTable('Equity Events');
    eventTrendsTable.setData([
      ...eventTrendDataToArray(equityState.tradeEvents.trend),
      ...eventTrendDataToArray(equityState.delegationEvents.trend),
    ]);
    eventTrendsTable.print();

    // Event transactions
    if (includeEventTxs) {
      // Print recent trade events
      if (equityState.tradeEvents.events.length > 0) {
        console.log(`\n${colors.bold}Recent Trade Events${colors.reset}`);
        printEventsTable(equityState.tradeEvents.events);
      }

      // Print delegation events
      if (equityState.delegationEvents.events.length > 0) {
        console.log(`\n${colors.bold}Recent Delegation Events${colors.reset}`);
        printEventsTable(equityState.delegationEvents.events);
      }
    }
  });

function printEventsTable(events: EventData[]) {
  const eventsTable = createTable<EventData>();
  eventsTable.setColumns([
    {
      header: 'Time',
      width: 18,
      align: 'left',
      format: (row) => formatDateTime(row.timestamp),
    },
    {
      header: 'Event',
      width: 20,
      align: 'left',
      format: (row) => row.name,
    },
    {
      header: 'Data',
      width: 40,
      align: 'left',
      format: (row) => formatEventData(row),
    },
    {
      header: 'Tx Hash',
      width: 15,
      align: 'left',
      format: (row) => formatHash(row.txHash, true, 'tx'),
    },
  ]);

  eventsTable.setData(events.slice(0, 5));
  eventsTable.showHeaderSeparator(true);
  eventsTable.setColumnSeparator('  ');
  eventsTable.print();
}

function formatEventData(event: EventData): string {
  const { data } = event;
  let result = '';

  if (data.amount !== undefined) {
    const amountValue = BigInt(data.amount.toString());
    const formattedAmount = formatCurrencyFromWei(amountValue);
    const prefix = amountValue > 0n ? '+' : '';
    result += `Amount: ${prefix}${formattedAmount} EQU`;
  }

  if (data.delegatee !== undefined) {
    result += `Delegatee: ${formatHash(data.delegatee, true)}`;
  }

  if (data.delegator !== undefined) {
    result += `Delegator: ${formatHash(data.delegator, true)}`;
  }

  if (data.sender !== undefined) {
    result += `Sender: ${formatHash(data.sender, true)}`;
  }

  if (data.recipient !== undefined) {
    result += `Recipient: ${formatHash(data.recipient, true)}`;
  }

  return result || '-';
}
