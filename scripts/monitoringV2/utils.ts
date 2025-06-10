import { Contract } from 'ethers';
import { batchedEventQuery } from '../utils/blockchain';
import monitorConfig from '../utils/monitorConfig';
import { BaseEvent } from './dto';

/**
 * Shared utility for fetching and processing contract events
 * @param contract The contract instance, e.g. new ethers.Contract(address, abi, provider)
 * @param eventFilter The event filter to apply, e.g. contract.filters.Transfer()
 * @returns Processed events sorted by timestamp (newest first)
 */
export async function fetchEvents<T extends BaseEvent>(contract: Contract, eventFilter: any): Promise<T[]> {
  const events = await batchedEventQuery(contract, eventFilter, monitorConfig.deploymentBlock);
  const processedEvents: T[] = [];

  for (const event of events) {
    const block = await event.getBlock();
    processedEvents.push({
      ...event.args,
      txHash: event.transactionHash,
      timestamp: block.timestamp,
    } as T);
  }

  return processedEvents.sort((a, b) => b.timestamp - a.timestamp);
}