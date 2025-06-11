import { Contract } from 'ethers';
import { batchedEventQuery } from '../utils/blockchain';
import { BaseEvent } from './dto';
import { config } from 'dotenv';

config({ path: '.env.monitoring' });

const DEPLOYMENT_BLOCK = parseInt(process.env.DEPLOYMENT_BLOCK || 'MISSING_DEPLOYMENT_BLOCK');

const blockCache = new Map<number, any>();

/**
 * Shared utility for fetching and processing contract events over a specific block range
 * @param contract The contract instance, e.g. new ethers.Contract(address, abi, provider)
 * @param eventFilter The event filter to apply, e.g. contract.filters.Transfer()
 * @param fromBlock Starting block number (inclusive)
 * @param toBlock Ending block number (inclusive), defaults to 'latest'
 * @returns Processed events sorted by timestamp (newest first)
 */
export async function fetchEvents<T extends BaseEvent>(
  contract: Contract,
  eventFilter: any,
  fromBlock: number,
  toBlock: number | 'latest' = 'latest',
): Promise<T[]> {
  const events = await batchedEventQuery(contract, eventFilter, fromBlock, toBlock);
  if (events.length === 0) return [];

  // Fetch uncached blocks in parallel
  const uniqueBlockNumbers = [...new Set(events.map((e) => e.blockNumber))];
  const missingBlocks = uniqueBlockNumbers.filter((blockNum) => !blockCache.has(blockNum));
  if (missingBlocks.length > 0) {
    const newBlocks = await Promise.all(missingBlocks.map((blockNum) => events[0].provider.getBlock(blockNum)));
    newBlocks.forEach((block) => blockCache.set(block.number, block));
  }

  // Map event arguments to a structured format
  const processedEvents: T[] = [];
  for (const event of events) {
    const block = blockCache.get(event.blockNumber)!;
    const eventData: Record<string, any> = {};
    if (event.fragment) {
      event.fragment.inputs.forEach((input: any, index: number) => {
        eventData[input.name] = event.args[index];
      });
    } else {
      Object.assign(eventData, event.args);
    }

    processedEvents.push({
      ...eventData,
      txHash: event.transactionHash,
      timestamp: block.timestamp,
      logIndex: event.index,
    } as T);
  }

  return processedEvents.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Merges new events with existing events, removing duplicates and maintaining sort order
 * @param existingEvents Currently cached events
 * @param newEvents Newly fetched events
 * @returns Merged and deduplicated events sorted by timestamp (newest first)
 */
export function mergeEvents<T extends BaseEvent>(existingEvents: T[], newEvents: T[]): T[] {
  const eventMap = new Map<string, T>();
  for (const event of existingEvents) eventMap.set(`${event.txHash}-${event.logIndex || 0}`, event);
  for (const event of newEvents) eventMap.set(`${event.txHash}-${event.logIndex || 0}`, event);
  return Array.from(eventMap.values()).sort((a, b) => b.timestamp - a.timestamp);
}

export function getDeploymentBlock(): number {
  return DEPLOYMENT_BLOCK;
}
