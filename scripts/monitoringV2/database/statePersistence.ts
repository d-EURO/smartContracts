import { BaseRepository, DatabaseField, TableConfig, Transformers } from './baseRepository';
import { db } from './client';
import format from 'pg-format';

import {
  DecentralizedEuroState,
  EquityState,
  DEPSWrapperState,
  SavingsGatewayState,
  FrontendGatewayState,
  MintingHubState,
  PositionState,
  ChallengeState,
  CollateralState,
  StablecoinBridgeState,
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
    minting_hub_state: {
      name: 'minting_hub_state_daily',
      conflictFields: ['date'],
      hasLastUpdated: true
    },
    position_states: {
      name: 'position_states',
      conflictFields: ['address'],
      hasLastUpdated: true
    },
    challenge_states: {
      name: 'challenge_states',
      conflictFields: ['id'],
      hasLastUpdated: true
    },
    collateral_states: {
      name: 'collateral_states',
      conflictFields: ['address'],
      hasLastUpdated: true
    },
    bridge_states: {
      name: 'bridge_states',
      conflictFields: ['bridge_address'],
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

  private static readonly MINTING_HUB_STATE_FIELDS: DatabaseField<MintingHubState>[] = [
    { column: 'date', extractor: () => Transformers.currentDate() },
    { column: 'opening_fee', extractor: 'openingFee', transformer: (value: number) => value.toString() },
    { column: 'challenger_reward', extractor: 'challengerReward', transformer: (value: number) => value.toString() },
    { column: 'expired_price_factor', extractor: 'expiredPriceFactor' },
    { column: 'position_factory', extractor: 'positionFactory' },
    { column: 'deuro', extractor: 'deuro' },
    { column: 'position_roller', extractor: 'positionRoller' },
    { column: 'rate', extractor: 'rate' }
  ];

  private static readonly POSITION_STATE_FIELDS: DatabaseField<PositionState>[] = [
    { column: 'address', extractor: 'address' },
    { column: 'owner', extractor: 'owner' },
    { column: 'original', extractor: 'original' },
    { column: 'collateral_address', extractor: 'collateralAddress' },
    { column: 'collateral_balance', extractor: 'collateralBalance', transformer: Transformers.bigIntToString },
    { column: 'expired_purchase_price', extractor: 'expiredPurchasePrice', transformer: Transformers.bigIntToString },
    { column: 'price', extractor: 'price', transformer: Transformers.bigIntToString },
    { column: 'virtual_price', extractor: 'virtualPrice', transformer: Transformers.bigIntToString },
    { column: 'collateral_requirement', extractor: 'collateralRequirement', transformer: Transformers.bigIntToString },
    { column: 'debt', extractor: 'debt', transformer: Transformers.bigIntToString },
    { column: 'interest', extractor: 'interest', transformer: Transformers.bigIntToString },
    { column: 'minimum_collateral', extractor: 'minimumCollateral', transformer: Transformers.bigIntToString },
    { column: 'limit_amount', extractor: 'limit', transformer: Transformers.bigIntToString },
    { column: 'principal', extractor: 'principal', transformer: Transformers.bigIntToString },
    { column: 'risk_premium_ppm', extractor: 'riskPremiumPPM' },
    { column: 'reserve_contribution', extractor: 'reserveContribution' },
    { column: 'fixed_annual_rate_ppm', extractor: 'fixedAnnualRatePPM' },
    { column: 'last_accrual', extractor: 'lastAccrual', transformer: Transformers.bigIntToString },
    { column: 'start_time', extractor: 'start', transformer: Transformers.bigIntToString },
    { column: 'cooldown', extractor: 'cooldown', transformer: Transformers.bigIntToString },
    { column: 'expiration', extractor: 'expiration', transformer: Transformers.bigIntToString },
    { column: 'challenged_amount', extractor: 'challengedAmount', transformer: Transformers.bigIntToString },
    { column: 'challenge_period', extractor: 'challengePeriod', transformer: Transformers.bigIntToString },
    { column: 'is_closed', extractor: 'isClosed' },
    { column: 'created', extractor: 'created', transformer: Transformers.normalizeUndefined }
  ];

  private static readonly CHALLENGE_STATE_FIELDS: DatabaseField<ChallengeState>[] = [
    { column: 'id', extractor: 'id' },
    { column: 'challenger', extractor: 'challenger' },
    { column: 'position', extractor: 'position' },
    { column: 'start_time', extractor: 'start' },
    { column: 'size', extractor: 'size', transformer: Transformers.bigIntToString },
    { column: 'collateral_address', extractor: 'collateralAddress' },
    { column: 'liq_price', extractor: 'liqPrice', transformer: Transformers.bigIntToString },
    { column: 'phase', extractor: 'phase' },
    { column: 'current_price', extractor: 'currentPrice', transformer: Transformers.bigIntToString },
    { column: 'position_owner', extractor: 'positionOwner' }
  ];

  private static readonly COLLATERAL_STATE_FIELDS: DatabaseField<CollateralState>[] = [
    { column: 'address', extractor: 'address' },
    { column: 'name', extractor: 'name' },
    { column: 'symbol', extractor: 'symbol' },
    { column: 'decimals', extractor: 'decimals' }
  ];

  private static readonly BRIDGE_STATE_FIELDS: DatabaseField<StablecoinBridgeState>[] = [
    { column: 'bridge_type', extractor: 'bridgeType' },
    { column: 'bridge_address', extractor: 'address' },
    { column: 'eur_address', extractor: 'eurAddress' },
    { column: 'eur_symbol', extractor: 'eurSymbol' },
    { column: 'eur_decimals', extractor: 'eurDecimals' },
    { column: 'deuro_address', extractor: 'dEuroAddress' },
    { column: 'limit_amount', extractor: 'limit', transformer: Transformers.bigIntToString },
    { column: 'minted_amount', extractor: 'minted', transformer: Transformers.bigIntToString },
    { column: 'horizon', extractor: 'horizon', transformer: Transformers.bigIntToString }
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

  async persistMintingHubState(state: MintingHubState): Promise<void> {
    await this.persistDailyState(
      StatePersistence.STATE_TABLES.minting_hub_state,
      state,
      StatePersistence.MINTING_HUB_STATE_FIELDS
    );
  }

  async persistPositionsState(positions: PositionState[]): Promise<void> {
    if (positions.length === 0) return;

    for (const position of positions) {
      await this.persistPositionState(position);
    }
    console.log(`> Persisted ${positions.length} position states`);
  }

  private async persistPositionState(position: PositionState): Promise<void> {
    const tableConfig = StatePersistence.STATE_TABLES.position_states;
    const allFields = StatePersistence.POSITION_STATE_FIELDS;

    // Filter out 'created' field if it's undefined to preserve existing value
    const fields = position.created === undefined 
      ? allFields.filter(f => f.column !== 'created')
      : allFields;

    const columnNames = fields.map(f => f.column);
    const quotedTable = format.ident(tableConfig.name);
    const quotedColumns = columnNames.map(col => format.ident(col)).join(', ');
    const placeholders = fields.map((_, index) => `$${index + 1}`).join(', ');
    
    // For updates, exclude conflict fields and conditionally exclude 'created'
    const updateFields = fields.filter(f => !tableConfig.conflictFields.includes(f.column));
    
    let updateClause: string;
    if (updateFields.length === 0) {
      updateClause = tableConfig.hasLastUpdated
        ? `DO UPDATE SET ${format.ident('last_updated')} = NOW()`
        : 'DO NOTHING';
    } else {
      const updateSet = updateFields
        .map(field => `${format.ident(field.column)} = EXCLUDED.${format.ident(field.column)}`)
        .join(', ');
      const lastUpdatedClause = tableConfig.hasLastUpdated ? `, ${format.ident('last_updated')} = NOW()` : '';
      updateClause = `DO UPDATE SET ${updateSet}${lastUpdatedClause}`;
    }

    const query = `
      INSERT INTO ${quotedTable} (${quotedColumns})
      VALUES (${placeholders})
      ON CONFLICT (${format.ident('address')}) 
      ${updateClause}
    `;

    const params: any[] = [];
    for (const field of fields) {
      const value = this.extractAndTransformValue(position, field);
      params.push(value);
    }

    try {
      await db.query(query, params);
    } catch (error) {
      console.error(`Error persisting position ${position.address}:`, error);
      throw new Error(`Failed to persist position ${position.address}: ${error}`);
    }
  }

  async persistChallengesState(challenges: ChallengeState[]): Promise<void> {
    if (challenges.length === 0) return;

    // Clear existing challenges and insert new ones (challenges are ephemeral)
    await db.query('DELETE FROM challenge_states');
    
    for (const challenge of challenges) {
      await this.persistDailyState(
        StatePersistence.STATE_TABLES.challenge_states,
        challenge,
        StatePersistence.CHALLENGE_STATE_FIELDS
      );
    }
    console.log(`> Persisted ${challenges.length} challenge states`);
  }

  async persistCollateralState(collaterals: CollateralState[]): Promise<void> {
    if (collaterals.length === 0) return;

    for (const collateral of collaterals) {
      await this.persistDailyState(
        StatePersistence.STATE_TABLES.collateral_states,
        collateral,
        StatePersistence.COLLATERAL_STATE_FIELDS
      );
    }
    console.log(`> Persisted ${collaterals.length} collateral states`);
  }

  async persistBridgeStates(bridgeStates: StablecoinBridgeState[]): Promise<void> {
    if (bridgeStates.length === 0) return;

    for (const bridgeState of bridgeStates) {
      await this.persistDailyState(
        StatePersistence.STATE_TABLES.bridge_states,
        bridgeState,
        StatePersistence.BRIDGE_STATE_FIELDS
      );
    }
    console.log(`> Persisted ${bridgeStates.length} bridge states`);
  }

  // ***** UNIFIED PERSISTENCE METHOD *****

  async persistAllSystemState(systemState: import('../dto').SystemStateData): Promise<void> {
    console.log('Persisting all system state components...');
    
    try {
      await Promise.all([
        this.persistDeuroState(systemState.deuroState),
        this.persistEquityState(systemState.equityState),
        this.persistDepsState(systemState.depsState),
        this.persistSavingsState(systemState.savingsState),
        this.persistFrontendState(systemState.frontendState),
        this.persistMintingHubState(systemState.mintingHubState),
        this.persistPositionsState(systemState.positionsState),
        this.persistChallengesState(systemState.challengesState),
        this.persistCollateralState(systemState.collateralState),
        this.persistBridgeStates(systemState.bridgeStates),
      ]);
      console.log('✓ All system state persisted successfully');
    } catch (error) {
      console.error('Failed to persist system state:', error);
      throw error;
    }
  }
}

export const statePersistence = new StatePersistence();