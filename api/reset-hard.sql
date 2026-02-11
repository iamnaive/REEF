-- Hard reset:
-- Removes almost all gameplay/account data and payment history.
-- Use only when you want to relaunch from an almost clean state.

DELETE FROM sessions;
DELETE FROM nonces;
DELETE FROM rate_limits;
DELETE FROM idempotency;
DELETE FROM logs;

DELETE FROM pending_matches;
DELETE FROM chests;
DELETE FROM projections;
DELETE FROM match_bank;
DELETE FROM daily_chest_claims;
DELETE FROM base_buildings;

DELETE FROM equipped_items;
DELETE FROM inventory_items;

DELETE FROM entry_payments;
DELETE FROM leaderboard_stats;
DELETE FROM users;
