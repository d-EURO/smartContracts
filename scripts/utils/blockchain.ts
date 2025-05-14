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
  for (let i = 0; i < blockRanges.length; i += concurrencyLimit) {
    const currentBatch = blockRanges.slice(i, i + concurrencyLimit);
    
    console.log(
      `Processing batch ${Math.floor(i/concurrencyLimit) + 1}/${Math.ceil(blockRanges.length/concurrencyLimit)}, ` +
      `blocks: ${currentBatch[0].fromBlock}-${currentBatch[currentBatch.length-1].toBlock}`
    );
    
    const batchPromises = currentBatch.map(({ fromBlock, toBlock }) => {
      return contract.queryFilter(eventFilter, fromBlock, toBlock)
        .catch(error => {
          console.error(`Error querying blocks ${fromBlock}-${toBlock}:`, error);
          return [];
        });
    });
    
    const batchResults = await Promise.all(batchPromises);
    events = [...events, ...batchResults.flat()];
  }
  
  return events;
}