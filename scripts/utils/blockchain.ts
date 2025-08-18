import { BaseContract } from 'ethers';

export interface BlockRange {
  fromBlock: number;
  toBlock: number;
}

// Event Queue Singleton for managing event queries
class EventQueryQueue {
  private static instance: EventQueryQueue;
  private queue: Array<() => Promise<any>> = [];
  private running = false;
  
  private constructor() {}
  
  public static getInstance(): EventQueryQueue {
    if (!EventQueryQueue.instance) {
      EventQueryQueue.instance = new EventQueryQueue();
    }
    return EventQueryQueue.instance;
  }
  
  public async enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Add task to queue
      this.queue.push(async () => {
        try {
          const result = await task();
          resolve(result);
          return result;
        } catch (error) {
          reject(error);
          throw error;
        }
      });
      
      // Process queue if not already running
      this.processQueue();
    });
  }
  
  private async processQueue(): Promise<void> {
    if (this.running || this.queue.length === 0) return;
    
    this.running = true;
    
    try {
      while (this.queue.length > 0) {
        const task = this.queue.shift()!;
        await task();
      }
    } finally {
      this.running = false;
    }
  }
}

/**
 * Display a progress bar for block processing
 * @param eventName Name of the event being processed
 * @param processedBlocks Number of blocks processed so far
 * @param totalBlocks Total number of blocks to process
 * @param complete Whether this is the final (100%) update
 */
export function displayBlockProgress(
  eventName: string,
  processedBlocks: number,
  totalBlocks: number,
  complete: boolean = false
): void {
  const percentage = Math.floor((processedBlocks / totalBlocks) * 100);
  const filledSections = Math.floor((processedBlocks / totalBlocks) * 20);
  const progressBar = complete 
    ? '█'.repeat(20) 
    : '█'.repeat(filledSections) + '='.repeat(20 - filledSections);
  
  process.stdout.write(`\r${eventName} events: |${progressBar}| ${processedBlocks}/${totalBlocks} blocks processed (${percentage}%)`);
  
  if (complete) {
    process.stdout.write('\n');
  }
}

/**
 * Sleep function for the retry mechanism
 * @param ms Milliseconds to sleep
 * @returns Promise that resolves after ms milliseconds
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Creates a timeout promise that rejects after the specified time
 * @param ms Timeout in milliseconds
 * @returns Promise that rejects with timeout error
 */
const createTimeout = (ms: number) => 
  new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
  );

/**
 * Executes a promise with timeout and retry logic
 * @param fn Function that returns a promise
 * @param maxRetries Maximum number of retry attempts
 * @param retryDelay Base delay between retries in ms (will increase with backoff)
 * @param timeoutMs Timeout for individual attempts in ms
 * @returns Promise result
 */
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  retryDelay: number = 2000,
  timeoutMs: number = 30000 // 30 second timeout for RPC calls
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Race between the function call and timeout
      return await Promise.race([
        fn(),
        createTimeout(timeoutMs)
      ]);
    } catch (error: any) {
      lastError = error;
      
      if (attempt < maxRetries) {
        const delay = retryDelay * Math.pow(1.5, attempt); // Exponential backoff
        const errorMsg = error.message?.includes('timed out') ? 'RPC timeout' : error.message;
        console.log(`\nRetrying operation (attempt ${attempt + 1}/${maxRetries}) after ${errorMsg}, waiting ${Math.round(delay/1000)}s...`);
        await sleep(delay);
      }
    }
  }
  
  throw lastError;
}

/**
 * Helper function to process a single event query
 */
async function processSingleEventQuery<T extends BaseContract>(
  contract: T,
  eventFilter: any,
  startBlock: number,
  endBlock: number,
  chunkSize: number,
  concurrencyLimit: number
): Promise<any[]> {
  const blockRanges: BlockRange[] = [];
  for (let fromBlock = startBlock; fromBlock <= endBlock; fromBlock += chunkSize) {
    const toBlock = Math.min(fromBlock + chunkSize - 1, endBlock);
    blockRanges.push({ fromBlock, toBlock });
  }

  let events: any[] = [];
  const totalBlocks = endBlock - startBlock + 1;
  const eventName = eventFilter.fragment?.name || 'events';
  
  for (let i = 0; i < blockRanges.length; i += concurrencyLimit) {
    const currentBatch = blockRanges.slice(i, i + concurrencyLimit);

    const processedBlocks = Math.min(currentBatch[currentBatch.length-1].toBlock - startBlock + 1, totalBlocks);
    displayBlockProgress(eventName, processedBlocks, totalBlocks);
    
    const batchPromises = currentBatch.map(({ fromBlock, toBlock }) => {
      return executeWithRetry(
        () => contract.queryFilter(eventFilter, fromBlock, toBlock),
        3, // Max 3 retries per query
        2000, // Start with 2s delay, then exponential backoff
        30000 // 30s timeout for RPC calls
      ).catch(error => {
        console.error(`\nError querying blocks ${fromBlock}-${toBlock} after multiple retries:`, error);
        return []; // Return empty array to continue execution
      });
    });
    
    // If we're hitting many errors, slow down the concurrent requests
    try {
      const batchResults = await Promise.all(batchPromises);
      events = [...events, ...batchResults.flat()];
    } catch (error) {
      console.error('\nError processing batch, reducing concurrency limit and retrying...');
      
      // Process the failed batch with reduced concurrency
      const reducedConcurrency = Math.max(1, Math.floor(concurrencyLimit / 2));
      const results = await processRangesWithReducedConcurrency(
        contract, eventFilter, currentBatch, reducedConcurrency
      );
      events = [...events, ...results];
    }
  }
  
  displayBlockProgress(eventName, totalBlocks, totalBlocks, true);
  
  return events;
}

/**
 * Process a set of block ranges with reduced concurrency when errors occur
 */
async function processRangesWithReducedConcurrency<T extends BaseContract>(
  contract: T,
  eventFilter: any,
  ranges: BlockRange[],
  concurrencyLimit: number
): Promise<any[]> {
  let results: any[] = [];
  
  // Process in smaller batches
  for (let i = 0; i < ranges.length; i += concurrencyLimit) {
    const batch = ranges.slice(i, i + concurrencyLimit);
    
    const batchPromises = batch.map(({ fromBlock, toBlock }) => {
      return executeWithRetry(
        () => contract.queryFilter(eventFilter, fromBlock, toBlock),
        5, // More retries for the problematic ranges
        3000, // Longer initial delay
        30000 // 30s timeout for RPC calls
      ).catch(error => {
        console.error(`\nError querying blocks ${fromBlock}-${toBlock} after multiple retries:`, error);
        return []; // Return empty array to continue execution
      });
    });
    
    // Wait for each promise to complete and add a delay between them
    const batchResults = await Promise.all(batchPromises);
    results = [...results, ...batchResults.flat()];
    
    // Add a delay between batches to avoid overwhelming the provider
    if (i + concurrencyLimit < ranges.length) {
      await sleep(2000);
    }
  }
  
  return results;
}

/**
 * Queries events in batched, parallel fashion to handle provider block range limitations
 * Uses a queue to ensure only one event type is queried at a time for clean console output
 * @param contract Contract to query events from
 * @param eventFilter Event filter to use for querying (from contract.filters)
 * @param startBlock First block to query from
 * @param endBlock Last block to query to (or 'latest')
 * @param chunkSize Size of block chunks to query (usually 500 for most providers)
 * @param concurrencyLimit Maximum number of parallel queries to make
 * @returns Array of events matching the filter
 */
export async function batchedEventQuery<T extends BaseContract>(
  contract: T,
  eventFilter: any,
  startBlock: number,
  endBlock: number | 'latest' = 'latest',
  chunkSize: number = 500,
  concurrencyLimit: number = 30, // Reduced default concurrency to avoid overwhelming the provider
): Promise<any[]> {
  // Get the latest block number with retry logic
  const getLatestBlock = async (): Promise<number> => {
    try {
      return await executeWithRetry(async () => {
        const blockNum = await contract.runner?.provider?.getBlockNumber();
        if (!blockNum && blockNum !== 0) {
          throw new Error('Could not determine latest block number');
        }
        return blockNum;
      }, 3, 2000, 15000); // 3 retries, 2s delay, 15s timeout for block number query
    } catch (error) {
      console.error('Failed to get latest block number:', error);
      throw error;
    }
  };

  const latestBlock = endBlock === 'latest' 
    ? await getLatestBlock()
    : endBlock;
  
  // Queue the event query to ensure only one runs at a time
  const queue = EventQueryQueue.getInstance();
  return queue.enqueue(() => processSingleEventQuery(
    contract,
    eventFilter,
    startBlock,
    latestBlock,
    chunkSize,
    concurrencyLimit
  ));
}