import { colors, createTable, formatCurrencyFromWei, formatMultiLine, Table } from '../utils/table';
import { formatHash } from '../utils/utils';
import { EventData } from './types';

/**
 * Utility class for time-related calculations
 * @class Time
 */
export class Time {
  static daysLeft(timestamp: number): number {
    const now = Math.floor(Date.now() / 1000);
    return Math.max(0, Math.floor((timestamp - now) / 86400));
  }

  static now: number = Math.floor(Date.now() / 1000);

  static get dayAgo(): number {
    return Time.now - 86400;
  }

  static get weekAgo(): number {
    return Time.now - 86400 * 7;
  }

  static get monthAgo(): number {
    return Time.now - 86400 * 30;
  }

  static get yearStart(): number {
    return new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
  }
}

// Block cache to avoid redundant RPC calls
const blockCache = new Map<number, { timestamp: number }>();

/**
 * Gets block data with caching to avoid redundant RPC calls
 * @param event Event with blockNumber
 * @returns Block timestamp
 */
async function getCachedBlockTimestamp(event: any): Promise<number> {
  const blockNumber = event.blockNumber;
  
  if (blockCache.has(blockNumber)) {
    return blockCache.get(blockNumber)!.timestamp;
  }
  
  // Add timeout protection for block lookups
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Block lookup timed out for block ${blockNumber}`)), 30000)
  );
  
  try {
    const block = await Promise.race([
      event.getBlock(),
      timeoutPromise
    ]);
    
    const blockData = { timestamp: block.timestamp };
    blockCache.set(blockNumber, blockData);
    return block.timestamp;
  } catch (error) {
    console.error(`Failed to get block ${blockNumber}, using current timestamp:`, error);
    // Fallback to current timestamp if block lookup fails
    const fallbackTimestamp = Math.floor(Date.now() / 1000);
    blockCache.set(blockNumber, { timestamp: fallbackTimestamp });
    return fallbackTimestamp;
  }
}

/**
 * Processes events to extract relevant data with optimized block lookups
 * @param events Array of events to process
 * @param color Optional color for event display
 * @returns Array of EventData objects
 */
export async function processEvents(events: any[], color?: string): Promise<EventData[]> {
  // Group events by block number to minimize RPC calls
  const eventsByBlock = new Map<number, any[]>();
  for (const event of events) {
    const blockNumber = event.blockNumber;
    if (!eventsByBlock.has(blockNumber)) {
      eventsByBlock.set(blockNumber, []);
    }
    eventsByBlock.get(blockNumber)!.push(event);
  }
  
  console.log(`📦 Processing ${events.length} events across ${eventsByBlock.size} unique blocks...`);
  
  // Process events with cached block lookups
  const processedEvents: EventData[] = [];
  
  for (const [blockNumber, blockEvents] of eventsByBlock) {
    try {
      // Get timestamp once per block
      const timestamp = await getCachedBlockTimestamp(blockEvents[0]);
      
      // Process all events in this block
      for (const event of blockEvents) {
        processedEvents.push({
          name: event.eventName,
          data: event.args,
          timestamp,
          txHash: event.transactionHash,
          color,
        });
      }
    } catch (error) {
      console.error(`Error processing block ${blockNumber}:`, error);
    }
  }
  
  return processedEvents;
}

type OperatorType = (a: bigint, b: bigint) => bigint;

export const Operator: Record<string, OperatorType> = {
  sum: (a: bigint, b: bigint) => a + b,
  max: (a: bigint, b: bigint) => (a > b ? a : b),
  min: (a: bigint, b: bigint) => (a < b ? a : b),
  count: (a: bigint, _) => a + 1n,
};

interface Metric {
  name: string;
  key: string;
  ops: OperatorType;
  valueFormatter?: (value: bigint) => string;
  filter?: (event: EventData) => boolean;
}

export interface MetricResult {
  value: {
    day: bigint;
    week: bigint;
    month: bigint;
    year: bigint;
  };
  count: {
    day: number;
    week: number;
    month: number;
    year: number;
  };
  last: EventData;
  valueFormatter: (value: bigint) => string;
}

export function aggregateData(events: EventData[], metrics: Metric[]): Record<string, MetricResult> {
  const result: Record<string, MetricResult> = {};

  for (const event of events) {
    for (const metric of metrics) {
      if (metric.filter && !metric.filter(event)) {
        continue;
      }

      if (!result[metric.name]) {
        result[metric.name] = {
          value: {
            day: 0n,
            week: 0n,
            month: 0n,
            year: 0n,
          },
          count: {
            day: 0,
            week: 0,
            month: 0,
            year: 0,
          },
          last: events[0],
          valueFormatter: metric.valueFormatter || formatCurrencyFromWei,
        };
      }

      const timestamp = event.timestamp;
      const value = event.data[metric.key] ?? 0; // 0 if undefined, e.g. for "event count" only

      if (timestamp > Time.dayAgo) {
        result[metric.name].value.day = metric.ops(result[metric.name].value.day, value);
        result[metric.name].count.day++;
      }
      if (timestamp > Time.weekAgo) {
        result[metric.name].value.week = metric.ops(result[metric.name].value.week, value);
        result[metric.name].count.week++;
      }
      if (timestamp > Time.monthAgo) {
        result[metric.name].value.month = metric.ops(result[metric.name].value.month, value);
        result[metric.name].count.month++;
      }
      if (timestamp > Time.yearStart) {
        result[metric.name].value.year = metric.ops(result[metric.name].value.year, value);
        result[metric.name].count.year++;
      }
    }
  }

  return result;
}

export function eventTrendDataToArray(
  eventTrendData: Record<string, MetricResult>,
): { name: string; data: MetricResult }[] {
  return Object.keys(eventTrendData).map((name) => ({
    name,
    data: eventTrendData[name],
  }));
}

export function createEventTrendsTable(name: string): Table<{ name: string; data: MetricResult }> {
  const eventTrendsTable = createTable<{ name: string; data: MetricResult }>();
  eventTrendsTable.setColumns([
    {
      header: `${name}\n${colors.dim}Last TX${colors.dim}`,
      width: 30,
      align: 'left',
      format: (row) =>
        formatMultiLine(
          {
            primary: row.name,
            secondary: formatHash(row.data.last.txHash, true, 'tx'),
          },
          20,
          'left',
        ),
    },
    {
      header: `Day\n${colors.dim}Count${colors.dim}`,
      width: 20,
      align: 'right',
      format: (row) =>
        formatMultiLine(
          {
            primary: row.data.valueFormatter(row.data.value.day),
            secondary: row.data.count.day.toString(),
          },
          20,
          'right',
        ),
    },
    {
      header: `Week\n${colors.dim}Count${colors.dim}`,
      width: 20,
      align: 'right',
      format: (row) =>
        formatMultiLine(
          {
            primary: row.data.valueFormatter(row.data.value.week),
            secondary: row.data.count.week.toString(),
          },
          20,
          'right',
        ),
    },
    {
      header: `Month\n${colors.dim}Count${colors.dim}`,
      width: 20,
      align: 'right',
      format: (row) =>
        formatMultiLine(
          {
            primary: row.data.valueFormatter(row.data.value.month),
            secondary: row.data.count.month.toString(),
          },
          20,
          'right',
        ),
    },
    {
      header: `Year\n${colors.dim}Count${colors.dim}`,
      width: 20,
      align: 'right',
      format: (row) =>
        formatMultiLine(
          {
            primary: row.data.valueFormatter(row.data.value.year),
            secondary: row.data.count.year.toString(),
          },
          20,
          'right',
        ),
    },
  ]);
  eventTrendsTable.showHeaderSeparator(true);
  eventTrendsTable.setColumnSeparator('  ');
  eventTrendsTable.setRowSpacing(true);
  return eventTrendsTable;
}