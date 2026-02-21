CREATE TABLE IF NOT EXISTS users (
  address TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  has_onboarded INTEGER NOT NULL DEFAULT 0,
  heroes_json TEXT NOT NULL DEFAULT '[]',
  upgrades_json TEXT NOT NULL DEFAULT '{"piercingLevel":0}',
  last_active TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nonces (
  address TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_limits (
  address TEXT NOT NULL,
  day_key TEXT NOT NULL,
  matches_played INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (address, day_key)
);

CREATE TABLE IF NOT EXISTS match_bank (
  address TEXT PRIMARY KEY,
  matches_available INTEGER NOT NULL DEFAULT 5,
  last_day_key TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_matches (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  hero TEXT NOT NULL,
  opponent_id TEXT NOT NULL,
  opponent_hero TEXT NOT NULL,
  opponent_upgrades TEXT NOT NULL,
  weather_id TEXT NOT NULL,
  server_seed TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chests (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  type TEXT NOT NULL,
  match_id TEXT,
  rewards_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  opened_at TEXT
);

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT NOT NULL,
  address TEXT NOT NULL,
  route TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (key, address, route)
);

CREATE TABLE IF NOT EXISTS projections (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  hero TEXT NOT NULL,
  lineup_json TEXT NOT NULL DEFAULT '[]',
  weather_id TEXT NOT NULL DEFAULT '',
  upgrades_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projections_weather ON projections (weather_id);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  address TEXT,
  event TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  ip TEXT
);

CREATE TABLE IF NOT EXISTS leaderboard_stats (
  address TEXT PRIMARY KEY,
  wins INTEGER NOT NULL DEFAULT 0,
  matches INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 0,
  pearls INTEGER NOT NULL DEFAULT 0,
  shards INTEGER NOT NULL DEFAULT 0,
  win_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  hero TEXT NOT NULL,
  slot TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS equipped_items (
  address TEXT NOT NULL,
  hero TEXT NOT NULL,
  slot TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (address, hero, slot)
);

CREATE TABLE IF NOT EXISTS daily_chest_claims (
  address TEXT NOT NULL,
  day_key TEXT NOT NULL,
  streak_day INTEGER NOT NULL DEFAULT 1,
  rewards_json TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  PRIMARY KEY (address, day_key)
);

CREATE TABLE IF NOT EXISTS base_buildings (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  building_type TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  last_collected_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entry_payments (
  tx_hash TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  amount_wei TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  verified_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS base_state_blobs (
  address TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token);
CREATE INDEX IF NOT EXISTS idx_daily_limits_address_day ON daily_limits (address, day_key);
CREATE INDEX IF NOT EXISTS idx_match_bank_address ON match_bank (address);
CREATE INDEX IF NOT EXISTS idx_chests_address ON chests (address);
CREATE INDEX IF NOT EXISTS idx_inventory_address ON inventory_items (address);
CREATE INDEX IF NOT EXISTS idx_inventory_address_artifact ON inventory_items (address, artifact_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_address_artifact ON inventory_items (address, artifact_id);
CREATE INDEX IF NOT EXISTS idx_pending_matches_address ON pending_matches (address);
CREATE INDEX IF NOT EXISTS idx_base_buildings_address ON base_buildings (address);
CREATE INDEX IF NOT EXISTS idx_daily_chest_address ON daily_chest_claims (address);
CREATE INDEX IF NOT EXISTS idx_entry_payments_address ON entry_payments (address);
