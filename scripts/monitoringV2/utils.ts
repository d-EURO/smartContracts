import { Contract } from 'ethers';
import { batchedEventQuery } from './blockchain';
import { BaseEvent } from './dto';
import { config } from 'dotenv';

// Load environment configuration
config({ path: '.env.monitoring' });

const DEPLOYMENT_BLOCK = (() => {
  const deploymentBlock = process.env.DEPLOYMENT_BLOCK;
  if (!deploymentBlock) {
    console.error('DEPLOYMENT_BLOCK environment variable is required');
    process.exit(1);
  }
  const parsed = parseInt(deploymentBlock);
  if (isNaN(parsed) || parsed <= 0) {
    console.error('DEPLOYMENT_BLOCK must be a valid positive block number');
    process.exit(1);
  }
  return parsed;
})();

// LRU Block Cache with size limit to prevent memory leaks
class LRUBlockCache {
  private cache = new Map<number, any>();
  private readonly maxSize: number;

  constructor(maxSize: number = 10000) {
    // Default: cache up to 10k blocks
    this.maxSize = maxSize;
  }

  get(blockNumber: number): any {
    const value = this.cache.get(blockNumber);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(blockNumber);
      this.cache.set(blockNumber, value);
    }
    return value;
  }

  set(blockNumber: number, block: any): void {
    // Remove if already exists to update position
    if (this.cache.has(blockNumber)) {
      this.cache.delete(blockNumber);
    }
    // Remove oldest if at capacity
    else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(blockNumber, block);
  }

  has(blockNumber: number): boolean {
    return this.cache.has(blockNumber);
  }

  size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

const blockCache = new LRUBlockCache();

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
    newBlocks.forEach((block) => {
      if (block && block.number !== undefined) {
        blockCache.set(block.number, block);
      }
    });
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

export function getDeploymentBlock(): number {
  return DEPLOYMENT_BLOCK;
}

/**
 * Validates required environment variables and their formats
 * @throws Error if any required configuration is missing or invalid
 */
export function validateConfiguration(): void {
  try {
    mustBeValidUrl('RPC_URL', mustBePresent('RPC_URL', process.env.RPC_URL));
    mustBePositiveInt('BLOCKCHAIN_ID', mustBePresent('BLOCKCHAIN_ID', process.env.BLOCKCHAIN_ID));
    mustBePositiveInt('DEPLOYMENT_BLOCK', mustBePresent('DEPLOYMENT_BLOCK', process.env.DEPLOYMENT_BLOCK));

    const hasConnectionString = !!process.env.DATABASE_URL;
    const hasIndividualParams = !!(
      process.env.DB_HOST &&
      process.env.DB_PORT &&
      process.env.DB_NAME &&
      process.env.DB_USER
    );

    if (!hasConnectionString && !hasIndividualParams) {
      throw new Error('Either DATABASE_URL or all of (DB_HOST, DB_PORT, DB_NAME, DB_USER) must be provided');
    }

    if (process.env.DB_PORT) mustBePositiveInt('DB_PORT', process.env.DB_PORT, 1, 65535);
    if (process.env.MONITOR_INTERVAL_MS) {
      mustBePositiveInt('MONITOR_INTERVAL_MS', process.env.MONITOR_INTERVAL_MS, 10000);
    }
    if (process.env.PG_MAX_CLIENTS) {
      mustBePositiveInt('PG_MAX_CLIENTS', process.env.PG_MAX_CLIENTS, 1, 100);
    }

    console.log('\x1b[32mConfiguration validation passed\x1b[0m');
  } catch (err: any) {
    console.error('\x1b[31mConfiguration validation failed:\x1b[0m', err.message);
    console.error('\x1b[33mPlease check .env.monitoring.example for reference\x1b[0m');
    process.exit(1);
  }
}

function mustBePresent(name: string, value?: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function mustBePositiveInt(name: string, raw: string, min = 1, max?: number): number {
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < min || (max !== undefined && n > max)) {
    throw new Error(`${name} must be an integer${max ? ` between ${min} and ${max}` : ` ≥ ${min}`}`);
  }
  return n;
}

function mustBeValidUrl(name: string, urlString: string): string {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`${name} must be a valid HTTP/HTTPS URL`);
    }
    return urlString;
  } catch {
    throw new Error(`${name} must be a valid HTTP/HTTPS URL`);
  }
}
