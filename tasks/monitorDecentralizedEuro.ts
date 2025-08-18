import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { colors, formatCurrencyFromWei, createTable, healthStatusColor } from '../scripts/utils/table';
import { getMonitoringModule } from '../scripts/monitoring';
import { createEventTrendsTable, eventTrendDataToArray } from '../scripts/monitoring/utils';

// npx hardhat monitor-deuro --network mainnet
export async function monitorDecentralizedEuroAction({ includeEventTxs }: { includeEventTxs?: boolean }, hre: HardhatRuntimeEnvironment) {
    const monitoringModule = await getMonitoringModule(hre);
    const deuroState = await monitoringModule.getDecentralizedEuroState();

    console.log(
      `Solvency Status: ${healthStatusColor(deuroState.solvencyStatus)}${deuroState.solvencyStatus}${colors.reset}\n`,
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
    // TODO: Print event transactions if includeEventTxs is true
}
