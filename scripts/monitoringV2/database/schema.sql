-- Database schema for dEURO monitoring system
-- This script creates all necessary tables for events and daily state snapshots

-- Enable UUID extension for better primary keys
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =======================
-- EVENT TABLES
-- =======================

-- dEURO Transfer Events
CREATE TABLE deuro_transfer_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  value DECIMAL(78,0) NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- DEPS Transfer Events  
CREATE TABLE deps_transfer_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  value DECIMAL(78,0) NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- dEURO Minter Application Events
CREATE TABLE deuro_minter_applied_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  minter VARCHAR(42) NOT NULL,
  application_period DECIMAL(78,0) NOT NULL,
  application_fee DECIMAL(78,0) NOT NULL,
  message TEXT NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- dEURO Minter Denied Events
CREATE TABLE deuro_minter_denied_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  minter VARCHAR(42) NOT NULL,
  message TEXT NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- dEURO Loss Events
CREATE TABLE deuro_loss_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  reporting_minter VARCHAR(42) NOT NULL,
  amount DECIMAL(78,0) NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- dEURO Profit Events
CREATE TABLE deuro_profit_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  reporting_minter VARCHAR(42) NOT NULL,
  amount DECIMAL(78,0) NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- dEURO Profit Distributed Events
CREATE TABLE deuro_profit_distributed_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  recipient VARCHAR(42) NOT NULL,
  amount DECIMAL(78,0) NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- Equity Trade Events
CREATE TABLE equity_trade_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  who VARCHAR(42) NOT NULL,
  amount DECIMAL(78,0) NOT NULL,
  tot_price DECIMAL(78,0) NOT NULL,
  new_price DECIMAL(78,0) NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- Equity Delegation Events
CREATE TABLE equity_delegation_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- DEPS Wrap Events
CREATE TABLE deps_wrap_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  value DECIMAL(78,0) NOT NULL,
  user_address VARCHAR(42) NOT NULL,
  amount DECIMAL(78,0) NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- DEPS Unwrap Events
CREATE TABLE deps_unwrap_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  value DECIMAL(78,0) NOT NULL,
  user_address VARCHAR(42) NOT NULL,
  amount DECIMAL(78,0) NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- Savings Saved Events
CREATE TABLE savings_saved_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  account VARCHAR(42) NOT NULL,
  amount DECIMAL(78,0) NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- Savings Interest Collected Events
CREATE TABLE savings_interest_collected_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  account VARCHAR(42) NOT NULL,
  interest DECIMAL(78,0) NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- Savings Withdrawn Events
CREATE TABLE savings_withdrawn_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  account VARCHAR(42) NOT NULL,
  amount DECIMAL(78,0) NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- Savings Rate Proposed Events
CREATE TABLE savings_rate_proposed_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  who VARCHAR(42) NOT NULL,
  next_rate DECIMAL(78,0) NOT NULL,
  next_change DECIMAL(78,0) NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- Savings Rate Changed Events
CREATE TABLE savings_rate_changed_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  new_rate DECIMAL(78,0) NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- MintingHub Position Opened Events
CREATE TABLE minting_hub_position_opened_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  owner VARCHAR(42) NOT NULL,
  position VARCHAR(42) NOT NULL,
  original VARCHAR(42) NOT NULL,
  collateral VARCHAR(42) NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- Roller Roll Events
CREATE TABLE roller_roll_events (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  log_index INTEGER NOT NULL,
  source VARCHAR(42) NOT NULL,
  coll_withdraw DECIMAL(78,0) NOT NULL,
  repay DECIMAL(78,0) NOT NULL,
  target VARCHAR(42) NOT NULL,
  coll_deposit DECIMAL(78,0) NOT NULL,
  mint DECIMAL(78,0) NOT NULL,
  
  UNIQUE(tx_hash, log_index)
);

-- =======================
-- STATE TABLES (Daily snapshots)
-- =======================

-- dEURO Daily State
CREATE TABLE deuro_state_daily (
  date DATE PRIMARY KEY,
  address VARCHAR(42) NOT NULL,
  name VARCHAR(100) NOT NULL,
  symbol VARCHAR(10) NOT NULL,
  decimals INTEGER NOT NULL,
  total_supply DECIMAL(78,0) NOT NULL,
  reserve_balance DECIMAL(78,0) NOT NULL,
  minter_reserve DECIMAL(78,0) NOT NULL,
  equity DECIMAL(78,0) NOT NULL,
  equity_address VARCHAR(42) NOT NULL,
  min_application_period DECIMAL(78,0) NOT NULL,
  min_application_fee DECIMAL(78,0) NOT NULL,
  last_updated TIMESTAMP DEFAULT NOW()
);

-- Equity Daily State
CREATE TABLE equity_state_daily (
  date DATE PRIMARY KEY,
  address VARCHAR(42) NOT NULL,
  name VARCHAR(100) NOT NULL,
  symbol VARCHAR(10) NOT NULL,
  decimals INTEGER NOT NULL,
  total_supply DECIMAL(78,0) NOT NULL,
  price DECIMAL(78,0) NOT NULL,
  total_votes DECIMAL(78,0) NOT NULL,
  deuro_address VARCHAR(42) NOT NULL,
  valuation_factor INTEGER NOT NULL,
  min_holding_duration DECIMAL(78,0) NOT NULL,
  last_updated TIMESTAMP DEFAULT NOW()
);

-- DEPS Daily State
CREATE TABLE deps_state_daily (
  date DATE PRIMARY KEY,
  address VARCHAR(42) NOT NULL,
  name VARCHAR(100) NOT NULL,
  symbol VARCHAR(10) NOT NULL,
  decimals INTEGER NOT NULL,
  total_supply DECIMAL(78,0) NOT NULL,
  underlying_address VARCHAR(42) NOT NULL,
  underlying_symbol VARCHAR(10) NOT NULL,
  last_updated TIMESTAMP DEFAULT NOW()
);

-- Savings Daily State
CREATE TABLE savings_state_daily (
  date DATE PRIMARY KEY,
  address VARCHAR(42) NOT NULL,
  current_rate_ppm DECIMAL(78,0) NOT NULL,
  next_rate_ppm DECIMAL(78,0) NOT NULL,
  next_change DECIMAL(78,0) NOT NULL,
  gateway_address VARCHAR(42) NOT NULL,
  equity_address VARCHAR(42) NOT NULL,
  deuro_address VARCHAR(42) NOT NULL,
  total_savings DECIMAL(78,0) NOT NULL,
  current_ticks DECIMAL(78,0) NOT NULL,
  last_updated TIMESTAMP DEFAULT NOW()
);

-- Frontend Gateway Daily State
CREATE TABLE frontend_state_daily (
  date DATE PRIMARY KEY,
  address VARCHAR(42) NOT NULL,
  deuro_address VARCHAR(42) NOT NULL,
  equity_address VARCHAR(42) NOT NULL,
  deps_address VARCHAR(42) NOT NULL,
  minting_hub_address VARCHAR(42) NOT NULL,
  savings_address VARCHAR(42) NOT NULL,
  fee_rate DECIMAL(78,0) NOT NULL,
  savings_fee_rate DECIMAL(78,0) NOT NULL,
  minting_fee_rate DECIMAL(78,0) NOT NULL,
  next_fee_rate DECIMAL(78,0) NOT NULL,
  next_savings_fee_rate DECIMAL(78,0) NOT NULL,
  next_minting_fee_rate DECIMAL(78,0) NOT NULL,
  change_time_lock DECIMAL(78,0) NOT NULL,
  last_updated TIMESTAMP DEFAULT NOW()
);

-- MintingHub Daily State (configuration only)
CREATE TABLE minting_hub_state_daily (
  date DATE PRIMARY KEY,
  opening_fee DECIMAL(78,0) NOT NULL,
  challenger_reward DECIMAL(78,0) NOT NULL,
  expired_price_factor INTEGER NOT NULL,
  position_factory VARCHAR(42) NOT NULL,
  deuro VARCHAR(42) NOT NULL,
  position_roller VARCHAR(42) NOT NULL,
  rate VARCHAR(42) NOT NULL,
  last_updated TIMESTAMP DEFAULT NOW()
);

-- Individual Position States (current state, not daily snapshots)
CREATE TABLE position_states (
  address VARCHAR(42) PRIMARY KEY,
  owner VARCHAR(42) NOT NULL,
  original VARCHAR(42) NOT NULL,
  collateral_address VARCHAR(42) NOT NULL,
  collateral_balance DECIMAL(78,0) NOT NULL,
  expired_purchase_price DECIMAL(78,0) NOT NULL,
  price DECIMAL(78,0) NOT NULL,
  virtual_price DECIMAL(78,0) NOT NULL,
  collateral_requirement DECIMAL(78,0) NOT NULL,
  debt DECIMAL(78,0) NOT NULL,
  interest DECIMAL(78,0) NOT NULL,
  minimum_collateral DECIMAL(78,0) NOT NULL,
  limit_amount DECIMAL(78,0) NOT NULL,
  principal DECIMAL(78,0) NOT NULL,
  risk_premium_ppm INTEGER NOT NULL,
  reserve_contribution INTEGER NOT NULL,
  fixed_annual_rate_ppm INTEGER NOT NULL,
  last_accrual DECIMAL(78,0) NOT NULL,
  start_time DECIMAL(78,0) NOT NULL,
  cooldown DECIMAL(78,0) NOT NULL,
  expiration DECIMAL(78,0) NOT NULL,
  challenged_amount DECIMAL(78,0) NOT NULL,
  challenge_period DECIMAL(78,0) NOT NULL,
  is_closed BOOLEAN NOT NULL,
  created INTEGER, -- Only set from events, never overwritten
  last_updated TIMESTAMP DEFAULT NOW()
);

-- Individual Challenge States (current state, not daily snapshots)
CREATE TABLE challenge_states (
  id INTEGER PRIMARY KEY,
  challenger VARCHAR(42) NOT NULL,
  position VARCHAR(42) NOT NULL,
  start_time INTEGER NOT NULL,
  size DECIMAL(78,0) NOT NULL,
  collateral_address VARCHAR(42) NOT NULL,
  liq_price DECIMAL(78,0) NOT NULL,
  phase INTEGER NOT NULL,
  current_price DECIMAL(78,0) NOT NULL,
  position_owner VARCHAR(42) NOT NULL,
  last_updated TIMESTAMP DEFAULT NOW()
);

-- Collateral States (current state, not daily snapshots)
CREATE TABLE collateral_states (
  address VARCHAR(42) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  symbol VARCHAR(10) NOT NULL,
  decimals INTEGER NOT NULL,
  last_updated TIMESTAMP DEFAULT NOW()
);

-- =======================
-- INDEXES FOR PERFORMANCE
-- =======================

-- Event table indexes
CREATE INDEX idx_deuro_transfers_timestamp ON deuro_transfer_events(timestamp);
CREATE INDEX idx_deuro_transfers_from ON deuro_transfer_events(from_address);
CREATE INDEX idx_deuro_transfers_to ON deuro_transfer_events(to_address);

CREATE INDEX idx_deps_transfers_timestamp ON deps_transfer_events(timestamp);
CREATE INDEX idx_deps_transfers_from ON deps_transfer_events(from_address);
CREATE INDEX idx_deps_transfers_to ON deps_transfer_events(to_address);

CREATE INDEX idx_equity_trades_timestamp ON equity_trade_events(timestamp);
CREATE INDEX idx_equity_trades_who ON equity_trade_events(who);

CREATE INDEX idx_position_opened_timestamp ON minting_hub_position_opened_events(timestamp);
CREATE INDEX idx_position_opened_owner ON minting_hub_position_opened_events(owner);

CREATE INDEX idx_savings_saved_timestamp ON savings_saved_events(timestamp);
CREATE INDEX idx_savings_saved_account ON savings_saved_events(account);

-- State table indexes
CREATE INDEX idx_deuro_state_last_updated ON deuro_state_daily(last_updated);
CREATE INDEX idx_equity_state_last_updated ON equity_state_daily(last_updated);
CREATE INDEX idx_deps_state_last_updated ON deps_state_daily(last_updated);
CREATE INDEX idx_savings_state_last_updated ON savings_state_daily(last_updated);
CREATE INDEX idx_frontend_state_last_updated ON frontend_state_daily(last_updated);
CREATE INDEX idx_minting_hub_state_last_updated ON minting_hub_state_daily(last_updated);

-- Individual state table indexes
CREATE INDEX idx_position_states_owner ON position_states(owner);
CREATE INDEX idx_position_states_collateral ON position_states(collateral_address);
CREATE INDEX idx_position_states_is_closed ON position_states(is_closed);
CREATE INDEX idx_position_states_last_updated ON position_states(last_updated);

CREATE INDEX idx_challenge_states_challenger ON challenge_states(challenger);
CREATE INDEX idx_challenge_states_position ON challenge_states(position);
CREATE INDEX idx_challenge_states_last_updated ON challenge_states(last_updated);

CREATE INDEX idx_collateral_states_symbol ON collateral_states(symbol);
CREATE INDEX idx_collateral_states_last_updated ON collateral_states(last_updated);

-- Bridge states - tracks current state of each StablecoinBridge
CREATE TABLE bridge_states (
  bridge_type VARCHAR(20) NOT NULL,
  bridge_address VARCHAR(42) NOT NULL PRIMARY KEY,
  eur_address VARCHAR(42) NOT NULL,
  eur_symbol VARCHAR(20) NOT NULL,
  eur_decimals INTEGER NOT NULL,
  deuro_address VARCHAR(42) NOT NULL,
  limit_amount NUMERIC(78,0) NOT NULL,
  minted_amount NUMERIC(78,0) NOT NULL,
  horizon NUMERIC(78,0) NOT NULL,
  last_updated TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bridge_states_type ON bridge_states(bridge_type);
CREATE INDEX idx_bridge_states_last_updated ON bridge_states(last_updated);

-- =======================
-- MONITORING METADATA
-- =======================

-- Track monitoring cycles and block ranges
CREATE TABLE monitoring_metadata (
  id BIGSERIAL PRIMARY KEY,
  cycle_timestamp TIMESTAMP DEFAULT NOW(),
  last_processed_block BIGINT NOT NULL,
  events_processed INTEGER DEFAULT 0,
  processing_duration_ms INTEGER DEFAULT 0
);

CREATE INDEX idx_monitoring_metadata_timestamp ON monitoring_metadata(cycle_timestamp);
CREATE INDEX idx_monitoring_metadata_block ON monitoring_metadata(last_processed_block);