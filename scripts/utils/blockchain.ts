import { BaseContract } from 'ethers';

export interface BlockRange {
  fromBlock: number;
  toBlock: number;
}

/**
 * Queries events in batched, parallel fashion to handle provider block range limitations
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
  concurrencyLimit: number = 100,
): Promise<any[]> {
  const latestBlock = endBlock === 'latest' 
    ? await contract.runner?.provider?.getBlockNumber() 
    : endBlock;
    
  if (!latestBlock) {
    throw new Error('Could not determine latest block number');
  }
  
  const blockRanges: BlockRange[] = [];
  for (let fromBlock = startBlock; fromBlock <= latestBlock; fromBlock += chunkSize) {
    const toBlock = Math.min(fromBlock + chunkSize - 1, latestBlock);
    blockRanges.push({ fromBlock, toBlock });
  }

  let events: any[] = [];
  const totalBlocks = latestBlock - startBlock + 1;
  const eventName = eventFilter.fragment?.name || 'events';
  
  for (let i = 0; i < blockRanges.length; i += concurrencyLimit) {
    const currentBatch = blockRanges.slice(i, i + concurrencyLimit);

    // log w/ process.stdout.write to update the same line
    const processedBlocks = Math.min(currentBatch[currentBatch.length-1].toBlock - startBlock + 1, totalBlocks);
    const percentage = Math.floor((processedBlocks / totalBlocks) * 100);
    const filledSections = Math.floor((processedBlocks / totalBlocks) * 20);
    const progressBar = '█'.repeat(filledSections) + '='.repeat(20 - filledSections);
    process.stdout.write(`\r${eventName} events: |${progressBar}| ${processedBlocks}/${totalBlocks} blocks processed (${percentage}%)`);
    
    const batchPromises = currentBatch.map(({ fromBlock, toBlock }) => {
      return contract.queryFilter(eventFilter, fromBlock, toBlock)
        .catch(error => {
          console.error(`\nError querying blocks ${fromBlock}-${toBlock}:`, error);
          return [];
        });
    });
    
    const batchResults = await Promise.all(batchPromises);
    events = [...events, ...batchResults.flat()];
  }
  
  const completedBar = '█'.repeat(20);
  process.stdout.write(`\r${eventName} events: |${completedBar}| ${totalBlocks}/${totalBlocks} blocks processed (100%)\n`);
  
  return events;
}