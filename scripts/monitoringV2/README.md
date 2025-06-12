# dEURO Monitoring V2 with Database Persistence

A comprehensive monitoring system for the dEURO protocol with PostgreSQL database persistence, designed for self-contained Docker deployment on Azure.

## Features

- **Complete Event Monitoring**: Tracks all protocol events with dedicated database tables
- **Daily State Snapshots**: Captures daily protocol state with automatic updates
- **Incremental Processing**: Only fetches new events since last monitoring cycle
- **Database Persistence**: PostgreSQL with optimized schemas for fast queries
- **Docker Ready**: Self-contained containerization for cloud deployment
- **Azure Integration**: Complete Azure deployment with Container Apps and PostgreSQL

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Blockchain    │────│  Monitoring     │────│   PostgreSQL    │
│     (RPC)       │    │   Container     │    │    Database     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                       ┌─────────────────┐
                       │   Azure         │
                       │   Container     │
                       │   Apps          │
                       └─────────────────┘
```

## Database Schema

### Event Tables (Per Event Type)
- `deuro_transfer_events` - dEURO token transfers
- `equity_trade_events` - Equity trading events  
- `minting_hub_position_opened_events` - Position openings
- `savings_saved_events` - Savings deposits
- And 15+ more specialized event tables

### Daily State Tables
- `deuro_state_daily` - Daily dEURO contract state
- `equity_state_daily` - Daily equity state
- `positions_state_daily` - Aggregated position metrics
- `savings_state_daily` - Daily savings state

## Quick Start

### Local Development

1. **Copy environment file**:
   ```bash
   cp .env.example .env
   # Edit .env with your RPC URL and configuration
   ```

2. **Start with Docker Compose**:
   ```bash
   docker-compose up -d
   ```

3. **View logs**:
   ```bash
   docker-compose logs -f monitoring
   ```

### Azure Production Deployment

#### Option 1: Automated Script
```bash
cd azure
./deploy.sh
```

#### Option 2: Bicep Infrastructure as Code
```bash
cd azure
./deploy-bicep.sh
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RPC_URL` | Ethereum RPC endpoint | Required |
| `DEPLOYMENT_BLOCK` | Starting block number | 22300000 |
| `DB_HOST` | PostgreSQL host | localhost |
| `DB_PASSWORD` | Database password | Required |
| `MONITORING_INTERVAL` | Cycle interval (ms) | 300000 |

### Database Connection

The system automatically:
- Initializes database schema on first run
- Tracks last processed block for incremental fetching
- Uses connection pooling for optimal performance
- Implements automatic reconnection on failures

## Event Processing

### Incremental Fetching
```typescript
// Only fetch new events since last cycle
const lastBlock = await db.getLastProcessedBlock();
const fromBlock = lastBlock ? lastBlock + 1 : deploymentBlock;
const events = await fetchEvents(contract, filter, fromBlock, currentBlock);
```

### Event Persistence
```typescript
// Each event type has its own optimized table
await eventPersistence.persistEquityTradeEvents(equityEvents);
await eventPersistence.persistDeuroTransferEvents(deuroEvents);
```

### State Snapshots
```typescript
// Daily state updates (upsert pattern)
await statePersistence.persistDeuroState(currentState);
// Updates existing daily record or creates new one
```

## Monitoring & Observability

### Logs
- Structured JSON logging with timestamps
- Color-coded console output for development
- Automatic log rotation in production

### Health Checks
- Database connectivity verification
- RPC endpoint health monitoring
- Automatic container restart on failures

### Metrics Tracking
```sql
-- Monitor processing performance
SELECT 
  DATE(cycle_timestamp),
  AVG(events_processed) as avg_events,
  AVG(processing_duration_ms) as avg_duration_ms
FROM monitoring_metadata 
GROUP BY DATE(cycle_timestamp);
```

## Frontend Integration

### Query Examples

```sql
-- Get equity trades for last 7 days
SELECT who, amount, new_price, timestamp
FROM equity_trade_events 
WHERE timestamp >= NOW() - INTERVAL '7 days'
ORDER BY timestamp DESC;

-- Daily position growth
SELECT date, active_positions, total_debt
FROM positions_state_daily 
ORDER BY date DESC
LIMIT 30;

-- Top transfer activity
SELECT from_address, COUNT(*) as tx_count, SUM(value) as total_volume
FROM deuro_transfer_events
WHERE timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY from_address
ORDER BY total_volume DESC
LIMIT 10;
```

### API Integration
The database can be accessed directly by frontend applications for:
- Real-time dashboards
- Historical analytics  
- User activity tracking
- Protocol metrics

## Deployment Guide

### Azure Container Apps

1. **Resource Requirements**:
   - 1 vCPU, 2GB RAM (sufficient for monitoring)
   - PostgreSQL Flexible Server (Basic tier)
   - Container Registry for image storage

2. **Scaling**:
   - Single replica (stateful processing)
   - Auto-restart on failures
   - Persistent volume for logs

3. **Security**:
   - Private container registry
   - Database firewall rules
   - Secret management for credentials

### Cost Estimation

- **Azure Container Apps**: ~$20-30/month
- **PostgreSQL Flexible Server**: ~$15-25/month  
- **Container Registry**: ~$5/month
- **Total**: ~$40-60/month

## Development

### Building

```bash
# Install dependencies
yarn install

# Build TypeScript
yarn build

# Run locally
yarn dev
```

### Testing

```bash
# Test database connection
yarn test:db

# Test event fetching
yarn test:events
```

### Contributing

1. Follow existing code patterns
2. Add tests for new features
3. Update documentation
4. Ensure Docker builds successfully

## Troubleshooting

### Common Issues

1. **Database Connection Failures**:
   - Check PostgreSQL server status
   - Verify firewall rules allow connections
   - Confirm credentials are correct

2. **RPC Rate Limiting**:
   - Use dedicated RPC endpoint
   - Implement request throttling
   - Monitor RPC response times

3. **Memory Issues**:
   - Increase container memory limits
   - Optimize batch sizes for large event ranges
   - Monitor PostgreSQL memory usage

### Monitoring Commands

```bash
# View container logs
az containerapp logs show --name deuro-monitoring-app --resource-group deuro-monitoring-rg --follow

# Check database connectivity
psql "postgresql://monitoring:password@server.postgres.database.azure.com:5432/deuro_monitoring?sslmode=require"

# Monitor resource usage
az containerapp show --name deuro-monitoring-app --resource-group deuro-monitoring-rg
```

## License

MIT License - see LICENSE file for details.