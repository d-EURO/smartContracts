import { task } from 'hardhat/config';
import { formatHash } from '../scripts/utils/utils';
import {
  colors,
  formatCurrencyFromWei,
  formatDateTime,
  createTable,
} from '../scripts/utils/table';
import MonitoringModule from '../scripts/monitoring';
import { EventData } from '../scripts/monitoring/types';
import { createEventTrendsTable, eventTrendDataToArray, printTitle } from '../scripts/monitoring/utils';

// npx hardhat monitor-savings --network mainnet
task('monitor-savings', 'Monitor SavingsGateway contract state')
  .addFlag('includeEventTxs', 'Include detailed transaction events')
  .setAction(async ({ includeEventTxs }, hre) => {
    let monitoringModule = new MonitoringModule(hre);
    monitoringModule = await monitoringModule.init();
    const savingsState = await monitoringModule.getSavingsGatewayState();
    const currentRatePercentage = Number(savingsState.currentRatePPM) / 10000;
    const nextRatePercentage = Number(savingsState.nextRatePPM) / 10000;

    printTitle('Savings Gateway State');
    console.log(`Total savings:   ${formatCurrencyFromWei(savingsState.totalSavings)} dEURO`);
    console.log(`Interest rate:   ${colors.green}${currentRatePercentage.toFixed(2)}%${colors.reset}`);
    console.log(`Unique savers:   ${savingsState.uniqueSavers}`); // TODO: Get savers w/ balance > 0, compute mean, median
    if (savingsState.hasPendingChange) {
      console.log(`Next rate:       ${colors.yellow}${nextRatePercentage.toFixed(2)}%${colors.reset} (changes on ${savingsState.changeTime})`);
    }
    
    // Event trends
    console.log();
    const eventTrendsTable = createEventTrendsTable('Savings Events');
    eventTrendsTable.setData([
      ...eventTrendDataToArray(savingsState.savedEvents.trend),
      ...eventTrendDataToArray(savingsState.interestCollectedEvents.trend),
      ...eventTrendDataToArray(savingsState.withdrawnEvents.trend),
      ...eventTrendDataToArray(savingsState.rateProposedEvents.trend),
      ...eventTrendDataToArray(savingsState.rateChangedEvents.trend),
    ]);
    eventTrendsTable.print();
    
    if (includeEventTxs) {
      if (savingsState.rateChangedEvents.events.length > 0) {
        console.log(`\n${colors.bold}Recent Rate Changes${colors.reset}`);
        printRateEventsTable(savingsState.rateChangedEvents.events);
      }
      
      if (savingsState.rateProposedEvents.events.length > 0) {
        console.log(`\n${colors.bold}Recent Rate Proposals${colors.reset}`);
        printRateEventsTable(savingsState.rateProposedEvents.events);
      }
      
      console.log(`\n${colors.bold}Recent Savings Activities${colors.reset}`);
      
      const allSavingsEvents = [
        ...savingsState.savedEvents.events.map(e => ({...e, type: 'deposit'})),
        ...savingsState.withdrawnEvents.events.map(e => ({...e, type: 'withdraw'})),
        ...savingsState.interestCollectedEvents.events.map(e => ({...e, type: 'interest'})),
      ].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
      
      if (allSavingsEvents.length > 0) {
        printSavingsActivitiesTable(allSavingsEvents);
      } else {
        console.log("No recent savings activities");
      }
    }
  });

function printRateEventsTable(events: EventData[]) {
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
      header: 'Rate',
      width: 15,
      align: 'right',
      format: (row) => {
        if (row.data?.rate) {
          const ratePercentage = Number(row.data.rate) / 10000;
          return `${ratePercentage.toFixed(2)}%`;
        }
        return '-';
      },
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

function printSavingsActivitiesTable(events: (EventData & { type: string })[]) {
  const eventsTable = createTable<EventData & { type: string }>();
  eventsTable.setColumns([
    {
      header: 'Time',
      width: 18,
      align: 'left',
      format: (row) => formatDateTime(row.timestamp),
    },
    {
      header: 'Type',
      width: 12,
      align: 'left',
      format: (row) => {
        if (row.type === 'deposit') return `${colors.green}Deposit${colors.reset}`;
        if (row.type === 'withdraw') return `${colors.red}Withdraw${colors.reset}`;
        if (row.type === 'interest') return `${colors.yellow}Interest${colors.reset}`;
        return row.type;
      },
    },
    {
      header: 'Account',
      width: 15,
      align: 'left',
      format: (row) => {
        if (row.data?.account) {
          return formatHash(row.data.account, true);
        }
        return '-';
      },
    },
    {
      header: 'Amount',
      width: 15,
      align: 'right',
      format: (row) => {
        let amount;
        if (row.type === 'deposit' || row.type === 'withdraw') {
          amount = row.data?.amount;
        } else if (row.type === 'interest') {
          amount = row.data?.interest;
        }
        
        if (amount) {
          return formatCurrencyFromWei(amount) + ' dEURO';
        }
        return '-';
      },
    },
    {
      header: 'Tx Hash',
      width: 15,
      align: 'left',
      format: (row) => formatHash(row.txHash, true, 'tx'),
    },
  ]);

  eventsTable.setData(events);
  eventsTable.showHeaderSeparator(true);
  eventsTable.setColumnSeparator('  ');
  eventsTable.print();
}