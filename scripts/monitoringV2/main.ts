#!/usr/bin/env node
import { config } from 'dotenv';
import { ethers } from 'ethers';
import { MonitoringModule } from './monitoring';
import { getDeploymentBlock, validateConfiguration } from './utils';
import { db } from './database/client';

config({ path: '.env.monitoring' });

async function main() {
  validateConfiguration();
  const RPC_URL = process.env.RPC_URL;
  const BLOCKCHAIN_ID = parseInt(process.env.BLOCKCHAIN_ID || '1');
  const INTERVAL_MS = parseInt(process.env.MONITOR_INTERVAL_MS || '300000'); // 5 minutes default

  console.log(`Starting dEURO Monitoring V2`);
  console.log(`> RPC: ${RPC_URL}`);
  console.log(`> Chain ID: ${BLOCKCHAIN_ID}`);
  console.log(`> Monitoring Interval: ${INTERVAL_MS}ms\n`);

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const monitoring = new MonitoringModule(provider, BLOCKCHAIN_ID);

    async function runMonitoringCycle() {
      try {
        const timestamp = new Date().toISOString();
        const currentBlock = await provider.getBlockNumber();
        const lastProcessedBlock = await db.getLastProcessedBlock();
        const fromBlock = lastProcessedBlock ? lastProcessedBlock + 1 : getDeploymentBlock();

        if (fromBlock <= currentBlock) {
          console.log(
            `\x1b[33m[${timestamp}] - Fetching system state from block ${fromBlock} to ${currentBlock}\x1b[0m`,
          );
          const { mintingHubPositionOpenedEvents } = await monitoring.getSystemEvents(fromBlock, currentBlock);
          await monitoring.getSystemState(mintingHubPositionOpenedEvents);
        } else {
          console.log(`\x1b[33m[${timestamp}] - No new blocks to process (${fromBlock}/${currentBlock})\x1b[0m`);
        }
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
