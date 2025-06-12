import { BaseRepository, DatabaseField, TableConfig, Transformers } from './baseRepository';

import {
  DecentralizedEuroState,
  EquityState,
  DEPSWrapperState,
  SavingsGatewayState,
  FrontendGatewayState,
  MintingHubState,
} from '../dto';

export class StatePersistence extends BaseRepository {

  // ***** TABLE CONFIGURATIONS *****

  private static readonly STATE_TABLES: Record<string, TableConfig> = {
    deuro_state: {
      name: 'deuro_state_daily',
      conflictFields: ['date'],
      hasLastUpdated: true
    },
    equity_state: {
      name: 'equity_state_daily',
      conflictFields: ['date'],
      hasLastUpdated: true
    },
    deps_state: {
      name: 'deps_state_daily',
      conflictFields: ['date'],
      hasLastUpdated: true
    },
    savings_state: {
      name: 'savings_state_daily',
      conflictFields: ['date'],
      hasLastUpdated: true
    },
    frontend_state: {
      name: 'frontend_state_daily',
      conflictFields: ['date'],
      hasLastUpdated: true
    },
    positions_state: {
      name: 'positions_state_daily',
      conflictFields: ['date'],
      hasLastUpdated: true
    }
  };

  // ***** FIELD MAPPINGS *****

  private static readonly DEURO_STATE_FIELDS: DatabaseField<DecentralizedEuroState>[] = [
    { column: 'date', extractor: () => Transformers.currentDate() },
    { column: 'address', extractor: 'address' },
    { column: 'name', extractor: 'name' },
    { column: 'symbol', extractor: 'symbol' },
    { column: 'decimals', extractor: 'decimals' },
    { column: 'total_supply', extractor: 'totalSupply', transformer: Transformers.bigIntToString },
    { column: 'reserve_balance', extractor: 'reserveBalance', transformer: Transformers.bigIntToString },
    { column: 'minter_reserve', extractor: 'minterReserve', transformer: Transformers.bigIntToString },
    { column: 'equity', extractor: 'equity', transformer: Transformers.bigIntToString },
    { column: 'equity_address', extractor: 'equityAddress' },
    { column: 'min_application_period', extractor: 'minApplicationPeriod', transformer: Transformers.bigIntToString },
    { column: 'min_application_fee', extractor: 'minApplicationFee', transformer: Transformers.bigIntToString }
  ];

  private static readonly EQUITY_STATE_FIELDS: DatabaseField<EquityState>[] = [
    { column: 'date', extractor: () => Transformers.currentDate() },
    { column: 'address', extractor: 'address' },
    { column: 'name', extractor: 'name' },
    { column: 'symbol', extractor: 'symbol' },
    { column: 'decimals', extractor: 'decimals' },
    { column: 'total_supply', extractor: 'totalSupply', transformer: Transformers.bigIntToString },
    { column: 'price', extractor: 'price', transformer: Transformers.bigIntToString },
    { column: 'market_cap', extractor: 'marketCap', transformer: Transformers.bigIntToString },
    { column: 'total_votes', extractor: 'totalVotes', transformer: Transformers.bigIntToString },
    { column: 'deuro_address', extractor: 'dEuroAddress' },
    { column: 'valuation_factor', extractor: 'valuationFactor' },
    { column: 'min_holding_duration', extractor: 'minHoldingDuration', transformer: Transformers.bigIntToString }
  ];

  private static readonly DEPS_STATE_FIELDS: DatabaseField<DEPSWrapperState>[] = [
    { column: 'date', extractor: () => Transformers.currentDate() },
    { column: 'address', extractor: 'address' },
    { column: 'name', extractor: 'name' },
    { column: 'symbol', extractor: 'symbol' },
    { column: 'decimals', extractor: 'decimals' },
    { column: 'total_supply', extractor: 'totalSupply', transformer: Transformers.bigIntToString },
    { column: 'underlying_address', extractor: 'underlyingAddress' },
    { column: 'underlying_symbol', extractor: 'underlyingSymbol' }
  ];

  private static readonly SAVINGS_STATE_FIELDS: DatabaseField<SavingsGatewayState>[] = [
    { column: 'date', extractor: () => Transformers.currentDate() },
    { column: 'address', extractor: 'address' },
    { column: 'current_rate_ppm', extractor: 'currentRatePPM', transformer: Transformers.bigIntToString },
    { column: 'next_rate_ppm', extractor: 'nextRatePPM', transformer: Transformers.bigIntToString },
    { column: 'next_change', extractor: 'nextChange', transformer: Transformers.bigIntToString },
    { column: 'gateway_address', extractor: 'gatewayAddress' },
    { column: 'equity_address', extractor: 'equityAddress' },
    { column: 'deuro_address', extractor: 'deuroAddress' },
    { column: 'total_savings', extractor: 'totalSavings', transformer: Transformers.bigIntToString },
    { column: 'current_ticks', extractor: 'currentTicks', transformer: Transformers.bigIntToString }
  ];

  private static readonly FRONTEND_STATE_FIELDS: DatabaseField<FrontendGatewayState>[] = [
    { column: 'date', extractor: () => Transformers.currentDate() },
    { column: 'address', extractor: 'address' },
    { column: 'deuro_address', extractor: 'deuroAddress' },
    { column: 'equity_address', extractor: 'equityAddress' },
    { column: 'deps_address', extractor: 'depsAddress' },
    { column: 'minting_hub_address', extractor: 'mintingHubAddress' },
    { column: 'savings_address', extractor: 'savingsAddress' },
    { column: 'fee_rate', extractor: 'feeRate' },
    { column: 'savings_fee_rate', extractor: 'savingsFeeRate' },
    { column: 'minting_fee_rate', extractor: 'mintingFeeRate' },
    { column: 'next_fee_rate', extractor: 'nextFeeRate' },
    { column: 'next_savings_fee_rate', extractor: 'nextSavingsFeeRate' },
    { column: 'next_minting_fee_rate', extractor: 'nextMintingFeeRate' },
    { column: 'change_time_lock', extractor: 'changeTimeLock', transformer: Transformers.bigIntToString }
  ];

  private static readonly POSITIONS_STATE_FIELDS: DatabaseField<any>[] = [
    { column: 'date', extractor: () => Transformers.currentDate() },
    { column: 'total_positions', extractor: 'totalPositions' },
    { column: 'active_positions', extractor: 'activePositions' },
    { column: 'total_collateral_value', extractor: 'totalCollateralValue', transformer: Transformers.bigIntToString },
    { column: 'total_debt', extractor: 'totalDebt', transformer: Transformers.bigIntToString },
    { column: 'total_interest', extractor: 'totalInterest', transformer: Transformers.bigIntToString }
  ];

  // ***** PERSISTENCE METHODS *****

  async persistDeuroState(state: DecentralizedEuroState): Promise<void> {
    await this.persistDailyState(
      StatePersistence.STATE_TABLES.deuro_state,
      state,
      StatePersistence.DEURO_STATE_FIELDS
    );
  }

  async persistEquityState(state: EquityState): Promise<void> {
    await this.persistDailyState(
      StatePersistence.STATE_TABLES.equity_state,
      state,
      StatePersistence.EQUITY_STATE_FIELDS
    );
  }

  async persistDepsState(state: DEPSWrapperState): Promise<void> {
    await this.persistDailyState(
      StatePersistence.STATE_TABLES.deps_state,
      state,
      StatePersistence.DEPS_STATE_FIELDS
    );
  }

  async persistSavingsState(state: SavingsGatewayState): Promise<void> {
    await this.persistDailyState(
      StatePersistence.STATE_TABLES.savings_state,
      state,
      StatePersistence.SAVINGS_STATE_FIELDS
    );
  }

  async persistFrontendState(state: FrontendGatewayState): Promise<void> {
    await this.persistDailyState(
      StatePersistence.STATE_TABLES.frontend_state,
      state,
      StatePersistence.FRONTEND_STATE_FIELDS
    );
  }

  async persistPositionsState(state: MintingHubState): Promise<void> {
    const activePositions = state.positions.filter(p => !p.isClosed);
    const totalCollateralValue = activePositions.reduce((sum, p) => sum + p.collateralBalance, 0n);
    const totalDebt = activePositions.reduce((sum, p) => sum + p.debt, 0n);
    const totalInterest = activePositions.reduce((sum, p) => sum + p.interest, 0n);

    // Create an aggregate state object for persistence
    const aggregatedState = {
      totalPositions: state.positions.length,
      activePositions: activePositions.length,
      totalCollateralValue,
      totalDebt,
      totalInterest
    };

    await this.persistDailyState(
      StatePersistence.STATE_TABLES.positions_state,
      aggregatedState,
      StatePersistence.POSITIONS_STATE_FIELDS
    );
  }
}

export const statePersistence = new StatePersistence();