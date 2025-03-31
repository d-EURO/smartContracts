import { task } from 'hardhat/config';
import { formatHash } from '../scripts/utils/utils';
import { colors, formatCurrencyFromWei, formatDateTime, createTable } from '../scripts/utils/table';
import MonitoringModule from '../scripts/monitoring';
import { EventData, HealthStatus } from '../scripts/monitoring/types';
import { createEventTrendsTable, eventTrendDataToArray, printTitle } from '../scripts/monitoring/utils';

// npx hardhat monitor-deuro --network mainnet
task('monitor-deuro', 'Monitor DecentralizedEURO contract state')
  .addFlag('includeEventTxs', 'Include detailed transaction events')
  .setAction(async ({ includeEventTxs }, hre) => {
    let monitoringModule = new MonitoringModule(hre);
    monitoringModule = await monitoringModule.init();
    const deuroState = await monitoringModule.getDecentralizedEuroState();

    printTitle('DecentralizedEURO State (Core)');
    console.log(
      `Solvency Status: ${getHealthStatusColor(deuroState.solvencyStatus)}${deuroState.solvencyStatus}${colors.reset}\n`,
    );

    const metricsTable = createTable<{ key: string; value: string }>();
    metricsTable.setColumns([
      {
        header: '',
        width: 20,
        align: 'left',
        format: (row) => row.key,
      },
      {
        header: 'Amount (dEURO)',
        width: 20,
        align: 'right',
        format: (row) => row.value,
      },
    ]);

    metricsTable.setData([
      { key: 'Total Supply', value: formatCurrencyFromWei(deuroState.totalSupply) },
      { key: 'Reserve Balance', value: formatCurrencyFromWei(deuroState.reserveBalance) },
      { key: 'Minter Reserve', value: formatCurrencyFromWei(deuroState.minterReserve) },
      { key: 'Equity (Solvency)', value: formatCurrencyFromWei(deuroState.equity) },
    ]);

    metricsTable.showHeaderSeparator(true);
    metricsTable.setColumnSeparator('  ');
    metricsTable.setRowSpacing(false);
    metricsTable.print();

    // Event trends
    console.log();
    const eventTrendsTable = createEventTrendsTable('DecentralizedEURO Events');
    eventTrendsTable.setData([
      ...eventTrendDataToArray(deuroState.profitEvents.trend),
      ...eventTrendDataToArray(deuroState.profitsDistributedEvents.trend),
      ...eventTrendDataToArray(deuroState.minterAppliedEvents.trend),
      ...eventTrendDataToArray(deuroState.minterDeniedEvents.trend),
      ...eventTrendDataToArray(deuroState.lossEvents.trend),
    ]);
    eventTrendsTable.print();

    // Event transactions
    if (includeEventTxs) {
      if (deuroState.profitEvents.events.length > 0) {
        console.log(`\n${colors.bold}Recent Profit Events${colors.reset}\n`);
        printEventsTable(deuroState.profitEvents.events);
      }

      if (deuroState.lossEvents.events.length > 0) {
        console.log(`\n${colors.bold}Recent Loss Events${colors.reset}`);
        printEventsTable(deuroState.lossEvents.events);
      }

      if (deuroState.minterAppliedEvents.events.length > 0 || deuroState.minterDeniedEvents.events.length > 0) {
        console.log(`\n${colors.bold}Recent Minter Events${colors.reset}`);
        const minterEvents = [...deuroState.minterAppliedEvents.events, ...deuroState.minterDeniedEvents.events]
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 10);
        printEventsTable(minterEvents);
      }

      if (deuroState.profitsDistributedEvents.events.length > 0) {
        console.log(`\n${colors.bold}Recent Profit Distribution Events${colors.reset}`);
        printEventsTable(deuroState.profitsDistributedEvents.events);
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
    const formattedAmount = formatCurrencyFromWei(data.amount);
    result += `Amount: ${formattedAmount} dEURO`;
  }

  if (data.minter !== undefined) {
    result += `Minter: ${formatHash(data.minter, true)}`;
  }

  if (data.account !== undefined) {
    result += `Account: ${formatHash(data.account, true)}`;
  }

  return result || '-';
}

function getHealthStatusColor(status: HealthStatus): string {
  switch (status) {
    case HealthStatus.HEALTHY:
      return colors.green;
    case HealthStatus.WARNING:
      return colors.yellow;
    case HealthStatus.CRITICAL:
      return colors.red;
    default:
      return '';
  }
}
