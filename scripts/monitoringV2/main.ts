#!/usr/bin/env node
import { config } from 'dotenv';
import { ethers } from 'ethers';
import { MonitoringModule } from './index';

config({ path: '.env.monitoring' });

async function main() {
  const RPC_URL = process.env.RPC_URL;
  const BLOCKCHAIN_ID = parseInt(process.env.BLOCKCHAIN_ID || '1');
  const INTERVAL_MS = parseInt(process.env.MONITOR_INTERVAL_MS || '3000000'); // 5 minutes default
  const EVENTS_CACHE_TTL = parseInt(process.env.EVENTS_CACHE_TTL || '3600000'); // 1 hour default

  console.log(`Starting dEURO Monitoring V2`);
  console.log(`> RPC: ${RPC_URL}`);
  console.log(`> Chain ID: ${BLOCKCHAIN_ID}`);
  console.log(`> Interval: ${INTERVAL_MS}ms\n`);
  console.log(`> Events Cache TTL: ${EVENTS_CACHE_TTL}ms\n`);

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const monitoring = new MonitoringModule(provider, BLOCKCHAIN_ID, EVENTS_CACHE_TTL);

    // Monitoring cycle
    async function runMonitoringCycle() {
      try {
        const timestamp = new Date().toISOString();
        console.log(`\x1b[33m[${timestamp}] - Fetching system state...\x1b[0m`);
        
        const eventsData = await monitoring.getAllEvents();
        const [
          deuroState,
          equityState,
          depsState,
          savingsState,
          frontendState,
          positionsState,
          bridgeStates,
        ] = await Promise.all([
          monitoring.getDecentralizedEuroState(),
          monitoring.getEquityState(),
          monitoring.getDEPSWrapperState(),
          monitoring.getSavingsGatewayState(),
          monitoring.getFrontendGatewayState(),
          monitoring.getMintingHubState(eventsData.mintingHubPositionOpenedEvents),
          monitoring.getAllBridgeStates(),
        ]);

        // Log key metrics
        console.log(`> dEURO Supply: ${ethers.formatEther(deuroState.totalSupply)}`);
        console.log(`> Equity Price: ${ethers.formatEther(equityState.price)}`);
        console.log(`> Total Savings: ${ethers.formatEther(savingsState.totalSavings)}`);
        console.log(`> Active Positions: ${positionsState.positions.length}`);
        console.log(`> Bridge States: ${bridgeStates.length} bridges`);
        console.log(`> Events Cache: ${eventsData.lastEventFetch ? 'Fresh' : 'Stale'}\n`);

        // Export data as JSON (for consumption by other systems)
        const systemState = {
          timestamp,
          deuroState,
          equityState,
          depsState,
          savingsState,
          frontendState,
          positionsState,
          bridgeStates,
          eventsData,
        };

        // Optional: write to file or send to monitoring system
        console.log('\x1b[33mMonitoring cycle completed successfully.\x1b[0m');
        if (process.env.OUTPUT_FILE) {
          console.log(`\x1b[33mWriting system state to file...\x1b[0m`);
          const jsonString = JSON.stringify(
            systemState,
            (_key, value) => {
              return typeof value === 'bigint' ? value.toString() : value;
            },
            2,
          );
          await require('fs').promises.writeFile(process.env.OUTPUT_FILE, jsonString);
          console.log(`\x1b[32mSystem state written to ${process.env.OUTPUT_FILE}\x1b[0m`);
        }
      } catch (error) {
        console.error('\x1b[31mError during monitoring cycle:\x1b[0m', error);
      }
    }

    await runMonitoringCycle();

    // Run monitoring cycle every INTERVAL_MS milliseconds
    setInterval(runMonitoringCycle, INTERVAL_MS);
  } catch (error) {
    console.error('\x1b[31mFailed to initialize monitoring:\x1b[0m', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
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
