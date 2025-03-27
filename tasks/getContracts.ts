import { getFullDeployment } from '../scripts/utils/deployments';
import { formatAddress } from '../scripts/utils/utils';
import { createTable, colors } from '../scripts/utils/table';
import { task } from 'hardhat/config';

task('get-contracts', 'Get Decentralized EURO Protocol Contract Addresses on Ethereum Mainnet').setAction(async ({}) => {
  const protocolDeployment = await getFullDeployment();

  console.log('> Decentralized EURO Protocol Contracts\n');
  console.log('Deployer:', formatAddress(protocolDeployment.deployer, true));
  console.log('Timestamp:', new Date(protocolDeployment.timestamp * 1000).toLocaleString());
  console.log('Network:', protocolDeployment.network);
  console.log();

  const contractsData = Object.entries(protocolDeployment.contracts).map(([contractName, contractData]) => {
    return {
      name: contractName,
      address: contractData.address,
      hyperlink: formatAddress(contractData.address, true),
    };
  });

  const table = createTable()
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
    .setColumnSeparator('  ');

  table.print();
  console.log();
});
