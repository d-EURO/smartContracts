import { task } from 'hardhat/config';
import { formatHash } from '../scripts/utils/utils';
import {
  colors,
  formatCurrencyFromWei,
  formatDateTime,
  createTable,
  formatCountdown,
  formatMultiLine,
} from '../scripts/utils/table';
import MonitoringModule from '../scripts/monitoring';
import { BridgeState, HealthStatus } from '../scripts/monitoring/types';
import monitorConfig from '../scripts/utils/monitorConfig';
import { printTitle, Time } from '../scripts/monitoring/utils';

// npx hardhat monitor-bridges --network mainnet
task('monitor-bridges', 'Monitor Stablecoin Bridge contracts').setAction(async ({}, hre) => {
  let monitoringModule = new MonitoringModule(hre);
  monitoringModule = await monitoringModule.init();
  const bridgeStates = await monitoringModule.getBridgeStates();

  printTitle('Bridge States');

  const totalMinted = bridgeStates.reduce((sum, bridge) => sum + bridge.minted, 0n);
  const totalLimit = bridgeStates.reduce((sum, bridge) => sum + bridge.limit, 0n);
  const totalUtilization = Number((totalMinted * 10000n) / totalLimit) / 100;

  console.log(`Total minted:          ${formatCurrencyFromWei(totalMinted)} dEURO`);
  console.log(`Total limit:           ${formatCurrencyFromWei(totalLimit)} dEURO`);
  console.log(
    `Overall utilization:   ${getUtilizationColor(totalUtilization)}${totalUtilization.toFixed(2)}%${colors.reset}\n`,
  );

  // TODO: Add verbose warning
  // const bridgesNearingExpiration = bridgeStates.filter(
  //   (bridge) => Number(bridge.horizon) - Math.floor(Date.now() / 1000) < 60 * 60 * 24 * 30, // 30 days
  // );
  // if (bridgesNearingExpiration.length > 0) {
  //   console.log(
  //     `\n${colors.yellow}${colors.bold}Warning:${colors.reset} ${bridgesNearingExpiration.length} bridges are nearing expiration (< 30 days)`,
  //   );
  //   bridgesNearingExpiration.forEach((bridge) => {
  //     console.log(`- ${bridge.name} (${formatCountdown(bridge.horizon)})`);
  //   });
  // }

  const bridgesTable = createTable<BridgeState>();
  bridgesTable.setColumns([
    {
      header: 'Bridge\n' + colors.dim + 'Address' + colors.reset,
      width: 20,
      align: 'left',
      format: (row) => {
        return formatMultiLine(
          {
            primary: `${colors.bold}${row.name}${colors.reset}`,
            secondary: formatHash(row.address, true, 'address', false),
          },
          20,
          'left',
        );
      },
    },
    {
      header: 'Token\n' + colors.dim + 'Symbol' + colors.reset,
      width: 15,
      align: 'left',
      format: (row) => {
        return formatMultiLine(
          {
            primary: formatHash(row.eur, true),
            secondary: row.symbol,
          },
          15,
          'left',
        );
      },
    },
    {
      header: 'Minted\n' + colors.dim + 'Limit' + colors.reset,
      width: 18,
      align: 'right',
      format: (row) => {
        return formatMultiLine(
          {
            primary: `${formatCurrencyFromWei(row.minted)}`,
            secondary: `${formatCurrencyFromWei(row.limit)}`,
          },
          18,
          'right',
        );
      },
    },
    {
      header: 'Utilization',
      width: 15,
      align: 'right',
      format: (row) => {
        const color = getUtilizationColor(row.utilization);
        return `${color}${row.utilization.toFixed(2)}%${colors.reset}`;
      },
    },
    {
      header: 'Expiration\n' + colors.dim + 'Countdown' + colors.reset,
      width: 20,
      align: 'right',
      format: (row) => {
        return formatMultiLine(
          {
            primary: formatDateTime(Number(row.horizon)),
            secondary: formatCountdown(row.horizon),
            secondaryColor: getExpirationColor(row.horizon),
          },
          20,
          'right',
        );
      },
    },
    {
      header: 'Status',
      width: 10,
      align: 'right',
      format: (row) => {
        return `${getHealthStatusColor(row.status)}${row.status}${colors.reset}`;
      },
    },
  ]);

  bridgesTable.setData(bridgeStates);
  bridgesTable.setSorting('utilization', 'desc');
  bridgesTable.showHeaderSeparator(true);
  bridgesTable.setRowSpacing(true);
  bridgesTable.print();
});

function getExpirationColor(expiration: bigint): string {
  const daysLeft = Time.daysLeft(Number(expiration));
  if (daysLeft < monitorConfig.thresholds.bridgeExpirationCritical) {
    return colors.red;
  } else if (daysLeft < monitorConfig.thresholds.bridgeExpirationWarning) {
    return colors.yellow;
  } else {
    return colors.green;
  }
}

function getUtilizationColor(utilization: number): string {
  if (utilization > monitorConfig.thresholds.bridgeUtilizationCritical) {
    return colors.red;
  } else if (utilization > monitorConfig.thresholds.bridgeUtilizationWarning) {
    return colors.yellow;
  } else {
    return colors.green;
  }
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
