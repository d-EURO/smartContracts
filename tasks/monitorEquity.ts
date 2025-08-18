import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { formatCurrencyFromWei, createTable } from '../scripts/utils/table';
import { getMonitoringModule } from '../scripts/monitoring';
import { createEventTrendsTable, eventTrendDataToArray } from '../scripts/monitoring/utils';

// npx hardhat monitor-equity --network mainnet
export async function monitorEquityAction({ includeEventTxs }: { includeEventTxs?: boolean }, hre: HardhatRuntimeEnvironment) {
    const monitoringModule = await getMonitoringModule(hre);
    const equityState = await monitoringModule.getEquityState();

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
    // TODO: Print event transactions if includeEventTxs is true
}
