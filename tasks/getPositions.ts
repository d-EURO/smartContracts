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
import { getTokenPrices } from '../scripts/utils/coingecko';

interface PositionData {
  created: number;
  position: string;
  original: string;
  owner: string;
  collateralAddress: string;
  collateral: string;
  price: string;
  collateralBalance: string;
  collateralValue: string;
  debt: string;
  utilization: bigint;
  expiration: bigint;
  virtualPrice: string;
  isClosed: boolean;
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
    const WFPS = '0x5052D3Cc819f53116641e89b96Ff4cD1EE80B182'.toLowerCase();
    const DEPS = '0x103747924E74708139a9400e4Ab4BEA79FFFA380'.toLowerCase();
    let priceWFPS: string = '-';
    let priceDEPS: string = '-';
    async function getPricePS(collateralAddress: string): Promise<string> {
      const wrapper = await hre.ethers.getContractAt('ERC20Wrapper', collateralAddress);
      const native = await hre.ethers.getContractAt('Equity', await wrapper.underlying());
      return formatUnits(await native.price(), await native.decimals());
    }

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
          const virtualPrice = await position.virtualPrice();
          const debt = await position.getDebt();
          const collateralBalance = await collateral.balanceOf(positionAddress);
          const collateralDecimals = await collateral.decimals();
          const collateralSymbol = await collateral.symbol();
          const collateralAddress = await collateral.getAddress();
          const collateralValue = (collateralBalance * price) / floatToDec18(1);
          const collateralUtilization = collateralValue > 0 ? (debt * 100n) / collateralValue : 100n;
          const expiration = await position.expiration();
          const isClosed = await position.isClosed();

          positionsData.push({
            created,
            position: positionAddress,
            original: original,
            owner: owner,
            collateralAddress: collateralAddress.toLowerCase(),
            collateral: collateralSymbol,
            price: formatUnits(price, 36n - collateralDecimals),
            collateralBalance: formatUnits(collateralBalance, collateralDecimals),
            collateralValue: formatEther(collateralValue),
            debt: formatEther(debt),
            utilization: collateralUtilization,
            expiration: expiration,
            virtualPrice: formatUnits(virtualPrice, 36n - collateralDecimals),
            isClosed,
          });

          // Coingecko doesn't have WFPS or DEPS prices
          if (collateralAddress.toLowerCase() === WFPS) priceWFPS = await getPricePS(WFPS);
          if (collateralAddress.toLowerCase() === DEPS) priceDEPS = await getPricePS(DEPS);
        } catch (error) {
          console.error(`Error processing position ${event.args.position}:`, error);
        }
      }),
    );

    // Get collateral prices
    const collateralAddresses = Array.from(new Set(positionsData.map((position) => position.collateralAddress)));
    const collateralPrices = await getTokenPrices(collateralAddresses);
    if (collateralAddresses.includes(WFPS)) collateralPrices[WFPS] = priceWFPS;
    if (collateralAddresses.includes(DEPS)) collateralPrices[DEPS] = priceDEPS;

    // Create and configure the table
    const table = createTable<PositionData>();
    if (sort) table.setSorting(sort);
    table.setData(positionsData);
    table.setRowSpacing(true);
    table.setColumns([
      {
        header: 'Created\nExpiry',
        width: 18,
        align: 'left',
        format: (row) =>
          formatMultiLine(
            {
              primary: formatDateTime(row.created),
              secondary: row.isClosed ? 'CLOSED' : formatCountdown(row.expiration),
              secondaryColor: row.isClosed ? colors.red : colors.dim,
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
      {
        header: 'Virt. Price\nMark. Price',
        width: 15,
        align: 'right',
        format: function (row) {
          const marketPrice = collateralPrices[row.collateralAddress];
          const isUndercollateralized = row.virtualPrice > marketPrice;
          return formatMultiLine(
            {
              primary: formatNumberWithSeparator(row.virtualPrice, 2),
              primaryColor: isUndercollateralized ? colors.red : undefined,
              secondary: formatNumberWithSeparator(marketPrice, 2),
              secondaryColor: isUndercollateralized ? colors.red : undefined,
            },
            15,
            'right',
          );
        },
      },
    ]);

    table.print();
  });
