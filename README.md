# Sea Battle MVP

Deterministic auto-battler MVP with Phaser 3 rendering and HTML/CSS overlay UI.

## Stack
- Frontend: Vite + React + TypeScript + Phaser 3
- Wallets: disabled in local MVP (guest login)
- Backend: Cloudflare Workers + D1 (SQLite)
- Shared: typed config and logic in `shared/`

## Local Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure API base URL:
   - Create `frontend/.env.local` with:
     ```
     VITE_API_BASE_URL=http://localhost:8787
     ```
3. Initialize D1 database (local):
   ```bash
   npx wrangler d1 create sea-battle
   npx wrangler d1 execute sea-battle --local --file=./api/schema.sql
   ```
4. Start both frontend and API:
   ```bash
   npm run dev
   ```
5. Open `http://localhost:5173`.

## Deploy
1. Create a D1 database and update `api/wrangler.toml` with the real `database_id`.
2. Set `VITE_API_BASE_URL` in your frontend build environment to your Worker URL.
3. Deploy API:
   ```bash
   npx wrangler deploy
   ```
4. Build and deploy frontend (Vercel/Netlify/Cloudflare Pages):
   ```bash
   npm run build -w frontend
   ```

## Notes
- The server is authoritative for match outcomes, rewards, and daily limits.
- Request signatures use wallet message signing with a nonce.
- Idempotency keys are required for match resolution and chest opening.
