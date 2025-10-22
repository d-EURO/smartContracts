import { getFullDeployment } from '../scripts/utils/deployments';
import { formatHash } from '../scripts/utils/utils';
import { createTable, colors } from '../scripts/utils/table';
import { task } from 'hardhat/config';

interface ContractData {
  name: string;
  address: string;
  hyperlink: string;
}

task('get-contracts', 'Get JuiceDollar Protocol Contract Addresses on Citrea').setAction(
  async ({}) => {
    const protocolDeployment = getFullDeployment();

    console.log(`Network:     ${protocolDeployment.network}`);
    console.log(`Deployer:    ${formatHash(protocolDeployment.deployer, true, 'address', false)}`);
    console.log(`Timestamp:   ${new Date(protocolDeployment.timestamp * 1000).toLocaleString('de-DE')}`);
    console.log();

    const contractsData: ContractData[] = Object.entries(protocolDeployment.contracts).map(
      ([contractName, contractData]) => {
        return {
          name: contractName,
          address: contractData.address,
          hyperlink: formatHash(contractData.address, true, 'address', false),
        };
      },
    );

    const table = createTable<ContractData>()
      .setColumns([
        {
          header: 'Contract Name',
          width: 30,
          align: 'left',
          format: (row) => `${colors.bold}${row.name}${colors.reset}`,
        },
        {
          header: 'Address',
          width: 15,
          align: 'left',
          format: (row) => row.hyperlink,
        },
      ])
      .setData(contractsData)
      .setSorting('name', 'asc')
      .showHeaderSeparator(true)
      .setRowSpacing(false)
      .setColumnSeparator('  ');

    table.print();
    console.log();
  },
);
