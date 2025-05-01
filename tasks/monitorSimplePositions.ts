import { task } from 'hardhat/config';
import { formatCurrency, formatCurrencyFromWei, createTable } from '../scripts/utils/table';
import { getMonitoringModule } from '../scripts/monitoring';
import { PositionState } from '../scripts/monitoring/types';
import { formatUnits } from 'ethers';

task('monitor-simple-positions', 'Display simplified position data (asset, amount, price, value)').setAction(
  async ({}, hre) => {
    const monitoringModule = await getMonitoringModule(hre);
    const positionsData = await monitoringModule.getPositions();

    console.log(`Found ${positionsData.length} positions\n`);

    const table = createTable<PositionState>();
    table.setSorting('collateralValue', 'desc');
    table.setData(positionsData);
    table.setRowSpacing(true);
    table.setShouldDimRow((row) => row.isClosed);

    table.setColumns([
      {
        header: 'Asset',
        width: 15,
        align: 'left',
        format: (row) => row.collateralSymbol,
      },
      {
        header: 'Amount',
        width: 20,
        align: 'right',
        format: (row) => formatCurrencyFromWei(row.collateralBalance, 4, row.collateralDecimals),
      },
      {
        header: 'Price (€)',
        width: 15,
        align: 'right',
        format: (row) => {
          const price = row.marketPrice ? formatCurrency(row.marketPrice, 2) : '-';
          return price;
        },
      },
      {
        header: 'Value (€)',
        width: 20,
        align: 'right',
        format: (row) => (row.collateralValue ? formatCurrency(row.collateralValue, 2) : '-'),
      },
    ]);

    table.print();
  },
);
