#!/usr/bin/env node
import { config } from 'dotenv';
import { ethers } from 'ethers';
import { MonitoringModule } from './index';

config({ path: '.env.monitoring' });

async function main() {
  const RPC_URL = process.env.RPC_URL;
  const BLOCKCHAIN_ID = parseInt(process.env.BLOCKCHAIN_ID || '1');
  const INTERVAL_MS = parseInt(process.env.MONITOR_INTERVAL_MS || '300000'); // 5 minutes default

  console.log(`Starting dEURO Monitoring V2`);
  console.log(`> RPC: ${RPC_URL}`);
  console.log(`> Chain ID: ${BLOCKCHAIN_ID}`);
  console.log(`> Interval: ${INTERVAL_MS}ms\n`);

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const monitoring = new MonitoringModule(provider, BLOCKCHAIN_ID);

    // Monitoring cycle
    async function runMonitoringCycle() {
      try {
        const timestamp = new Date().toISOString();
        console.log(`\x1b[33m[${timestamp}] - Fetching system state...\x1b[0m`);

        const eventsData = await monitoring.getSystemEvents();
        const systemState = await monitoring.getSystemState(eventsData.mintingHubPositionOpenedEvents);
        
        // Destructure for logging
        const {
          deuroState,
          equityState,
          depsState,
          savingsState,
          frontendState,
          mintingHubState,
          positionsState,
          challengesState,
          collateralState,
          bridgeStates,
        } = systemState;

        // Log key metrics
        console.log(`> dEURO Supply: ${ethers.formatEther(deuroState.totalSupply)}`);
        console.log(`> Equity Price: ${ethers.formatEther(equityState.price)}`);
        console.log(`> Total Savings: ${ethers.formatEther(savingsState.totalSavings)}`);
        console.log(`> Active Positions: ${positionsState.filter((p) => !p.isClosed).length}`);
        console.log(`> Active Challenges: ${challengesState.length}`);
        console.log(`> Bridge States: ${bridgeStates.length} bridges`);
        console.log(`> Event Processing: Complete\n`);

        // Export data as JSON (for consumption by other systems)
        // const systemState = {
        //   timestamp,
        //   deuroState,
        //   equityState,
        //   depsState,
        //   savingsState,
        //   frontendState,
        //   mintingHubState,
        //   positionsState,
        //   challengesState,
        //   collateralState,
        //   bridgeStates,
        //   eventsData,
        // };

        // TODO: Remove this when monitoring is stable
        // Write to file or send to monitoring system
        // console.log('\x1b[33mMonitoring cycle completed successfully.\x1b[0m');
        // if (process.env.OUTPUT_FILE) {
        //   console.log(`\x1b[33mWriting system state to file...\x1b[0m`);
        //   const jsonString = JSON.stringify(
        //     systemState,
        //     (_key, value) => {
        //       return typeof value === 'bigint' ? value.toString() : value;
        //     },
        //     2,
        //   );
        //   await require('fs').promises.writeFile(process.env.OUTPUT_FILE, jsonString);
        //   console.log(`\x1b[32mSystem state written to ${process.env.OUTPUT_FILE}\x1b[0m`);
        // }
      } catch (error) {
        console.error('\x1b[31mError during monitoring cycle:\x1b[0m', error);
      }
    }

    await runMonitoringCycle();
    setInterval(runMonitoringCycle, INTERVAL_MS);
  } catch (error) {
    console.error('\x1b[31mFailed to initialize monitoring:\x1b[0m', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.log('\x1b[33m\nShutting down monitoring...\x1b[0m');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\x1b[33m\nReceived SIGTERM, shutting down...\x1b[0m');
  process.exit(0);
});

if (require.main === module) {
  main().catch(console.error);
}
