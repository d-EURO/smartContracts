import { task } from 'hardhat/config';
import { formatCurrency } from '../scripts/utils/table';
import { getMonitoringModule } from '../scripts/monitoring';
import { formatUnits } from 'ethers';
import { PositionState } from '../scripts/monitoring/types';

// npx hardhat monitor-tvl --network mainnet
task('monitor-tvl', 'Display total value locked (TVL) in the protocol')
  .setAction(async ({}, hre) => {
    console.log('Initializing monitoring module...');
    const monitoringModule = await getMonitoringModule(hre);
    const positionsData = await monitoringModule.getPositions();
    const bridgeStates = await monitoringModule.getBridgeStates();

    let totalPositionsValue = 0;
    const positions: PositionState[] = [];
    const openPositions = positionsData.filter(pos => !pos.isClosed);

    for (const position of openPositions) {
      if (position.marketPrice) {
        positions.push(position);
        totalPositionsValue += position.collateralValue ? position.collateralValue : 0;
      } 
    }

    let totalBridgeValue = 0;
    for (const bridge of bridgeStates) {
      const mintedAmount = Number(formatUnits(bridge.minted, 18)); 
      totalBridgeValue += mintedAmount;
    }

    // Calculate total TVL
    const totalTVL = totalPositionsValue + totalBridgeValue;

    // Print results
    console.log('\n=== TOTAL VALUE LOCKED (TVL) ===');
    console.log(`Positions Value: ${formatCurrency(totalPositionsValue, 2)} EUR`);
    console.log(`Bridge Value:    ${formatCurrency(totalBridgeValue, 2)} EUR`);
    console.log(`---------------------------------`);
    console.log(`TOTAL TVL:      ${formatCurrency(totalTVL, 2)} EUR`);
    
    console.log('\n=== POSITION DETAILS ===');
    console.log(`Total active positions: ${openPositions.length}`);
    console.log(`Positions with market prices: ${positions.length}`);
    console.log(`Positions without market prices: ${openPositions.length - positions.length}`);
    console.log(`---------------------------------`);
  });