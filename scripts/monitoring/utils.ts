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

/**
 * Processes events to extract relevant data
 * @param events Array of events to process
 * @param color Optional color for event display
 * @returns Array of EventData objects
 */
export async function processEvents(events: any[], color?: string): Promise<EventData[]> {
  return await Promise.all(
    events.map(async (event) => {
      return {
        name: event.eventName,
        data: event.args,
        timestamp: (await event.getBlock()).timestamp,
        txHash: event.transactionHash,
        color,
      };
    }),
  );
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

export function printTitle(title: string) {
  console.log(`${colors.bold}${title}${colors.reset}`);
  console.log('='.repeat(title.length));
}