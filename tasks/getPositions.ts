import { getContractAddress } from '../scripts/utils/deployments';
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
import { getTokenPrices } from '../scripts/utils/coingecko';

enum PositionState {
  PROPOSED = 'PROPOSED',
  CHALLENGED = 'CHALLENGED',
  UNDERCOLLATERIZED = 'UNDERCOLLATERIZED',
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
}

interface PositionData {
  created: number;
  start: bigint;
  state: PositionState;
  position: string;
  original: string;
  owner: string;
  collateralAddress: string;
  collateral: string;
  price: string;
  collateralBalance: string;
  collateralValue: string;
  debt: string;
  utilization: number;
  expiration: bigint;
  virtualPrice: string;
  isClosed: boolean;
  challengedAmount: string;
  challengePeriod: bigint;
  marketPrice?: string;
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
    const mintingHubGatewayAddress = await getContractAddress('mintingHubGateway');
    const mintingHubGateway = await hre.ethers.getContractAt('MintingHub', mintingHubGatewayAddress, signer);

    // Filter PositionOpened events, starting from block 22088283 (see deployments metadata)
    const positionOpenedEvent = mintingHubGateway.filters.PositionOpened(owner);
    const events = await mintingHubGateway.queryFilter(positionOpenedEvent, 22088283, 'latest');
    console.log(`> Found ${events.length} positions.\n`);

    // Process all positions
    const positionsData: PositionData[] = [];
    const specialTokenPrice: { [key: string]: string } = {};
    await Promise.all(
      events.map(async (event) => {
        try {
          const position = await hre.ethers.getContractAt('Position', event.args.position);
          const original = await position.original();
          const collateral = await hre.ethers.getContractAt('ERC20Wrapper', await position.collateral());
          const created = (await event.getBlock()).timestamp;
          const start = await position.start();

          const owner = await position.owner();
          const positionAddress = await position.getAddress();
          const price = await position.price();
          const virtualPrice = await position.virtualPrice();
          const debt = await position.getDebt();
          const collateralBalance = await collateral.balanceOf(positionAddress);
          const collateralDecimals = await collateral.decimals();
          const collateralSymbol = await collateral.symbol();
          const collateralAddress = (await collateral.getAddress()).toLowerCase();
          const collateralValue = (collateralBalance * price) / floatToDec18(1);
          const collateralUtilization = collateralValue > 0 ? Number((debt * 100000n) / collateralValue) / Number(1000) : 0;
          const expiration = await position.expiration();
          const isClosed = await position.isClosed();
          const challengedAmount = await position.challengedAmount();
          const challengePeriod = await position.challengePeriod();
          const state =
            Date.now() / 1000 < start
              ? PositionState.PROPOSED
              : challengedAmount > 0
                ? PositionState.CHALLENGED
                : isClosed
                  ? PositionState.CLOSED
                  : PositionState.OPEN;

          // WFPS & DEPS need direct price fetching
          if (['WFPS', 'DEPS'].includes(collateralSymbol.toUpperCase()) && !specialTokenPrice[collateralAddress]) {
            const underlying = await collateral.underlying();
            const native = await hre.ethers.getContractAt('Equity', underlying);
            const nativePrice = await native.price();
            specialTokenPrice[collateralAddress] = formatUnits(nativePrice, collateralDecimals);
          }

          positionsData.push({
            created,
            start,
            state,
            position: positionAddress,
            original,
            owner,
            collateralAddress,
            collateral: collateralSymbol,
            price: formatUnits(price, 36n - collateralDecimals),
            collateralBalance: formatUnits(collateralBalance, collateralDecimals),
            collateralValue: formatEther(collateralValue),
            debt: formatEther(debt),
            utilization: collateralUtilization,
            expiration,
            virtualPrice: formatUnits(virtualPrice, 36n - collateralDecimals),
            isClosed,
            challengedAmount: formatUnits(challengedAmount, collateralDecimals),
            challengePeriod,
          });
        } catch (error) {
          console.error(`Error processing position ${event.args.position}:`, error);
        }
      }),
    );

    // Get collateral prices
    const collateralAddresses = Array.from(new Set(positionsData.map((position) => position.collateralAddress)));
    const marketPrices = { ...(await getTokenPrices(collateralAddresses)), ...specialTokenPrice };
    positionsData.forEach((pos) => {
      const marketPrice = marketPrices[pos.collateralAddress];
      if (marketPrice && Number(pos.virtualPrice) > Number(marketPrice) && pos.state !== PositionState.CHALLENGED) {
        pos.state = PositionState.UNDERCOLLATERIZED;
      }
    });

    // Create and configure the table
    const table = createTable<PositionData>();
    if (sort) table.setSorting(sort);
    table.setData(positionsData);
    table.setRowSpacing(true);
    table.setColumns([
      {
        header: 'Created\nState',
        width: 18,
        align: 'left',
        format: (row) =>
          formatMultiLine(
            {
              primary: row.state === PositionState.PROPOSED ? formatCountdown(row.start) : formatDateTime(Number(row.created)),
              primaryColor: row.state === PositionState.PROPOSED ? colors.red : undefined,
              secondary: row.state,
              secondaryColor: [
                PositionState.PROPOSED,
                PositionState.CHALLENGED,
                PositionState.UNDERCOLLATERIZED,
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
              primary: formatAddress(row.position, true),
              primaryColor: row.original === row.position ? colors.yellow : undefined,
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
      {
        header: 'Liq. Price\nMark. Price',
        width: 15,
        align: 'right',
        format: function (row) {
          const isUndercollaterized = row.state === PositionState.UNDERCOLLATERIZED;
          return formatMultiLine(
            {
              primary: formatNumberWithSeparator(row.virtualPrice, 2),
              primaryColor: isUndercollaterized ? colors.red : undefined,
              secondary: formatNumberWithSeparator(marketPrices[row.collateralAddress], 2),
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
          const isChallenged = BigInt(row.challengedAmount.replace('.', '')) > 0n;
          return formatMultiLine(
            {
              primary: formatNumberWithSeparator(row.challengedAmount, 4),
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
