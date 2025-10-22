import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { colors, formatCurrencyFromWei, createTable, healthStatusColor } from '../scripts/utils/table';
import { getMonitoringModule } from '../scripts/monitoring';
import { createEventTrendsTable, eventTrendDataToArray } from '../scripts/monitoring/utils';

// npx hardhat monitor-jusd --network citrea
export async function monitorJuiceDollarAction({ includeEventTxs }: { includeEventTxs?: boolean }, hre: HardhatRuntimeEnvironment) {
    const monitoringModule = await getMonitoringModule(hre);
    const jusdState = await monitoringModule.getJuiceDollarState();

    console.log(
      `Solvency Status: ${healthStatusColor(jusdState.solvencyStatus)}${jusdState.solvencyStatus}${colors.reset}\n`,
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
        header: 'Amount (JUSD)',
        width: 20,
        align: 'right',
        format: (row) => row.value,
      },
    ]);

    metricsTable.setData([
      { key: 'Total Supply', value: formatCurrencyFromWei(jusdState.totalSupply) },
      { key: 'Reserve Balance', value: formatCurrencyFromWei(jusdState.reserveBalance) },
      { key: 'Minter Reserve', value: formatCurrencyFromWei(jusdState.minterReserve) },
      { key: 'Equity (Solvency)', value: formatCurrencyFromWei(jusdState.equity) },
    ]);

    metricsTable.showHeaderSeparator(true);
    metricsTable.setColumnSeparator('  ');
    metricsTable.setRowSpacing(false);
    metricsTable.print();

    // Event trends
    console.log();
    const eventTrendsTable = createEventTrendsTable('JuiceDollar Events');
    eventTrendsTable.setData([
      ...eventTrendDataToArray(jusdState.profitEvents.trend),
      ...eventTrendDataToArray(jusdState.profitsDistributedEvents.trend),
      ...eventTrendDataToArray(jusdState.minterAppliedEvents.trend),
      ...eventTrendDataToArray(jusdState.minterDeniedEvents.trend),
      ...eventTrendDataToArray(jusdState.lossEvents.trend),
    ]);
    eventTrendsTable.print();

    // Event transactions
    // TODO: Print event transactions if includeEventTxs is true
}
