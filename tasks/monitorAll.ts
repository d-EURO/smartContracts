import { task } from 'hardhat/config';
import { colors } from '../scripts/utils/table';

// Comprehensive monitoring task that runs all monitoring tasks in sequence
task('monitor-all', 'Run all dEuro monitoring tasks in sequence')
  .setAction(async ({ riskLevel, positionLimit }, hre) => {
    console.log(`${colors.bold}======== dEuro Protocol Comprehensive Monitoring ========${colors.reset}\n`);
    
    console.log(`${colors.bold}Step 1: Core Protocol Metrics${colors.reset}`);
    await hre.run('get-contracts');
    console.log('\n');
    
    console.log(`${colors.bold}Step 2: Position Monitoring${colors.reset}`);
    await hre.run('monitor-positions', { riskLevel, limit: positionLimit });
    console.log('\n');
    
    console.log(`\n${colors.bold}======== Monitoring Complete ========${colors.reset}`);
  });