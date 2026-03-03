import { ADDRESS } from '../exports/address.config';
import { task } from 'hardhat/config';

task('get-contracts', 'Get JuiceDollar Protocol Contract Addresses').setAction(
  async ({}, hre) => {
    const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
    const addresses = ADDRESS[chainId];
    if (!addresses) {
      console.error(`No addresses configured for chain ${chainId}`);
      return;
    }

    console.log(`Network:  ${hre.network.name} (chainId: ${chainId})`);
    console.log();

    const entries = Object.entries(addresses);
    const maxNameLen = Math.max(...entries.map(([name]) => name.length));

    for (const [name, address] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      if (address) {
        console.log(`  ${name.padEnd(maxNameLen)}  ${address}`);
      }
    }

    console.log();
  },
);
