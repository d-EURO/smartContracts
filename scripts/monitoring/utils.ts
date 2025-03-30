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

type OperatorType = (a: number, b: number) => number;

export const Operator: Record<string, OperatorType> = {
  sum: (a: number, b: number) => a + b,
  max: (a: number, b: number) => Math.max(a, b),
  min: (a: number, b: number) => Math.min(a, b),
  count: (a: number, _) => a + 1,
};

interface Metric {
  name: string;
  key: string;
  ops: OperatorType;
}

export interface MetricResult {
  value: {
    day: number;
    week: number;
    month: number;
    year: number;
  };
  count: {
    day: number;
    week: number;
    month: number;
    year: number;
  };
}

export function aggregateData(events: EventData[], metrics: Metric[]): Record<string, MetricResult> {
  const result: Record<string, MetricResult> = {};

  for (const event of events) {
    for (const metric of metrics) {
      if (!result[metric.name]) {
        result[metric.name] = {
          value: {
            day: 0,
            week: 0,
            month: 0,
            year: 0,
          },
          count: {
            day: 0,
            week: 0,
            month: 0,
            year: 0,
          },
        };
      }

      const timestamp = event.timestamp;
      const value = event.data[metric.key] ?? 0; // 0 if undefined, e.g. for event count only

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
