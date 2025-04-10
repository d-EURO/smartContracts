import { formatUnits } from 'ethers';
import { BigNumberish } from 'ethers/src.ts/utils';
import { HealthStatus } from '../monitoring/types';

// ANSI color codes
export const colors: Record<string, string> = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  grey: '\x1b[90m',
  red: '\x1b[31m',
  underline: '\x1b[4m',
};

export interface MultiLineCell {
  primary: string;
  secondary?: string;
  primaryColor?: string;
  secondaryColor?: string;
}

export interface TableColumn<T extends Record<string, any> = Record<string, any>> {
  header: string;
  width: number;
  align?: 'left' | 'right';
  visible?: boolean;
  format: (row: T) => string;
}

export interface TableConfig<T extends Record<string, any> = Record<string, any>> {
  columns: TableColumn<T>[];
  showHeader?: boolean;
  showHeaderSeparator?: boolean;
  columnSeparator?: string;
  rowSpacing?: boolean;
  sort?: {
    key: string;
    direction?: 'asc' | 'desc';
  };
  shouldDimRow?: (row: T) => boolean;
}

/**
 * Format a multi-line cell with primary and secondary values
 * @param cell The multi-line cell configuration
 * @param width Width of the cell for alignment
 * @param align Alignment of the cell content ('left' or 'right')
 * @returns Formatted string with ANSI escape codes for coloring
 */
export function formatMultiLine(cell: MultiLineCell, width: number = 20, align: 'left' | 'right' = 'left'): string {
  const primaryColor = cell.primaryColor || '';
  const secondaryColor = cell.secondaryColor || colors.dim;
  const primaryLine = padWithColors(cell.primary, width, align, primaryColor);

  if (!cell.secondary) {
    return primaryLine;
  } else {
    const secondaryLine = padWithColors(cell.secondary, width, align, secondaryColor);
    return `${primaryLine}\n${secondaryLine}`;
  }
}

export interface Table<T extends Record<string, any>> {
  addColumn(column: TableColumn<T>): Table<T>;
  setColumns(columns: TableColumn<T>[]): Table<T>;
  setData(data: T[]): Table<T>;
  setSorting(key: string, direction?: 'asc' | 'desc'): Table<T>;
  showHeader(show: boolean): Table<T>;
  showHeaderSeparator(show: boolean): Table<T>;
  setColumnSeparator(separator: string): Table<T>;
  setRowSpacing(spacing: boolean): Table<T>;
  setShouldDimRow(dimRowFn: (row: T) => boolean): Table<T>;
  print(): void;
}

export function createTable<T extends Record<string, any>>(): Table<T> {
  let tableData: T[] = [];
  let tableConfig: TableConfig<T> = { columns: [] };

  return {
    addColumn(column: TableColumn<T>) {
      tableConfig.columns.push(column);
      return this;
    },

    setColumns(columns: TableColumn<T>[]) {
      tableConfig.columns = columns;
      return this;
    },

    setData(data: T[]) {
      tableData = data;
      return this;
    },

    setSorting(key: string, direction: 'asc' | 'desc' = 'asc') {
      tableConfig.sort = { key, direction };
      return this;
    },

    showHeader(show: boolean) {
      tableConfig.showHeader = show;
      return this;
    },

    showHeaderSeparator(show: boolean) {
      tableConfig.showHeaderSeparator = show;
      return this;
    },

    setColumnSeparator(separator: string) {
      tableConfig.columnSeparator = separator;
      return this;
    },

    setRowSpacing(spacing: boolean) {
      tableConfig.rowSpacing = spacing;
      return this;
    },

    setShouldDimRow(dimRowFn: (row: T) => boolean) {
      tableConfig.shouldDimRow = dimRowFn;
      return this;
    },

    print(): void {
      printTable(tableData, tableConfig);
    },
  };
}

/**
 * Format and print a console table
 * @param data Array of data objects
 * @param config Table configuration
 */
export function printTable<T extends Record<string, any>>(data: T[], config: TableConfig<T>): void {
  const {
    columns: allColumns,
    showHeader = true,
    showHeaderSeparator = true,
    columnSeparator = '  ',
    rowSpacing = true,
    sort,
    shouldDimRow,
  } = config;
  const columns = allColumns.filter((col) => col.visible !== false);
  if (sort) {
    data = [...data].sort((a, b) => {
      const sortKey = sort.key;
      const aVal: string = a[sortKey].toString();
      const bVal: string = b[sortKey].toString();

      const isNumeric = /^\d*\.?\d*$/.test(aVal.toString());
      if (isNumeric) {
        const aValBint = BigInt(aVal.replace('.', ''));
        const bValBint = BigInt(bVal.replace('.', ''));
        return Number(bValBint - aValBint); // Descending order
      } else {
        return bVal.localeCompare(aVal); // Descending order
      }
    });
  }

  if (showHeader) {
    const hasMultiLineHeaders = columns.some((col) => col.header.includes('\n'));

    if (!hasMultiLineHeaders) {
      const headerParts = columns.map((col) => {
        return padWithColors(col.header, col.width, col.align, colors.bold);
      });

      console.log(headerParts.join(columnSeparator));
    } else {
      const headerValues = columns.map((col) => col.header.split('\n'));
      renderMultiLineContent(headerValues, columns, columnSeparator, (value, colIndex, _) =>
        padWithColors(value, columns[colIndex].width, columns[colIndex].align, colors.bold),
      );
    }
  }

  const totalWidth = columns.reduce((sum, col) => sum + col.width, (columns.length - 1) * columnSeparator.length);

  if (showHeaderSeparator) {
    console.log('-'.repeat(totalWidth));
  }

  data.forEach((row, index) => {
    const shouldDim = shouldDimRow && shouldDimRow(row);
    const formattedValues = columns.map((col) => {
      return col.format(row);
    });

    const hasMultiLine = formattedValues.some((val) => val.includes('\n'));
    if (!hasMultiLine) {
      const rowParts = formattedValues.map((value, i) => {
        return padWithColors(value, columns[i].width, columns[i].align, shouldDim ? colors.dim : undefined);
      });
      console.log(rowParts.join(columnSeparator));
    } else {
      const valueLines = formattedValues.map((val) => val.split('\n'));
      renderMultiLineContent(valueLines, columns, columnSeparator, (value, colIndex, _) => {
        return padWithColors(
          value,
          columns[colIndex].width,
          columns[colIndex].align,
          shouldDim ? colors.dim : undefined,
        );
      });
    }

    if (rowSpacing && index < data.length - 1) {
      console.log();
    }
  });
}

/// UTILITY FUNCTIONS

/**
 * Format a date value as a date and time string in European format (DD.MM.YYYY)
 * @param timestamp Unix timestamp in seconds
 * @returns Formatted date string
 */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

/**
 * Format a countdown timer based on a future timestamp
 * @param timestamp Unix timestamp in seconds
 * @returns Formatted countdown string (e.g. '5d 3h 12m')
 */
export function formatCountdown(
  timestamp: bigint | number,
  isDiff: boolean = false,
  onlyHours: boolean = false,
): string {
  let secondsLeft = Number(timestamp);
  if (!isDiff) secondsLeft -= Math.floor(Date.now() / 1000);
  if (secondsLeft <= 0) return 'Expired';

  if (onlyHours) {
    const hours = Math.floor(secondsLeft / 3600);
    return `${hours}h`;
  }

  const days = Math.floor(secondsLeft / 86400);
  const hours = Math.floor((secondsLeft % 86400) / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

/**
 * Format a numeric value with specific decimal places
 * @param value Numeric value
 * @param decimals Number of decimal places
 * @returns Formatted number string
 */
export function formatNumber(value: number | string, decimals: number = 2): string {
  return Number(value).toFixed(decimals);
}

/**
 * @param value Numeric value to format
 * @param decimals Number of decimal places
 * @returns Formatted number string with apostrophe as thousands separator
 */
export function formatCurrency(value: BigNumberish, decimals: number = 2): string {
  const num = Number(value).toFixed(decimals);
  const [integerPart, decimalPart] = num.split('.');
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return decimalPart ? `${formattedInteger}.${decimalPart}` : formattedInteger;
}

export function formatCurrencyFromWei(value: BigNumberish, precision: number = 2, decimals: BigNumberish = 18): string {
  const num = formatUnits(value, decimals);
  return formatCurrency(num, precision);
}

/**
 * @param str String to strip ANSI codes from
 * @returns String without ANSI codes
 */
function stripAnsi(str: string): string {
  // Strip regular ANSI color codes
  let result = str.replace(/\x1b\[[0-9;]*m/g, '');
  // Strip OSC 8 hyperlink sequences (for clickable links)
  result = result.replace(/\u001b\]8;;.*?\u0007(.*?)\u001b\]8;;\u0007/g, '$1');
  return result;
}

/**
 * Pad a string with spaces to a specific width and apply ANSI color codes
 * @param str String to pad
 * @param width Target width of the string
 * @param align Alignment of the string content ('left' or 'right')
 * @param color ANSI color code to apply to the string
 * @returns Padded string with ANSI color codes
 */
function padWithColors(str: string, width: number, align: 'left' | 'right' = 'left', color?: string): string {
  const coloredStr = color ? `${color}${str}${colors.reset}` : str;
  const visibleLength = stripAnsi(coloredStr).length;
  const paddingNeeded = width - visibleLength;
  if (paddingNeeded <= 0) return coloredStr;

  const padding = ' '.repeat(paddingNeeded);
  return align === 'right' ? padding + coloredStr : coloredStr + padding;
}

/**
 * Renders multiline content with proper alignment and formatting
 * @param values Array of values to render (one per line)
 * @param columns Column configurations for alignment and width
 * @param columnSeparator The separator to use between columns
 * @param colorFn Optional function to apply color formatting
 */
function renderMultiLineContent(
  values: string[][],
  columns: { width: number; align?: 'left' | 'right' }[],
  columnSeparator: string,
  colorFn?: (value: string, colIndex: number, lineIndex: number) => string,
): void {
  const maxLines = Math.max(...values.map((lines) => lines.length));

  for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
    const parts = columns.map((col, colIdx) => {
      const lines = values[colIdx];
      const value = lineIdx < lines.length ? lines[lineIdx] : '';
      const coloredValue = colorFn ? colorFn(value, colIdx, lineIdx) : value;
      return padWithColors(coloredValue, col.width, col.align);
    });

    console.log(parts.join(columnSeparator));
  }
}

export function healthStatusColor(status: HealthStatus | HealthStatus[]): string {
  let maxStatus = status;
  if (Array.isArray(status)) {
    maxStatus = maxSeverity(status);
  }

  switch (maxStatus) {
    case HealthStatus.WARNING:
      return colors.yellow;
    case HealthStatus.CRITICAL:
    case HealthStatus.EXPIRED:
      return colors.red;
    case HealthStatus.CLOSED:
      return colors.grey;
    default:
      return colors.green;
  }
}

export function maxSeverity(status: HealthStatus[]): HealthStatus {
  return status.reduce((max, current) => {
    if (current === HealthStatus.CRITICAL) return current;
    if (max === HealthStatus.CRITICAL) return max;
    if (current === HealthStatus.WARNING) return current;
    return max;
  });
}
