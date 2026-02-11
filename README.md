# Sea Battle MVP

Deterministic auto-battler MVP with Phaser 3 rendering and HTML/CSS overlay UI.

## Stack
- Frontend: Vite + React + TypeScript + Phaser 3
- Wallets: Reown/WalletConnect + injected EVM wallets
- Backend: Cloudflare Workers + D1 (SQLite)
- Shared: typed config and logic in `shared/`

## Local Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure frontend env (`frontend/.env.local`):
   ```
   VITE_API_BASE_URL=http://localhost:8787
   VITE_REOWN_PROJECT_ID=ea1688ed805d32b8ce09143baba1b155
   VITE_MONAD_CHAIN_ID_HEX=0x8f
   VITE_MONAD_CHAIN_NAME=Monad Mainnet
   VITE_MONAD_RPC_URL=<your_monad_rpc>
   VITE_ENTRY_FEE_MON=0.01
   ```
3. Configure API env:
   - In `api/wrangler.toml` (or Wrangler secrets/vars), set:
   ```
   API_ENV=local
   MONAD_RPC_URL=<your_monad_rpc>
   ```
4. Initialize D1 database (local):
   ```bash
   npx wrangler d1 create sea-battle
   npx wrangler d1 execute sea-battle --local --file=./api/schema.sql
   ```
5. Start both frontend and API:
   ```bash
   npm run dev
   ```
6. Open `http://localhost:5173`.

## Deploy
1. Create a D1 database and update `api/wrangler.toml` with the real `database_id`.
2. Set frontend build env vars:
   - `VITE_API_BASE_URL`
   - `VITE_REOWN_PROJECT_ID`
   - `VITE_MONAD_CHAIN_ID_HEX`
   - `VITE_MONAD_CHAIN_NAME`
   - `VITE_MONAD_RPC_URL`
   - `VITE_ENTRY_FEE_MON`
3. Set API vars:
   - `API_ENV=production`
   - `MONAD_RPC_URL=<your_monad_rpc>`
4. Deploy API:
   ```bash
   npx wrangler deploy
   ```
5. Build and deploy frontend (Vercel/Netlify/Cloudflare Pages):
   ```bash
   npm run build -w frontend
   ```

## Notes
- The server is authoritative for match outcomes, rewards, and match bank limits.
- Request signatures use wallet message signing with a nonce.
- Idempotency keys are required for match resolution and chest opening.
- Entry to the game is gated by an on-chain payment tx verification.
