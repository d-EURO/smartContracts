import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

interface DatabaseConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  connectionString?: string;
  ssl?: boolean | {
    ca?: string;
    key?: string;
    cert?: string;
    rejectUnauthorized?: boolean;
  };
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

interface BlockRow extends QueryResultRow {
  last_processed_block: number;
}

export class DatabaseClient {
  private pool: Pool;
  private static instance: DatabaseClient;
  private static signalHandlersSetup = false;

  private constructor(config: DatabaseConfig) {
    let sslConfig: any = false;
    if (config.ssl === true) {
      sslConfig = { rejectUnauthorized: true };
    } else if (typeof config.ssl === 'object') {
      sslConfig = config.ssl;
    } else if (process.env.NODE_ENV === 'development' && config.ssl) {
      sslConfig = { rejectUnauthorized: false };
    }

    const poolConfig: any = {
      ssl: sslConfig,
      max: config.max || parseInt(process.env.PG_MAX_CLIENTS || '10'),
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 2000,
    };

    if (config.connectionString) {
      poolConfig.connectionString = config.connectionString;
    } else {
      poolConfig.host = config.host;
      poolConfig.port = config.port;
      poolConfig.database = config.database;
      poolConfig.user = config.user;
      poolConfig.password = config.password;
    }

    this.pool = new Pool(poolConfig);

    this.pool.on('error', (err: Error) => {
      console.error('Database pool error:', err);
    });

    if (!DatabaseClient.signalHandlersSetup) {
      process.on('SIGINT', this.gracefulShutdown.bind(this));
      process.on('SIGTERM', this.gracefulShutdown.bind(this));
      DatabaseClient.signalHandlersSetup = true;
    }
  }

  public static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      // Support DATABASE_URL for easy deployment
      if (process.env.DATABASE_URL) {
        const config: DatabaseConfig = {
          connectionString: process.env.DATABASE_URL,
          ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        };
        DatabaseClient.instance = new DatabaseClient(config);
      } else {
        const port = parseInt(process.env.DB_PORT || '5432');
        if (isNaN(port) || port <= 0 || port > 65535) {
          throw new Error(`Invalid DB_PORT: ${process.env.DB_PORT}. Must be a valid port number.`);
        }

        const config: DatabaseConfig = {
          host: process.env.DB_HOST || 'localhost',
          port,
          database: process.env.DB_NAME || 'deuro_monitoring',
          user: process.env.DB_USER || 'postgres',
          password: process.env.DB_PASSWORD || '',
          ssl: process.env.DB_SSL === 'true',
        };

        DatabaseClient.instance = new DatabaseClient(config);
      }
    }
    return DatabaseClient.instance;
  }

  /**
   * Create a client instance for testing with custom configuration.
   * Does not use the singleton pattern.
   */
  public static createForTesting(config: DatabaseConfig): DatabaseClient {
    return new DatabaseClient(config);
  }

  /**
   * Get a client from the pool. Remember to release it when done.
   * For most use cases, use query() instead.
   */
  private async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  /**
   * Execute a query using the pool. Automatically manages client lifecycle.
   * Does not wrap in a transaction - use withTransaction for multi-statement operations.
   */
  public async query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
      const result = await this.pool.query<T>(text, params);
      const duration = Date.now() - start;
      
      // Log slow queries
      if (duration > 500) {
        console.warn(`Slow query detected (${duration}ms):`, text.substring(0, 100));
      }
      
      return result;
    } catch (error: any) {
      const duration = Date.now() - start;
      console.error(`Query failed after ${duration}ms:`, {
        sql: text.substring(0, 100),
        params: params?.length ? `[${params.length} params]` : 'none',
        errorCode: error.code,
        errorMessage: error.message
      });
      throw error;
    }
  }

  /**
   * Execute a query and return only the rows array.
   * Convenience method for type-safe row extraction.
   */
  public async fetch<T extends QueryResultRow>(text: string, params?: any[]): Promise<T[]> {
    const result = await this.query<T>(text, params);
    return result.rows;
  }

  /**
   * Execute multiple queries within a transaction.
   * Automatically handles BEGIN/COMMIT/ROLLBACK.
   */
  public async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Initialize database schema from schema.sql file.
   * Uses IF NOT EXISTS patterns for idempotency.
   */
  public async initializeSchema(): Promise<void> {
    try {
      const schemaPath = process.env.DB_SCHEMA_PATH || join(__dirname, 'schema.sql');
      const schemaSql = readFileSync(schemaPath, 'utf8');
      
      console.log('Initializing database schema...');
      
      // Split by semicolons to handle multiple statements properly
      const statements = schemaSql
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0);
      
      // Execute each statement separately for better error handling
      await this.withTransaction(async (client) => {
        for (const statement of statements) {
          await client.query(statement);
        }
      });
      
      console.log('Database schema initialized successfully');
    } catch (error) {
      console.error('Failed to initialize database schema:', error);
      throw error;
    }
  }

  /**
   * Test database connectivity.
   * Returns true if connection is successful, false otherwise.
   */
  public async testConnection(): Promise<boolean> {
    try {
      const result = await this.query<{ current_time: Date } & QueryResultRow>('SELECT NOW() as current_time');
      console.log('Database connection successful:', result.rows[0].current_time);
      return true;
    } catch (error) {
      console.error('Database connection failed:', error);
      return false;
    }
  }

  /**
   * Record a monitoring cycle for audit purposes.
   * Throws on failure.
   */
  public async recordMonitoringCycle(lastBlock: number, eventsProcessed: number, durationMs: number): Promise<void> {
    const query = `
      INSERT INTO monitoring_metadata (last_processed_block, events_processed, processing_duration_ms)
      VALUES ($1, $2, $3)
    `;
    await this.query(query, [lastBlock, eventsProcessed, durationMs]);
  }

  /**
   * Get the last processed block number from monitoring metadata.
   * Returns null if no previous runs exist.
   */
  public async getLastProcessedBlock(): Promise<number | null> {
    const query = `
      SELECT last_processed_block 
      FROM monitoring_metadata 
      ORDER BY cycle_timestamp DESC 
      LIMIT 1
    `;
    const rows = await this.fetch<BlockRow>(query);
    return rows.length > 0 ? rows[0].last_processed_block : null;
  }

  /**
   * Get active position addresses from the database.
   * Optional filters can be applied.
   */
  public async getActivePositionAddresses(filters?: {
    owner?: string;
    collateral?: string;
    original?: string;
    limit?: number;
  }): Promise<string[]> {
    let query = `
      SELECT DISTINCT position 
      FROM minting_hub_position_opened_events
    `;
    const params: any[] = [];
    const whereConditions: string[] = [];

    if (filters?.owner) {
      whereConditions.push(`owner = $${params.length + 1}`);
      params.push(filters.owner);
    }

    if (filters?.collateral) {
      whereConditions.push(`collateral = $${params.length + 1}`);
      params.push(filters.collateral);
    }

    if (filters?.original) {
      whereConditions.push(`original = $${params.length + 1}`);
      params.push(filters.original);
    }

    if (whereConditions.length > 0) {
      query += ` WHERE ` + whereConditions.join(' AND ');
    }

    query += ` ORDER BY position`;

    if (filters?.limit) {
      query += ` LIMIT $${params.length + 1}`;
      params.push(filters.limit);
    }

    const rows = await this.fetch<{ position: string }>(query, params);
    return rows.map(row => row.position);
  }

  /**
   * Gracefully close the database connection pool.
   * Should be called during application shutdown.
   */
  public async close(): Promise<void> {
    console.log('Closing database connection pool...');
    await this.pool.end();
    console.log('Database connection pool closed');
  }

  /**
   * Handle graceful shutdown on SIGINT/SIGTERM.
   */
  private async gracefulShutdown(): Promise<void> {
    try {
      await this.close();
      process.exit(0);
    } catch (error) {
      console.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }
}

// Export singleton instance
export const db = DatabaseClient.getInstance();