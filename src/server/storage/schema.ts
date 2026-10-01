import type { SchemaMigration } from './types.ts';

export const SCHEMA_VERSION = 5;

export const INITIAL_MIGRATION_SQL = `
-- Schema Migrations Table
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Hubs Table
CREATE TABLE IF NOT EXISTS hubs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  system_name TEXT NOT NULL,
  is_system_default BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TEXT NOT NULL
);

-- Hub Location Mappings Table
CREATE TABLE IF NOT EXISTS hub_location_mappings (
  location_id BIGINT PRIMARY KEY,
  location_name TEXT NOT NULL,
  hub_id TEXT NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL
);

-- Wallet Transactions Table
CREATE TABLE IF NOT EXISTS transactions (
  character_id BIGINT NOT NULL,
  transaction_id BIGINT NOT NULL,
  type_id INTEGER NOT NULL,
  type_name TEXT,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(20, 2) NOT NULL,
  total_value NUMERIC(20, 2) NOT NULL,
  is_buy BOOLEAN NOT NULL,
  is_personal BOOLEAN NOT NULL DEFAULT TRUE,
  location_id BIGINT NOT NULL,
  location_name TEXT,
  client_id BIGINT NOT NULL,
  client_name TEXT,
  date TEXT NOT NULL,
  journal_ref_id BIGINT,
  observed_at BIGINT NOT NULL,
  tax NUMERIC(20, 2),
  broker_fee NUMERIC(20, 2),
  net_value NUMERIC(20, 2),
  PRIMARY KEY (character_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_tx_char_date ON transactions (character_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions (type_id);
CREATE INDEX IF NOT EXISTS idx_tx_loc ON transactions (location_id);
CREATE INDEX IF NOT EXISTS idx_tx_char_type_date ON transactions (character_id, type_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_tx_char_loc_date ON transactions (character_id, location_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_tx_char_type_loc ON transactions (character_id, type_id, location_id);
CREATE INDEX IF NOT EXISTS idx_tx_isbuy_type ON transactions (is_buy, type_id);

-- Wallet Journal Entries Table
CREATE TABLE IF NOT EXISTS journal_entries (
  character_id BIGINT NOT NULL,
  journal_id BIGINT NOT NULL,
  date TEXT NOT NULL,
  ref_type TEXT NOT NULL,
  amount NUMERIC(20, 2) NOT NULL,
  balance NUMERIC(20, 2),
  description TEXT,
  first_party_id BIGINT,
  first_party_name TEXT,
  second_party_id BIGINT,
  second_party_name TEXT,
  reason TEXT,
  tax_receiver_id BIGINT,
  tax NUMERIC(20, 2),
  context_id BIGINT,
  context_id_type TEXT,
  observed_at BIGINT NOT NULL,
  PRIMARY KEY (character_id, journal_id)
);

CREATE INDEX IF NOT EXISTS idx_jn_char_date ON journal_entries (character_id, date);
CREATE INDEX IF NOT EXISTS idx_jn_ref ON journal_entries (ref_type);
CREATE INDEX IF NOT EXISTS idx_jn_context ON journal_entries (context_id);

-- Market Order Snapshots Table
CREATE TABLE IF NOT EXISTS order_snapshots (
  character_id BIGINT NOT NULL,
  order_id BIGINT NOT NULL,
  type_id INTEGER NOT NULL,
  type_name TEXT,
  region_id INTEGER NOT NULL,
  location_id BIGINT NOT NULL,
  location_name TEXT,
  price NUMERIC(20, 2) NOT NULL,
  volume_total INTEGER NOT NULL,
  volume_remain INTEGER NOT NULL,
  volume_filled INTEGER NOT NULL,
  is_buy_order BOOLEAN NOT NULL,
  duration INTEGER NOT NULL,
  escrow NUMERIC(20, 2),
  issued TEXT NOT NULL,
  range TEXT NOT NULL,
  min_volume INTEGER,
  state TEXT NOT NULL,
  state_justification TEXT,
  is_active_in_current_snapshot BOOLEAN NOT NULL,
  first_observed_at BIGINT NOT NULL,
  last_observed_at BIGINT NOT NULL,
  last_snapshot_volume_remain INTEGER,
  in_stock_quantity INTEGER,
  PRIMARY KEY (character_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_char_state ON order_snapshots (character_id, state);
CREATE INDEX IF NOT EXISTS idx_orders_type ON order_snapshots (type_id);
CREATE INDEX IF NOT EXISTS idx_orders_loc ON order_snapshots (location_id);

-- Restock List Items Table
CREATE TABLE IF NOT EXISTS restock_items (
  id TEXT PRIMARY KEY,
  character_id BIGINT NOT NULL,
  type_id INTEGER NOT NULL,
  type_name TEXT NOT NULL,
  target_buy_hub_id TEXT NOT NULL,
  target_buy_hub_name TEXT NOT NULL,
  sell_hub_id TEXT NOT NULL,
  sell_hub_name TEXT NOT NULL,
  suggested_quantity INTEGER NOT NULL,
  target_quantity INTEGER NOT NULL,
  estimated_buy_unit_price NUMERIC(20, 2) NOT NULL,
  status TEXT NOT NULL,
  justification TEXT,
  linked_order_id BIGINT,
  notes TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_restock_char ON restock_items (character_id);
CREATE INDEX IF NOT EXISTS idx_restock_status ON restock_items (status);

-- Explicit Cost Allocations Table
CREATE TABLE IF NOT EXISTS explicit_cost_allocations (
  id TEXT PRIMARY KEY,
  character_id BIGINT NOT NULL,
  buy_character_id BIGINT,
  sell_character_id BIGINT,
  sell_transaction_id BIGINT NOT NULL,
  buy_transaction_id BIGINT,
  opening_balance_id TEXT,
  source_type TEXT NOT NULL DEFAULT 'TRANSACTION',
  type_id INTEGER NOT NULL,
  type_name TEXT NOT NULL,
  quantity_allocated INTEGER NOT NULL,
  unit_cost_isk NUMERIC(20, 2) NOT NULL,
  unit_sale_price_isk NUMERIC(20, 2) NOT NULL,
  allocated_buy_broker_fee_isk NUMERIC(20, 2) NOT NULL DEFAULT 0,
  allocated_sell_broker_fee_isk NUMERIC(20, 2) NOT NULL DEFAULT 0,
  allocated_sales_tax_isk NUMERIC(20, 2) NOT NULL DEFAULT 0,
  reconciliation_mode TEXT NOT NULL,
  allocated_at TEXT NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_alloc_char ON explicit_cost_allocations (character_id);
CREATE INDEX IF NOT EXISTS idx_alloc_buy_tx ON explicit_cost_allocations (buy_transaction_id);
CREATE INDEX IF NOT EXISTS idx_alloc_sell_tx ON explicit_cost_allocations (sell_transaction_id);

-- Opening Balance Lots Table
CREATE TABLE IF NOT EXISTS opening_balances (
  id TEXT PRIMARY KEY,
  character_id BIGINT NOT NULL,
  type_id INTEGER NOT NULL,
  type_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  allocated_quantity INTEGER NOT NULL DEFAULT 0,
  remaining_quantity INTEGER NOT NULL,
  unit_cost_isk NUMERIC(20, 2) NOT NULL,
  total_cost_isk NUMERIC(20, 2) NOT NULL,
  location_id BIGINT NOT NULL,
  location_name TEXT,
  hub_id TEXT NOT NULL,
  hub_name TEXT NOT NULL,
  acquisition_date TEXT NOT NULL,
  justification TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_opening_char ON opening_balances (character_id);
CREATE INDEX IF NOT EXISTS idx_opening_type ON opening_balances (type_id);

-- Character Assets Table
CREATE TABLE IF NOT EXISTS character_assets (
  id TEXT PRIMARY KEY,
  character_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  type_id INTEGER NOT NULL,
  type_name TEXT,
  quantity INTEGER NOT NULL,
  location_id BIGINT NOT NULL,
  location_name TEXT,
  location_type TEXT NOT NULL,
  location_flag TEXT NOT NULL,
  is_singleton BOOLEAN NOT NULL,
  is_corp_asset BOOLEAN NOT NULL DEFAULT FALSE,
  corporation_id BIGINT,
  source TEXT NOT NULL DEFAULT 'esi',
  observed_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_char ON character_assets (character_id);
CREATE INDEX IF NOT EXISTS idx_assets_type ON character_assets (type_id);
CREATE INDEX IF NOT EXISTS idx_assets_loc ON character_assets (location_id);

-- Sync States Table
CREATE TABLE IF NOT EXISTS sync_states (
  character_id BIGINT NOT NULL,
  resource TEXT NOT NULL,
  status TEXT NOT NULL,
  coverage_status TEXT,
  has_more BOOLEAN DEFAULT FALSE,
  items_count INTEGER DEFAULT 0,
  last_sync_started_at BIGINT,
  last_sync_completed_at BIGINT,
  last_cursor_from_id BIGINT,
  last_page_processed INTEGER,
  total_records INTEGER NOT NULL DEFAULT 0,
  new_records_in_last_sync INTEGER NOT NULL DEFAULT 0,
  last_error_message TEXT,
  as_of BIGINT NOT NULL,
  PRIMARY KEY (character_id, resource)
);
`;

export const MIGRATIONS: SchemaMigration[] = [
  {
    version: 1,
    name: '001_initial_relational_schema',
    upSql: INITIAL_MIGRATION_SQL,
  },
  {
    version: 2,
    name: '002_opening_balances_table',
    upSql: `
      CREATE TABLE IF NOT EXISTS opening_balances (
        id TEXT PRIMARY KEY,
        character_id BIGINT NOT NULL,
        type_id INTEGER NOT NULL,
        type_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        allocated_quantity INTEGER NOT NULL DEFAULT 0,
        remaining_quantity INTEGER NOT NULL,
        unit_cost_isk NUMERIC(20, 2) NOT NULL,
        total_cost_isk NUMERIC(20, 2) NOT NULL,
        location_id BIGINT NOT NULL,
        location_name TEXT,
        hub_id TEXT NOT NULL,
        hub_name TEXT NOT NULL,
        acquisition_date TEXT NOT NULL,
        justification TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_opening_char ON opening_balances (character_id);
      CREATE INDEX IF NOT EXISTS idx_opening_type ON opening_balances (type_id);
    `,
  },
  {
    version: 3,
    name: '003_relational_performance_indexes',
    upSql: `
      CREATE INDEX IF NOT EXISTS idx_alloc_sell_buy ON explicit_cost_allocations (sell_transaction_id, buy_transaction_id);
      CREATE INDEX IF NOT EXISTS idx_tx_char_date_desc ON transactions (character_id, date DESC);
    `,
  },
  {
    version: 4,
    name: '004_sync_states_checkpoints_and_coverage',
    upSql: `
      ALTER TABLE sync_states ADD COLUMN IF NOT EXISTS coverage_status TEXT;
      ALTER TABLE sync_states ADD COLUMN IF NOT EXISTS has_more BOOLEAN DEFAULT FALSE;
      ALTER TABLE sync_states ADD COLUMN IF NOT EXISTS items_count INTEGER DEFAULT 0;
    `,
  },
  {
    version: 5,
    name: '005_business_calc_optimizations',
    upSql: `
      CREATE INDEX IF NOT EXISTS idx_tx_char_type_date ON transactions (character_id, type_id, date DESC);
      CREATE INDEX IF NOT EXISTS idx_tx_char_loc_date ON transactions (character_id, location_id, date DESC);
      CREATE INDEX IF NOT EXISTS idx_tx_char_type_loc ON transactions (character_id, type_id, location_id);
      CREATE INDEX IF NOT EXISTS idx_tx_isbuy_type ON transactions (is_buy, type_id);
    `,
  },
];
