import { etherscanUrl, formatHash, hyperlink } from '../scripts/utils/utils';
import {
  colors,
  formatDateTime,
  formatCurrency,
  formatMultiLine,
  createTable,
  formatCountdown,
  formatCurrencyFromWei,
} from '../scripts/utils/table';
import { getMonitoringModule } from '../scripts/monitoring';
import { PositionState, PositionStatus } from '../scripts/monitoring/types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

// Export the action separately for lazy loading
export async function monitorPositionsAction({ sort }: { sort?: string }, hre: HardhatRuntimeEnvironment) {
    const { formatUnits } = hre.ethers;

    const monitoringModule = await getMonitoringModule(hre);
    const positionsData = await monitoringModule.getPositions();

    console.log(`Found ${colors.green}${positionsData.length}${colors.reset} positions\n`);

    const table = createTable<PositionState>();
    table.setSorting(sort || 'created', 'desc');
    table.setData(positionsData);
    table.setRowSpacing(true);
    table.setShouldDimRow((row) => row.isClosed);
    table.setColumns([
      {
        header: 'Created\n' + colors.dim + 'State' + colors.reset,
        width: 18,
        align: 'left',
        format: (row) =>
          formatMultiLine(
            {
              primary: [PositionStatus.PROPOSED, PositionStatus.COOLDOWN].includes(row.state)
                ? formatCountdown(row.cooldown) // same as start for proposed
                : formatDateTime(Number(row.created)),
              primaryColor: row.state === PositionStatus.PROPOSED ? colors.red : undefined,
              secondary: row.state,
              secondaryColor: [
                PositionStatus.PROPOSED,
                PositionStatus.CHALLENGED,
                PositionStatus.UNDERCOLLATERIZED,
                PositionStatus.COOLDOWN,
              ].includes(row.state)
                ? colors.red
                : colors.dim,
            },
            18,
            'left',
          ),
      },
      {
        header: 'Position\n' + colors.dim + 'Owner' + colors.reset,
        width: 15,
        align: 'left',
        format: (row) =>
          formatMultiLine(
            {
              primary: formatHash(row.address, true),
              primaryColor: row.original === row.address ? colors.yellow : undefined,
              secondary: formatHash(row.owner, true),
              secondaryColor: colors.dim,
            },
            15,
            'left',
          ),
      },
      {
        header: 'Collateral\n' + colors.dim + 'Price' + colors.reset,
        width: 12,
        align: 'right',
        format: (row) =>
          formatMultiLine(
            {
              primary: hyperlink(etherscanUrl(row.collateralAddress), row.collateralSymbol),
              secondary: formatCurrencyFromWei(row.price, 2, 36n - row.collateralDecimals),
              secondaryColor: row.state === PositionStatus.UNDERCOLLATERIZED ? colors.red : colors.dim,
            },
            12,
            'right',
          ),
      },
      {
        header: 'Balance\n' + colors.dim + 'Value' + colors.reset,
        width: 15,
        align: 'right',
        format: (row) =>
          formatMultiLine(
            {
              primary: formatCurrencyFromWei(row.collateralBalance, 4, row.collateralDecimals),
              secondary: formatCurrencyFromWei(row.collateralValue, 2),
            },
            15,
            'right',
          ),
      },
      {
        header: 'Debt\n' + colors.dim + 'Util. %' + colors.reset,
        width: 15,
        align: 'right',
        format: (row) =>
          formatMultiLine(
            {
              primary: formatCurrencyFromWei(row.debt, 2),
              secondary: formatCurrency(Number(row.utilization), 2) + '%',
              secondaryColor: Number(row.utilization) > 75 ? colors.green : undefined,
            },
            15,
            'right',
          ),
      },
      {
        header: 'Liq. Price\n' + colors.dim + 'Market (€)' + colors.reset,
        width: 15,
        align: 'right',
        format: function (row) {
          const isUndercollaterized = row.state === PositionStatus.UNDERCOLLATERIZED;
          return formatMultiLine(
            {
              primary: formatCurrencyFromWei(row.liveVirtualPrice, 2, 36n - row.collateralDecimals),
              primaryColor: isUndercollaterized ? colors.red : undefined,
              secondary: formatCurrency(row.marketPrice ?? 0, 2),
              secondaryColor: isUndercollaterized ? colors.red : undefined,
            },
            15,
            'right',
          );
        },
      },
      {
        header: 'Challenge\n' + colors.dim + 'Price' + colors.reset,
        width: 15,
        align: 'right',
        format: function (row) {
          const isChallenged = BigInt(formatUnits(row.challengedAmount, row.collateralDecimals).replace('.', '')) > 0n;
          return formatMultiLine(
            {
              primary: formatCurrencyFromWei(row.challengedAmount, 4, row.collateralDecimals),
              primaryColor: isChallenged ? colors.red : undefined,
              secondary: isChallenged ? formatCurrencyFromWei(row.virtualPrice, 2, 36n - row.collateralDecimals) : '-',
              secondaryColor: isChallenged ? colors.red : undefined,
            },
            15,
            'right',
          );
        },
      },
      {
        header: 'Start\n' + colors.dim + 'Expiry' + colors.reset,
        width: 18,
        align: 'right',
        format: (row) =>
          formatMultiLine(
            {
              primary: formatDateTime(Number(row.start)),
              secondary: formatCountdown(row.expiration),
            },
            18,
            'right',
          ),
      },
    ]);

    table.print();
}
