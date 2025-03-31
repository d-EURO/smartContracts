import { task } from 'hardhat/config';

// Comprehensive monitoring task that runs all monitoring tasks in sequence
task('monitor-all', 'Run all dEuro monitoring tasks in sequence')
  .setAction(async ({}, hre) => {
    await hre.run('get-contracts');
    console.log('\n');
    await hre.run('monitor-deuro');
    console.log('\n');
    await hre.run('monitor-equity');
    console.log('\n');
    await hre.run('monitor-savings');
    console.log('\n');
    await hre.run('monitor-bridges');
    console.log('\n');
    await hre.run('monitor-positions');
    console.log('\n');
  });