// ANSI color codes
export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  grey: '\x1b[90m',
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
  color?: string;
  visible?: boolean;
  format: (row: T) => string;
}

export interface TableConfig<T extends Record<string, any> = Record<string, any>> {
  columns: TableColumn<T>[];
  showHeader?: boolean;
  showHeaderSeparator?: boolean;
  columnSeparator?: string;
  sort?: {
    key: string;
    direction?: 'asc' | 'desc';
  };
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

export function createTable<T extends Record<string, any>>() {
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
  const { columns: allColumns, showHeader = true, showHeaderSeparator = true, columnSeparator = '  ', sort } = config;
  const columns = allColumns.filter((col) => col.visible !== false);
  if (sort) {
    data = [...data].sort((a, b) => {
      const sortKey = sort.key.toLowerCase();
      const aVal = a[sort.key];
      const bVal = b[sort.key];

      // bigint
      if (typeof aVal === 'bigint' && typeof bVal === 'bigint') {
        return Number(bVal - aVal); // Descending order
      }

      // numeric strings
      if (
        typeof aVal === 'string' &&
        typeof bVal === 'string' &&
        !isNaN(parseFloat(aVal)) &&
        !isNaN(parseFloat(bVal))
      ) {
        return parseFloat(bVal) - parseFloat(aVal); // Descending order
      }

      // timestamps
      if (sortKey === 'created') {
        return Number(bVal) - Number(aVal); // Descending order
      }

      // strings
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return bVal.localeCompare(aVal); // Descending order
      }

      return 0;
    });
  }

  if (showHeader) {
    const hasMultiLineHeaders = columns.some((col) => col.header.includes('\n'));

    if (!hasMultiLineHeaders) {
      const headerParts = columns.map((col) => {
        const content = col.header;
        return padWithColors(content, col.width, col.align, colors.bold);
      });

      console.log(headerParts.join(columnSeparator));
    } else {
      const headerLines = columns.map((col) => col.header.split('\n'));
      const maxLines = Math.max(...headerLines.map((lines) => lines.length));

      for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
        const headerParts = columns.map((col, colIdx) => {
          const lines = headerLines[colIdx];
          const lineContent = lineIdx < lines.length ? lines[lineIdx] : '';

          return padWithColors(lineContent, col.width, col.align, colors.bold);
        });

        console.log(headerParts.join(columnSeparator));
      }
    }
  }

  const totalWidth = columns.reduce((sum, col) => sum + col.width, (columns.length - 1) * columnSeparator.length);

  if (showHeaderSeparator) {
    console.log('-'.repeat(totalWidth));
  }

  data.forEach((row) => {
    const formattedValues = columns.map((col) => {
      const value = col.format(row);
      const coloredValue = col.color && !value.includes('\x1b[') ? `${col.color}${value}${colors.reset}` : value;
      return coloredValue;
    });

    const hasMultiLine = formattedValues.some((val) => val.includes('\n'));

    if (!hasMultiLine) {
      const rowParts = formattedValues.map((value, i) => {
        return padWithColors(value, columns[i].width, columns[i].align);
      });
      console.log(rowParts.join(columnSeparator));
    } else {
      const valueLines = formattedValues.map((val) => val.split('\n'));
      const maxLines = Math.max(...valueLines.map((lines) => lines.length));

      for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
        const rowParts = columns.map((col, colIdx) => {
          const lines = valueLines[colIdx];
          const lineValue = lineIdx < lines.length ? lines[lineIdx] : '';
          return padWithColors(lineValue, col.width, col.align);
        });

        console.log(rowParts.join(columnSeparator));
      }
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
export function formatCountdown(timestamp: bigint | number): string {
  const now = Math.floor(Date.now() / 1000);
  const remaining = Number(timestamp) - now;
  if (remaining <= 0) return 'Expired';

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
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
export function formatNumberWithSeparator(value: number | string, decimals: number = 2): string {
  const num = Number(value).toFixed(decimals);
  const [integerPart, decimalPart] = num.split('.');
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return decimalPart ? `${formattedInteger}.${decimalPart}` : formattedInteger;
}

/**
 * @param str String to strip ANSI codes from
 * @returns String without ANSI codes
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
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
