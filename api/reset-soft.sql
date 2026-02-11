-- Soft reset:
-- 1) Clears ranking progress (points/wins/matches/streaks)
-- 2) Removes verified MON payments so wallets must pay again
-- 3) Keeps users/inventory/base/chests and other progression data

UPDATE leaderboard_stats
SET
  points = 0,
  wins = 0,
  matches = 0,
  win_streak = 0,
  best_streak = 0,
  updated_at = datetime('now');

DELETE FROM entry_payments;
