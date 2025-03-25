import { getFlashbotDeploymentAddress } from '../scripts/utils/deployments';
import { task } from 'hardhat/config';
import { floatToDec18 } from '../scripts/utils/math';
import { formatAddress } from '../scripts/utils/utils';
import {
  colors,
  formatDateTime,
  formatNumberWithSeparator,
  formatMultiLine,
  createTable,
  formatCountdown,
} from '../scripts/utils/table';

interface PositionData {
  created: number;
  position: string;
  original: string;
  owner: string;
  collateral: string;
  price: string;
  collateralBalance: string;
  collateralValue: string;
  debt: string;
  utilization: bigint;
  expiration: bigint;
}

// npx hardhat get-positions --network mainnet --owner <ADDRESS> --sort <COLUMN>
// Sort options: created, position, owner, collateral, price, collateralBalance, collateralValue, debt, utilization, expiration
// TODO: Optionally output to CSV.
task('get-positions', 'Get positions owned by an account')
  .addOptionalParam('owner', 'The address of the owner')
  .addOptionalParam(
    'sort',
    'Column to sort by in descending order (created, position, owner, collateral, price, collateralBalance, collateralValue, debt, utilization, expiration)',
  )
  .setAction(async ({ owner, sort }, hre) => {
    if (owner) console.log(`> Checking positions owned by: ${owner}`);
    const { formatEther, formatUnits } = hre.ethers;

    // Get MintingHubGateway contract
    const [signer] = await hre.ethers.getSigners();
    const mintingHubGatewayAddress = await getFlashbotDeploymentAddress('mintingHubGateway');
    const mintingHubGateway = await hre.ethers.getContractAt('MintingHub', mintingHubGatewayAddress, signer);

    // Filter PositionOpened events, starting from block 22088283 (see deployments metadata)
    const positionOpenedEvent = mintingHubGateway.filters.PositionOpened(owner);
    const events = await mintingHubGateway.queryFilter(positionOpenedEvent, 22088283, 'latest');
    console.log(`> Found ${events.length} positions.\n`);

    const positionsData: PositionData[] = [];

    // Process all positions
    await Promise.all(
      events.map(async (event) => {
        try {
          const position = await hre.ethers.getContractAt('Position', event.args.position);
          const original = await position.original();
          const collateral = await hre.ethers.getContractAt('ERC20', await position.collateral());
          const created = (await event.getBlock()).timestamp;

          const owner = await position.owner();
          const positionAddress = await position.getAddress();
          const price = await position.price();
          const debt = await position.getDebt();
          const collateralBalance = await collateral.balanceOf(positionAddress);
          const collateralDecimals = await collateral.decimals();
          const collateralSymbol = await collateral.symbol();
          const collateralValue = (collateralBalance * price) / floatToDec18(1);
          const collateralUtilization = collateralValue > 0 ? (debt * 100n) / collateralValue : 100n;
          const expiration = await position.expiration();

          positionsData.push({
            created,
            position: positionAddress,
            original: original,
            owner: owner,
            collateral: collateralSymbol,
            price: formatUnits(price, 36n - collateralDecimals),
            collateralBalance: formatUnits(collateralBalance, collateralDecimals),
            collateralValue: formatEther(collateralValue),
            debt: formatEther(debt),
            utilization: collateralUtilization,
            expiration: expiration,
          });
        } catch (error) {
          console.error(`Error processing position ${event.args.position}:`, error);
        }
      }),
    );

    // Create and configure the table
    const table = createTable<PositionData>();

    if (sort) table.setSorting(sort);

    // Set the data
    table.setData(positionsData);

    // Configure columns
    table.setColumns([
      {
        header: 'Created\nExpiry',
        width: 18,
        align: 'left',
        format: (row) =>
          formatMultiLine(
            {
              primary: formatDateTime(row.created),
              secondary: formatCountdown(row.expiration),
              secondaryColor: colors.dim,
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
              primary: formatAddress(row.position),
              primaryColor: row.original === row.position ? colors.yellow : undefined,
              secondary: formatAddress(row.owner),
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
              primary: row.collateral,
              secondary: formatNumberWithSeparator(row.price, 2),
              secondaryColor: colors.dim,
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
              primary: formatNumberWithSeparator(row.collateralBalance, 4),
              secondary: formatNumberWithSeparator(row.collateralValue, 2),
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
              primary: formatNumberWithSeparator(row.debt, 2),
              secondary: formatNumberWithSeparator(Number(row.utilization), 2) + '%',
              secondaryColor: Number(row.utilization) > 75 ? colors.green : undefined,
            },
            15,
            'right',
          ),
      },
    ]);

    // Print the table
    table.print();
  });
