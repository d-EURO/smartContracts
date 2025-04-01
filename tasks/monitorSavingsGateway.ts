import { task } from 'hardhat/config';
import { colors, formatCurrencyFromWei } from '../scripts/utils/table';
import { getMonitoringModule } from '../scripts/monitoring';
import { createEventTrendsTable, eventTrendDataToArray } from '../scripts/monitoring/utils';

// npx hardhat monitor-savings --network mainnet
task('monitor-savings', 'Monitor SavingsGateway contract state')
  .addFlag('includeEventTxs', 'Include detailed transaction events')
  .setAction(async ({ includeEventTxs }, hre) => {
    const monitoringModule = await getMonitoringModule(hre);
    const savingsState = await monitoringModule.getSavingsGatewayState();
    const currentRatePercentage = Number(savingsState.currentRatePPM) / 10000;
    const nextRatePercentage = Number(savingsState.nextRatePPM) / 10000;

    console.log(`Total savings:   ${formatCurrencyFromWei(savingsState.totalSavings)} dEURO`);
    console.log(`Interest rate:   ${colors.green}${currentRatePercentage.toFixed(2)}%${colors.reset}`);
    console.log(`Unique savers:   ${savingsState.uniqueSavers}`); // TODO: Get savers w/ balance > 0, compute mean, median
    if (savingsState.hasPendingChange) {
      console.log(
        `Next rate:       ${colors.yellow}${nextRatePercentage.toFixed(2)}%${colors.reset} (changes on ${savingsState.changeTime})`,
      );
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

    // TODO: Print event transactions if includeEventTxs is true
  });
