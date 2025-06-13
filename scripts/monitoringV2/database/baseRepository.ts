import { db } from './client';
import format from 'pg-format';
import { BaseEvent } from '../dto/event.dto';

export interface DatabaseField<T> {
  column: string;
  extractor: keyof T | ((obj: T) => any);
  transformer?: (value: any) => any;
}

export interface TableConfig {
  name: AllowedTableName;
  conflictFields: readonly string[];
  hasLastUpdated: boolean;
}

const ALLOWED_TABLES = [
  'deuro_transfer_events',
  'deps_transfer_events',
  'deuro_minter_applied_events',
  'deuro_minter_denied_events',
  'deuro_loss_events',
  'deuro_profit_events',
  'deuro_profit_distributed_events',
  'equity_trade_events',
  'equity_delegation_events',
  'deps_wrap_events',
  'deps_unwrap_events',
  'savings_saved_events',
  'savings_interest_collected_events',
  'savings_withdrawn_events',
  'savings_rate_proposed_events',
  'savings_rate_changed_events',
  'minting_hub_position_opened_events',
  'roller_roll_events',
  'deuro_state_daily',
  'equity_state_daily',
  'deps_state_daily',
  'savings_state_daily',
  'frontend_state_daily',
  'minting_hub_state_daily',
  'position_states',
  'challenge_states',
  'collateral_states',
  'bridge_states',
] as const;

const ALLOWED_TABLES_SET = new Set(ALLOWED_TABLES);

export type AllowedTableName = (typeof ALLOWED_TABLES)[number];

export const Transformers = {
  bigIntToString: (value: bigint): string => value.toString(),
  timestampToDate: (timestamp: number): Date => new Date(timestamp * 1000),
  identity: (value: any): any => value,
  currentDate: (): string => new Date().toISOString().split('T')[0],
  normalizeUndefined: (value: any): any => (value === undefined ? null : value),
};

export class BaseRepository {
  private static readonly BATCH_SIZE = 500;
  private static readonly MAX_PARAMS = 65535; // PostgreSQL limit

  async persistEvents<T extends BaseEvent>(
    tableConfig: TableConfig,
    events: T[],
    fields: DatabaseField<T>[],
  ): Promise<void> {
    if (events.length === 0) return;
    if (fields.length === 0) throw new Error('No fields provided for persistEvents');
    if (tableConfig.conflictFields.length === 0) throw new Error('Empty conflictFields in TableConfig');
    if (fields.length > BaseRepository.MAX_PARAMS) {
      throw new Error(
        `Too many fields (${fields.length}) - exceeds PostgreSQL parameter limit (${BaseRepository.MAX_PARAMS}). `,
      );
    }

    this.validateTableName(tableConfig.name);
    this.validateColumnNames(tableConfig.conflictFields);

    const maxRowsPerBatch = Math.floor(BaseRepository.MAX_PARAMS / fields.length);
    const batchSize = Math.min(BaseRepository.BATCH_SIZE, maxRowsPerBatch);
    const batches = this.chunkArray(events, batchSize);

    let totalInserted = 0;
    for (const batch of batches) {
      const inserted = await this.persistEventBatch(tableConfig, batch, fields);
      totalInserted += inserted;
    }

    console.log(`> Persisted ${totalInserted}/${events.length} ${tableConfig.name} events`);
  }

  private async persistEventBatch<T extends BaseEvent>(
    tableConfig: TableConfig,
    events: T[],
    fields: DatabaseField<T>[],
  ): Promise<number> {
    const columnNames = fields.map((f) => f.column);

    this.validateColumnNames(columnNames);

    const quotedTable = format.ident(tableConfig.name);
    const quotedColumns = columnNames.map((col) => format.ident(col)).join(', ');
    const quotedConflictFields = tableConfig.conflictFields.map((field) => format.ident(field)).join(', ');
    const placeholders = events
      .map(
        (_, rowIndex) => `(${fields.map((_, colIndex) => `$${rowIndex * fields.length + colIndex + 1}`).join(', ')})`,
      )
      .join(', ');

    const query = `
      INSERT INTO ${quotedTable} (${quotedColumns})
      VALUES ${placeholders}
      ON CONFLICT (${quotedConflictFields}) DO NOTHING
    `;

    const paramCount = events.length * fields.length;
    if (paramCount > BaseRepository.MAX_PARAMS) {
      throw new Error(`Parameter count ${paramCount} exceeds PostgreSQL limit ${BaseRepository.MAX_PARAMS}`);
    }

    const params: any[] = [];
    for (const event of events) {
      for (const field of fields) {
        const value = this.extractAndTransformValue(event, field);
        params.push(value);
      }
    }

    try {
      const result = await db.query(query, params);
      return result.rowCount || 0;
    } catch (error) {
      console.error(`Error persisting ${tableConfig.name} batch:`, error);
      throw new Error(`Failed to persist ${tableConfig.name}: ${error}`);
    }
  }

  async persistDailyState<T>(tableConfig: TableConfig, state: T, fields: DatabaseField<T>[]): Promise<void> {
    if (fields.length === 0) throw new Error('No fields provided for persistDailyState');
    if (tableConfig.conflictFields.length === 0) throw new Error('Empty conflictFields in TableConfig');

    this.validateTableName(tableConfig.name);
    this.validateColumnNames(tableConfig.conflictFields);

    const columnNames = fields.map((f) => f.column);
    this.validateColumnNames(columnNames);

    const quotedTable = format.ident(tableConfig.name);
    const quotedColumns = columnNames.map((col) => format.ident(col)).join(', ');
    const quotedConflictFields = tableConfig.conflictFields.map((field) => format.ident(field)).join(', ');
    const placeholders = fields.map((_, index) => `$${index + 1}`).join(', ');
    const updateFields = fields.filter((f) => !tableConfig.conflictFields.includes(f.column));

    let updateClause: string;
    if (updateFields.length === 0) {
      updateClause = tableConfig.hasLastUpdated
        ? `DO UPDATE SET ${format.ident('last_updated')} = NOW()`
        : 'DO NOTHING';
    } else {
      const updateSet = updateFields
        .map((field) => `${format.ident(field.column)} = EXCLUDED.${format.ident(field.column)}`)
        .join(', ');
      const lastUpdatedClause = tableConfig.hasLastUpdated ? `, ${format.ident('last_updated')} = NOW()` : '';
      updateClause = `DO UPDATE SET ${updateSet}${lastUpdatedClause}`;
    }

    const query = `
      INSERT INTO ${quotedTable} (${quotedColumns})
      VALUES (${placeholders})
      ON CONFLICT (${quotedConflictFields}) 
      ${updateClause}
    `;

    const params: any[] = [];
    for (const field of fields) {
      const value = this.extractAndTransformValue(state, field);
      params.push(value);
    }

    try {
      const result = await db.query(query, params);
      console.log(`> Upserted ${result.rowCount || 1} row into ${tableConfig.name}`);
    } catch (error) {
      console.error(`Error persisting ${tableConfig.name} state:`, error);
      throw new Error(`Failed to persist ${tableConfig.name} state: ${error}`);
    }
  }

  // ***** HELPER FUNCTIONS *****

  protected validateTableName(tableName: string): void {
    if (!ALLOWED_TABLES_SET.has(tableName as AllowedTableName)) {
      throw new Error(`Table '${tableName}' is not in the allowed list`);
    }
  }

  private validateColumnNames(columnNames: readonly string[]): void {
    const invalidChars = /[^\w_$]/; // alphanumeric, _ and $
    for (const column of columnNames) {
      if (invalidChars.test(column) || column.length === 0) {
        throw new Error(`Invalid column name: ${column}`);
      }
    }
  }

  protected extractAndTransformValue<T>(obj: T, field: DatabaseField<T>): any {
    let value: any;

    if (typeof field.extractor === 'function') {
      value = field.extractor(obj);
    } else {
      value = obj[field.extractor];
    }

    if (field.transformer) {
      value = field.transformer(value);
    }

    if (value === undefined) {
      value = null;
    }

    return value;
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}
