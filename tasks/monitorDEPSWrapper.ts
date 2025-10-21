import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { colors, formatCurrencyFromWei, createTable } from '../scripts/utils/table';
import { getMonitoringModule } from '../scripts/monitoring';
import { createEventTrendsTable, eventTrendDataToArray } from '../scripts/monitoring/utils';

// npx hardhat monitor-deps --network mainnet
export async function monitorDEPSWrapperAction({ includeEventTxs }: { includeEventTxs?: boolean }, hre: HardhatRuntimeEnvironment) {
    const monitoringModule = await getMonitoringModule(hre);
    const depsState = await monitoringModule.getDEPSWrapperState();

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
      { key: 'Total Supply', value: formatCurrencyFromWei(depsState.totalSupply) + ' DEPS' },
      { key: 'Underlying Token', value: depsState.underlyingSymbol },
    ]);

    metricsTable.showHeaderSeparator(true);
    metricsTable.setColumnSeparator('  ');
    metricsTable.setRowSpacing(false);
    metricsTable.print();

    // Event trends
    console.log();
    const eventTrendsTable = createEventTrendsTable('DEPSWrapper Events');
    eventTrendsTable.setData([
      ...eventTrendDataToArray(depsState.transferEvents.trend),
      ...eventTrendDataToArray(depsState.wrapEvents.trend),
      ...eventTrendDataToArray(depsState.unwrapEvents.trend),
    ]);
    eventTrendsTable.print();

    // Event transactions
    // TODO: Print event transactions if includeEventTxs is true
}