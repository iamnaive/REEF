# Sea Battle MVP

## D1 reset scripts

Use these from `api` directory:

- Soft reset (clear leaderboard progress + clear MON payment confirmations):
  - `wrangler d1 execute sea-battle --remote --file=./reset-soft.sql`
- Hard reset (wipe almost all game/account data):
  - `wrangler d1 execute sea-battle --remote --file=./reset-hard.sql`

Verify after reset:

- `wrangler d1 execute sea-battle --remote --command "SELECT COUNT(*) AS lb_rows FROM leaderboard_stats; SELECT COUNT(*) AS paid_rows FROM entry_payments;"`
