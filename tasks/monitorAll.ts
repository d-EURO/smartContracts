import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { getMonitoringModule } from '../scripts/monitoring';
import { colors, createTable, formatCurrencyFromWei, healthStatusColor } from '../scripts/utils/table';
import { createEventTrendsTable, eventTrendDataToArray } from '../scripts/monitoring/utils';

export async function monitorAllAction(_: any, hre: HardhatRuntimeEnvironment) {
  const monitoringModule = await getMonitoringModule(hre);
  const {
    juiceDollarState: jusdState,
    equityState,
    savingsGatewayState: savingsState,
    bridgeStates,
  } = await monitoringModule.getCompleteSystemState();
  
  console.log('\n');
  await hre.run('get-contracts');

  const currentRatePercentage = Number(savingsState.currentRatePPM) / 10000;
  const totalMinted = bridgeStates.reduce((sum, bridge) => sum + bridge.minted, 0n);
  const totalLimit = bridgeStates.reduce((sum, bridge) => sum + bridge.limit, 0n);
  const totalUtilization = Number((totalMinted * 10000n) / totalLimit) / 100;

  const metricsTable = createTable<{ key: string; value: string }>();
  metricsTable.setData([
    formatSubTitle('JUSD', 50),
    { key: 'Total Supply', value: formatCurrencyFromWei(jusdState.totalSupply) + ' JUSD' },
    { key: 'Reserve', value: formatCurrencyFromWei(jusdState.reserveBalance) + ' JUSD' },
    { key: 'Minter Reserve', value: formatCurrencyFromWei(jusdState.minterReserve) + ' JUSD' },
    {
      key: 'Equity Reserve',
      value: `${healthStatusColor(jusdState.solvencyStatus)}${formatCurrencyFromWei(jusdState.equity)} JUSD${colors.reset}`,
    },
    { key: '24h Volume', value: formatCurrencyFromWei(jusdState.dailyVolume) + ' JUSD' },
    formatSubTitle('Equity', 50),
    { key: 'Total Supply', value: formatCurrencyFromWei(equityState.totalSupply) + ' JUICE' },
    { key: 'Price', value: `${colors.green}${formatCurrencyFromWei(equityState.price, 4)} JUSD${colors.reset}` },
    { key: 'Market Cap', value: formatCurrencyFromWei(equityState.marketCap) + ' JUSD' },
    formatSubTitle('Savings', 50),
    { key: 'Total savings', value: formatCurrencyFromWei(savingsState.totalSavings) + ' JUSD' },
    { key: 'Interest rate', value: `${colors.green}${currentRatePercentage.toFixed(2)}%${colors.reset}` }, // TODO: Add next rate change warning below
    { key: 'Unique savers', value: savingsState.uniqueSavers.toString() }, // TODO: Get savers w/ balance > 0, compute mean, median
    formatSubTitle('Bridges', 50),
    { key: 'Total limit', value: formatCurrencyFromWei(totalLimit) + ' JUSD' },
    { key: 'Total minted', value: formatCurrencyFromWei(totalMinted) + ' JUSD' },
    { key: 'Overall utilization', value: `${colors.green}${totalUtilization.toFixed(2)}%${colors.reset}` },
  ]);
  metricsTable.setColumns([
    {
      header: '',
      width: 25,
      align: 'left',
      format: (row) => row.key,
    },
    {
      header: '',
      width: 25,
      align: 'right',
      format: (row) => row.value,
    },
  ]);

  metricsTable.setColumnSeparator('');
  metricsTable.showHeaderSeparator(false);
  metricsTable.setRowSpacing(false);
  metricsTable.print();
  console.log('\n\n');

  const eventTrendsTable = createEventTrendsTable('Events');
  eventTrendsTable.setData([
    ...eventTrendDataToArray(jusdState.profitEvents.trend),
    ...eventTrendDataToArray(jusdState.profitsDistributedEvents.trend),
    ...eventTrendDataToArray(jusdState.minterAppliedEvents.trend),
    ...eventTrendDataToArray(jusdState.minterDeniedEvents.trend),
    ...eventTrendDataToArray(jusdState.lossEvents.trend),
    ...eventTrendDataToArray(equityState.tradeEvents.trend),
    ...eventTrendDataToArray(equityState.delegationEvents.trend),
    ...eventTrendDataToArray(savingsState.savedEvents.trend),
    ...eventTrendDataToArray(savingsState.interestCollectedEvents.trend),
    ...eventTrendDataToArray(savingsState.withdrawnEvents.trend),
    ...eventTrendDataToArray(savingsState.rateProposedEvents.trend),
    ...eventTrendDataToArray(savingsState.rateChangedEvents.trend),
  ]);
  eventTrendsTable.print();
  
  console.log('\n\n');
  await hre.run('monitor-bridges');
  console.log('\n\n');
  await hre.run('monitor-positions');
  console.log('\n\n');
}

function formatSubTitle(title: string, width: number): { key: string; value: string } {
  const subtitle = '--- ' + title + ' ' + '-'.repeat(width - title.length - 5);
  return { key: `${colors.bold}${colors.dim}\n${subtitle}\n${colors.reset}`, value: '' };
}
