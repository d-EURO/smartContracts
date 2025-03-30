import { task } from 'hardhat/config';
import { etherscanUrl, formatAddress, hyperlink } from '../scripts/utils/utils';
import {
  colors,
  formatDateTime,
  formatCurrency,
  formatMultiLine,
  createTable,
  formatCountdown,
  formatCurrencyFromWei,
} from '../scripts/utils/table';
import MonitoringModule from '../scripts/monitoring';
import { PositionState, PositionStatus } from '../scripts/monitoring/types';

// npx hardhat monitor-positions --network mainnet --owner <ADDRESS> --sort <COLUMN>
task('monitor-positions', 'Monitor positions in the dEuro Protocol')
  .addOptionalParam('owner', 'Filter positions by owner address')
  .addOptionalParam(
    'sort',
    'Column to sort by in descending order (created, position, owner, collateral, price, collateralBalance, collateralValue, debt, utilization, expiration)',
  )
  .setAction(async ({ owner, sort }, hre) => {
    const { formatUnits } = hre.ethers;

    let monitoringModule = new MonitoringModule(hre);
    monitoringModule = await monitoringModule.init();
    const positionsData = await monitoringModule.getPositions();

    console.log(`> Found ${positionsData.length} positions\n`);

    // Create and configure the table
    const table = createTable<PositionState>();
    if (sort) table.setSorting(sort);
    table.setData(positionsData);
    table.setRowSpacing(true);
    table.setShouldDimRow((row) => row.isClosed);
    table.setColumns([
      {
        header: 'Created\nState',
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
        header: 'Position\nOwner',
        width: 15,
        align: 'left',
        format: (row) =>
          formatMultiLine(
            {
              primary: formatAddress(row.address, true),
              primaryColor: row.original === row.address ? colors.yellow : undefined,
              secondary: formatAddress(row.owner, true),
              secondaryColor: colors.dim,
            },
            15,
            'left',
          ),
      },
      {
        header: 'Collateral\nPrice',
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
        header: 'Balance\nValue',
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
        header: 'Debt\nUtil. %',
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
        header: 'Liq. Price\nMark. Price',
        width: 15,
        align: 'right',
        format: function (row) {
          const isUndercollaterized = row.state === PositionStatus.UNDERCOLLATERIZED;
          return formatMultiLine(
            {
              primary: formatCurrencyFromWei(row.virtualPrice, 2, 36n - row.collateralDecimals),
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
        header: 'Challenge\nPeriod',
        width: 15,
        align: 'right',
        format: function (row) {
          const isChallenged = BigInt(formatUnits(row.challengedAmount, row.collateralDecimals).replace('.', '')) > 0n;
          return formatMultiLine(
            {
              primary: formatCurrencyFromWei(row.challengedAmount, 4, row.collateralDecimals),
              primaryColor: isChallenged ? colors.red : undefined,
              secondary: formatCountdown(row.challengePeriod, true, true),
              secondaryColor: isChallenged ? colors.red : undefined,
            },
            15,
            'right',
          );
        },
      },
      {
        header: 'Start\nExpiry',
        width: 18,
        align: 'left',
        format: (row) =>
          formatMultiLine(
            {
              primary: formatDateTime(Number(row.start)),
              secondary: formatCountdown(row.expiration),
            },
            18,
            'left',
          ),
      },
    ]);

    table.print();
  });
