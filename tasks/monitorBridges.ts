import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { formatHash } from '../scripts/utils/utils';
import {
  colors,
  formatCurrencyFromWei,
  formatDateTime,
  createTable,
  formatCountdown,
  formatMultiLine,
  healthStatusColor,
  maxSeverity,
} from '../scripts/utils/table';
import { getMonitoringModule } from '../scripts/monitoring';
import { BridgeState, HealthStatus } from '../scripts/monitoring/types';

// npx hardhat monitor-bridges --network mainnet
export async function monitorBridgesAction(_: any, hre: HardhatRuntimeEnvironment) {
  const monitoringModule = await getMonitoringModule(hre);
  const bridgeStates = await monitoringModule.getBridgeStates();

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
        const color = healthStatusColor(row.utilizationStatus);
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
            secondaryColor: healthStatusColor(row.expirationStatus),
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
        const status = maxSeverity([row.expirationStatus, row.utilizationStatus]);
        return `${healthStatusColor(status)}${status}${colors.reset}`;
      },
    },
  ]);

  bridgesTable.setData(bridgeStates);
  bridgesTable.setShouldDimRow((row) => row.expirationStatus === HealthStatus.CLOSED);
  bridgesTable.setSorting('utilization', 'desc');
  bridgesTable.showHeaderSeparator(true);
  bridgesTable.setRowSpacing(true);
  bridgesTable.print();
}
