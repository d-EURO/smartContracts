import { BaseRepository, DatabaseField, TableConfig, Transformers } from './baseRepository';
import {
  TransferEvent,
  DeuroTransferEvent,
  DepsTransferEvent,
  DeuroMinterAppliedEvent,
  DeuroMinterDeniedEvent,
  DeuroLossEvent,
  DeuroProfitEvent,
  DeuroProfitDistributedEvent,
  EquityTradeEvent,
  EquityDelegationEvent,
  DepsWrapEvent,
  DepsUnwrapEvent,
  SavingsSavedEvent,
  SavingsInterestCollectedEvent,
  SavingsWithdrawnEvent,
  SavingsRateProposedEvent,
  SavingsRateChangedEvent,
  MintingHubPositionOpenedEvent,
  RollerRollEvent,
} from '../dto/event.dto';

export class EventPersistence extends BaseRepository {
  // ***** TABLE CONFIGURATIONS *****

  private static readonly EVENT_TABLES: Record<string, TableConfig> = {
    deuro_transfer: {
      name: 'deuro_transfer_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
    deps_transfer: {
      name: 'deps_transfer_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
    equity_trade: {
      name: 'equity_trade_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
    deuro_minter_applied: {
      name: 'deuro_minter_applied_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
    deuro_minter_denied: {
      name: 'deuro_minter_denied_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
    deuro_loss: {
      name: 'deuro_loss_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
    deuro_profit: {
      name: 'deuro_profit_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
    deuro_profit_distributed: {
      name: 'deuro_profit_distributed_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
    equity_delegation: {
      name: 'equity_delegation_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
    deps_wrap: {
      name: 'deps_wrap_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
    deps_unwrap: {
      name: 'deps_unwrap_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
    savings_saved: {
      name: 'savings_saved_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
    savings_interest_collected: {
      name: 'savings_interest_collected_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
    savings_withdrawn: {
      name: 'savings_withdrawn_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
    savings_rate_proposed: {
      name: 'savings_rate_proposed_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
    savings_rate_changed: {
      name: 'savings_rate_changed_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
    minting_hub_position_opened: {
      name: 'minting_hub_position_opened_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
    roller_roll: {
      name: 'roller_roll_events',
      conflictFields: ['tx_hash', 'log_index'],
      hasLastUpdated: false,
    },
  };

  // ***** FIELD MAPPINGS *****

  private static readonly TRANSFER_FIELDS: DatabaseField<TransferEvent>[] = [
    { column: 'tx_hash', extractor: 'txHash' },
    { column: 'timestamp', extractor: 'timestamp', transformer: Transformers.timestampToDate },
    { column: 'log_index', extractor: 'logIndex' },
    { column: 'from_address', extractor: 'from' },
    { column: 'to_address', extractor: 'to' },
    { column: 'value', extractor: 'value', transformer: Transformers.bigIntToString },
  ];

  private static readonly EQUITY_TRADE_FIELDS: DatabaseField<EquityTradeEvent>[] = [
    { column: 'tx_hash', extractor: 'txHash' },
    { column: 'timestamp', extractor: 'timestamp', transformer: Transformers.timestampToDate },
    { column: 'log_index', extractor: 'logIndex' },
    { column: 'who', extractor: 'who' },
    { column: 'amount', extractor: 'amount', transformer: Transformers.bigIntToString },
    { column: 'tot_price', extractor: 'totPrice', transformer: Transformers.bigIntToString },
    { column: 'new_price', extractor: 'newPrice', transformer: Transformers.bigIntToString },
  ];

  private static readonly MINTER_APPLIED_FIELDS: DatabaseField<DeuroMinterAppliedEvent>[] = [
    { column: 'tx_hash', extractor: 'txHash' },
    { column: 'timestamp', extractor: 'timestamp', transformer: Transformers.timestampToDate },
    { column: 'log_index', extractor: 'logIndex' },
    { column: 'minter', extractor: 'minter' },
    { column: 'application_period', extractor: 'applicationPeriod', transformer: Transformers.bigIntToString },
    { column: 'application_fee', extractor: 'applicationFee', transformer: Transformers.bigIntToString },
    { column: 'message', extractor: 'message' },
  ];

  private static readonly POSITION_OPENED_FIELDS: DatabaseField<MintingHubPositionOpenedEvent>[] = [
    { column: 'tx_hash', extractor: 'txHash' },
    { column: 'timestamp', extractor: 'timestamp', transformer: Transformers.timestampToDate },
    { column: 'log_index', extractor: 'logIndex' },
    { column: 'owner', extractor: 'owner' },
    { column: 'position', extractor: 'position' },
    { column: 'original', extractor: 'original' },
    { column: 'collateral', extractor: 'collateral' },
  ];

  private static readonly MINTER_DENIED_FIELDS: DatabaseField<DeuroMinterDeniedEvent>[] = [
    { column: 'tx_hash', extractor: 'txHash' },
    { column: 'timestamp', extractor: 'timestamp', transformer: Transformers.timestampToDate },
    { column: 'log_index', extractor: 'logIndex' },
    { column: 'minter', extractor: 'minter' },
    { column: 'message', extractor: 'message' },
  ];

  private static readonly DEURO_LOSS_FIELDS: DatabaseField<DeuroLossEvent>[] = [
    { column: 'tx_hash', extractor: 'txHash' },
    { column: 'timestamp', extractor: 'timestamp', transformer: Transformers.timestampToDate },
    { column: 'log_index', extractor: 'logIndex' },
    { column: 'reporting_minter', extractor: 'reportingMinter' },
    { column: 'amount', extractor: 'amount', transformer: Transformers.bigIntToString },
  ];

  private static readonly DEURO_PROFIT_FIELDS: DatabaseField<DeuroProfitEvent>[] = [
    { column: 'tx_hash', extractor: 'txHash' },
    { column: 'timestamp', extractor: 'timestamp', transformer: Transformers.timestampToDate },
    { column: 'log_index', extractor: 'logIndex' },
    { column: 'reporting_minter', extractor: 'reportingMinter' },
    { column: 'amount', extractor: 'amount', transformer: Transformers.bigIntToString },
  ];

  private static readonly DEURO_PROFIT_DISTRIBUTED_FIELDS: DatabaseField<DeuroProfitDistributedEvent>[] = [
    { column: 'tx_hash', extractor: 'txHash' },
    { column: 'timestamp', extractor: 'timestamp', transformer: Transformers.timestampToDate },
    { column: 'log_index', extractor: 'logIndex' },
    { column: 'recipient', extractor: 'recipient' },
    { column: 'amount', extractor: 'amount', transformer: Transformers.bigIntToString },
  ];

  private static readonly EQUITY_DELEGATION_FIELDS: DatabaseField<EquityDelegationEvent>[] = [
    { column: 'tx_hash', extractor: 'txHash' },
    { column: 'timestamp', extractor: 'timestamp', transformer: Transformers.timestampToDate },
    { column: 'log_index', extractor: 'logIndex' },
    { column: 'from_address', extractor: 'from' },
    { column: 'to_address', extractor: 'to' },
  ];

  private static readonly DEPS_WRAP_FIELDS: DatabaseField<DepsWrapEvent>[] = [
    { column: 'tx_hash', extractor: 'txHash' },
    { column: 'timestamp', extractor: 'timestamp', transformer: Transformers.timestampToDate },
    { column: 'log_index', extractor: 'logIndex' },
    { column: 'from_address', extractor: 'from' },
    { column: 'to_address', extractor: 'to' },
    { column: 'value', extractor: 'value', transformer: Transformers.bigIntToString },
    { column: 'user_address', extractor: 'user' },
    { column: 'amount', extractor: 'amount', transformer: Transformers.bigIntToString },
  ];

  private static readonly DEPS_UNWRAP_FIELDS: DatabaseField<DepsUnwrapEvent>[] = [
    { column: 'tx_hash', extractor: 'txHash' },
    { column: 'timestamp', extractor: 'timestamp', transformer: Transformers.timestampToDate },
    { column: 'log_index', extractor: 'logIndex' },
    { column: 'from_address', extractor: 'from' },
    { column: 'to_address', extractor: 'to' },
    { column: 'value', extractor: 'value', transformer: Transformers.bigIntToString },
    { column: 'user_address', extractor: 'user' },
    { column: 'amount', extractor: 'amount', transformer: Transformers.bigIntToString },
  ];

  private static readonly SAVINGS_SAVED_FIELDS: DatabaseField<SavingsSavedEvent>[] = [
    { column: 'tx_hash', extractor: 'txHash' },
    { column: 'timestamp', extractor: 'timestamp', transformer: Transformers.timestampToDate },
    { column: 'log_index', extractor: 'logIndex' },
    { column: 'account', extractor: 'account' },
    { column: 'amount', extractor: 'amount', transformer: Transformers.bigIntToString },
  ];

  private static readonly SAVINGS_INTEREST_COLLECTED_FIELDS: DatabaseField<SavingsInterestCollectedEvent>[] = [
    { column: 'tx_hash', extractor: 'txHash' },
    { column: 'timestamp', extractor: 'timestamp', transformer: Transformers.timestampToDate },
    { column: 'log_index', extractor: 'logIndex' },
    { column: 'account', extractor: 'account' },
    { column: 'interest', extractor: 'interest', transformer: Transformers.bigIntToString },
  ];

  private static readonly SAVINGS_WITHDRAWN_FIELDS: DatabaseField<SavingsWithdrawnEvent>[] = [
    { column: 'tx_hash', extractor: 'txHash' },
    { column: 'timestamp', extractor: 'timestamp', transformer: Transformers.timestampToDate },
    { column: 'log_index', extractor: 'logIndex' },
    { column: 'account', extractor: 'account' },
    { column: 'amount', extractor: 'amount', transformer: Transformers.bigIntToString },
  ];

  private static readonly SAVINGS_RATE_PROPOSED_FIELDS: DatabaseField<SavingsRateProposedEvent>[] = [
    { column: 'tx_hash', extractor: 'txHash' },
    { column: 'timestamp', extractor: 'timestamp', transformer: Transformers.timestampToDate },
    { column: 'log_index', extractor: 'logIndex' },
    { column: 'who', extractor: 'who' },
    { column: 'next_rate', extractor: 'nextRate', transformer: Transformers.bigIntToString },
    { column: 'next_change', extractor: 'nextChange', transformer: Transformers.bigIntToString },
  ];

  private static readonly SAVINGS_RATE_CHANGED_FIELDS: DatabaseField<SavingsRateChangedEvent>[] = [
    { column: 'tx_hash', extractor: 'txHash' },
    { column: 'timestamp', extractor: 'timestamp', transformer: Transformers.timestampToDate },
    { column: 'log_index', extractor: 'logIndex' },
    { column: 'new_rate', extractor: 'newRate', transformer: Transformers.bigIntToString },
  ];

  private static readonly ROLLER_ROLL_FIELDS: DatabaseField<RollerRollEvent>[] = [
    { column: 'tx_hash', extractor: 'txHash' },
    { column: 'timestamp', extractor: 'timestamp', transformer: Transformers.timestampToDate },
    { column: 'log_index', extractor: 'logIndex' },
    { column: 'source', extractor: 'source' },
    { column: 'coll_withdraw', extractor: 'collWithdraw', transformer: Transformers.bigIntToString },
    { column: 'repay', extractor: 'repay', transformer: Transformers.bigIntToString },
    { column: 'target', extractor: 'target' },
    { column: 'coll_deposit', extractor: 'collDeposit', transformer: Transformers.bigIntToString },
    { column: 'mint', extractor: 'mint', transformer: Transformers.bigIntToString },
  ];

  // ***** PERSISTENCE METHODS *****

  async persistDeuroTransferEvents(events: DeuroTransferEvent[]): Promise<void> {
    await this.persistEvents(EventPersistence.EVENT_TABLES.deuro_transfer, events, EventPersistence.TRANSFER_FIELDS);
  }

  async persistDepsTransferEvents(events: DepsTransferEvent[]): Promise<void> {
    await this.persistEvents(
      EventPersistence.EVENT_TABLES.deps_transfer,
      events,
      EventPersistence.TRANSFER_FIELDS,
    );
  }

  async persistEquityTradeEvents(events: EquityTradeEvent[]): Promise<void> {
    await this.persistEvents(EventPersistence.EVENT_TABLES.equity_trade, events, EventPersistence.EQUITY_TRADE_FIELDS);
  }

  async persistDeuroMinterAppliedEvents(events: DeuroMinterAppliedEvent[]): Promise<void> {
    await this.persistEvents(
      EventPersistence.EVENT_TABLES.deuro_minter_applied,
      events,
      EventPersistence.MINTER_APPLIED_FIELDS,
    );
  }

  async persistDeuroMinterDeniedEvents(events: DeuroMinterDeniedEvent[]): Promise<void> {
    await this.persistEvents(
      EventPersistence.EVENT_TABLES.deuro_minter_denied,
      events,
      EventPersistence.MINTER_DENIED_FIELDS,
    );
  }

  async persistDeuroLossEvents(events: DeuroLossEvent[]): Promise<void> {
    await this.persistEvents(EventPersistence.EVENT_TABLES.deuro_loss, events, EventPersistence.DEURO_LOSS_FIELDS);
  }

  async persistDeuroProfitEvents(events: DeuroProfitEvent[]): Promise<void> {
    await this.persistEvents(EventPersistence.EVENT_TABLES.deuro_profit, events, EventPersistence.DEURO_PROFIT_FIELDS);
  }

  async persistDeuroProfitDistributedEvents(events: DeuroProfitDistributedEvent[]): Promise<void> {
    await this.persistEvents(
      EventPersistence.EVENT_TABLES.deuro_profit_distributed,
      events,
      EventPersistence.DEURO_PROFIT_DISTRIBUTED_FIELDS,
    );
  }

  async persistEquityDelegationEvents(events: EquityDelegationEvent[]): Promise<void> {
    await this.persistEvents(
      EventPersistence.EVENT_TABLES.equity_delegation,
      events,
      EventPersistence.EQUITY_DELEGATION_FIELDS,
    );
  }

  async persistDepsWrapEvents(events: DepsWrapEvent[]): Promise<void> {
    await this.persistEvents(EventPersistence.EVENT_TABLES.deps_wrap, events, EventPersistence.DEPS_WRAP_FIELDS);
  }

  async persistDepsUnwrapEvents(events: DepsUnwrapEvent[]): Promise<void> {
    await this.persistEvents(EventPersistence.EVENT_TABLES.deps_unwrap, events, EventPersistence.DEPS_UNWRAP_FIELDS);
  }

  async persistSavingsSavedEvents(events: SavingsSavedEvent[]): Promise<void> {
    await this.persistEvents(
      EventPersistence.EVENT_TABLES.savings_saved,
      events,
      EventPersistence.SAVINGS_SAVED_FIELDS,
    );
  }

  async persistSavingsInterestCollectedEvents(events: SavingsInterestCollectedEvent[]): Promise<void> {
    await this.persistEvents(
      EventPersistence.EVENT_TABLES.savings_interest_collected,
      events,
      EventPersistence.SAVINGS_INTEREST_COLLECTED_FIELDS,
    );
  }

  async persistSavingsWithdrawnEvents(events: SavingsWithdrawnEvent[]): Promise<void> {
    await this.persistEvents(
      EventPersistence.EVENT_TABLES.savings_withdrawn,
      events,
      EventPersistence.SAVINGS_WITHDRAWN_FIELDS,
    );
  }

  async persistSavingsRateProposedEvents(events: SavingsRateProposedEvent[]): Promise<void> {
    await this.persistEvents(
      EventPersistence.EVENT_TABLES.savings_rate_proposed,
      events,
      EventPersistence.SAVINGS_RATE_PROPOSED_FIELDS,
    );
  }

  async persistSavingsRateChangedEvents(events: SavingsRateChangedEvent[]): Promise<void> {
    await this.persistEvents(
      EventPersistence.EVENT_TABLES.savings_rate_changed,
      events,
      EventPersistence.SAVINGS_RATE_CHANGED_FIELDS,
    );
  }

  async persistMintingHubPositionOpenedEvents(events: MintingHubPositionOpenedEvent[]): Promise<void> {
    await this.persistEvents(
      EventPersistence.EVENT_TABLES.minting_hub_position_opened,
      events,
      EventPersistence.POSITION_OPENED_FIELDS,
    );
  }

  async persistRollerRollEvents(events: RollerRollEvent[]): Promise<void> {
    await this.persistEvents(EventPersistence.EVENT_TABLES.roller_roll, events, EventPersistence.ROLLER_ROLL_FIELDS);
  }

  // ***** BATCH PERSISTENCE *****

  async persistAllEvents(eventsData: {
    deuroTransferEvents: DeuroTransferEvent[];
    depsTransferEvents: DepsTransferEvent[];
    equityTradeEvents: EquityTradeEvent[];
    deuroMinterAppliedEvents: DeuroMinterAppliedEvent[];
    deuroMinterDeniedEvents: DeuroMinterDeniedEvent[];
    deuroLossEvents: DeuroLossEvent[];
    deuroProfitEvents: DeuroProfitEvent[];
    deuroProfitDistributedEvents: DeuroProfitDistributedEvent[];
    equityDelegationEvents: EquityDelegationEvent[];
    depsWrapEvents: DepsWrapEvent[];
    depsUnwrapEvents: DepsUnwrapEvent[];
    savingsSavedEvents: SavingsSavedEvent[];
    savingsInterestCollectedEvents: SavingsInterestCollectedEvent[];
    savingsWithdrawnEvents: SavingsWithdrawnEvent[];
    savingsRateProposedEvents: SavingsRateProposedEvent[];
    savingsRateChangedEvents: SavingsRateChangedEvent[];
    mintingHubPositionOpenedEvents: MintingHubPositionOpenedEvent[];
    rollerRollEvents: RollerRollEvent[];
  }): Promise<void> {
    const operations = [
      this.persistDeuroTransferEvents(eventsData.deuroTransferEvents),
      this.persistDepsTransferEvents(eventsData.depsTransferEvents),
      this.persistEquityTradeEvents(eventsData.equityTradeEvents),
      this.persistDeuroMinterAppliedEvents(eventsData.deuroMinterAppliedEvents),
      this.persistDeuroMinterDeniedEvents(eventsData.deuroMinterDeniedEvents),
      this.persistDeuroLossEvents(eventsData.deuroLossEvents),
      this.persistDeuroProfitEvents(eventsData.deuroProfitEvents),
      this.persistDeuroProfitDistributedEvents(eventsData.deuroProfitDistributedEvents),
      this.persistEquityDelegationEvents(eventsData.equityDelegationEvents),
      this.persistDepsWrapEvents(eventsData.depsWrapEvents),
      this.persistDepsUnwrapEvents(eventsData.depsUnwrapEvents),
      this.persistSavingsSavedEvents(eventsData.savingsSavedEvents),
      this.persistSavingsInterestCollectedEvents(eventsData.savingsInterestCollectedEvents),
      this.persistSavingsWithdrawnEvents(eventsData.savingsWithdrawnEvents),
      this.persistSavingsRateProposedEvents(eventsData.savingsRateProposedEvents),
      this.persistSavingsRateChangedEvents(eventsData.savingsRateChangedEvents),
      this.persistMintingHubPositionOpenedEvents(eventsData.mintingHubPositionOpenedEvents),
      this.persistRollerRollEvents(eventsData.rollerRollEvents),
    ];

    await Promise.all(operations);
  }
}

export const eventPersistence = new EventPersistence();
