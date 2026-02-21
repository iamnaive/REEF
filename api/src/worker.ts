import { Router } from "itty-router";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createPublicClient, http, isAddress, verifyMessage } from "viem";
import {
  HEROES,
  WEATHER,
  HeroType,
  MatchResult,
  OpponentProfile,
  RewardPayload,
  WeatherDef,
  MATCH_LIMIT_PER_DAY,
  ResourceTotals,
  LeaderboardEntry,
  UpgradeState,
  ARTIFACTS,
  ArtifactDef,
  InventoryItem,
  InventoryState,
  EquippedSlots,
  BUILDINGS,
  BuildingType,
  PlayerBuilding,
  BaseState,
  DAILY_CHEST_TIERS,
  DailyChestState
} from "@shared/types";
import { clampChance, getMatchupBonus, getMatchupState, getWeatherBonus, SYNERGY_BONUS } from "@shared/logic";

type Env = {
  DB: D1Database;
  API_ENV: string;
  MONAD_RPC_URL?: string;
  ENTRY_RECEIVER?: string;
  ENTRY_FEE_WEI?: string;
  POOL_BASE_WEI?: string;
};

const router = Router();
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
};

const RATE_LIMIT_PER_MIN = 60;
const NONCE_TTL_MS = 5 * 60 * 1000;
const MATCH_BANK_DAY_CAP = 3;
const MATCH_BANK_MAX = MATCH_LIMIT_PER_DAY * MATCH_BANK_DAY_CAP;
const MAX_RECENT_PROJECTIONS_PER_WEATHER = 20;
const BASE_BLOB_MAX_CHARS = 200_000;
const BASE_BLOB_WRITE_COOLDOWN_MS = 2_000;
const baseBlobWriteGuard = new Map<string, number>();
router.options("*", () => new Response(null, { headers: CORS_HEADERS }));

router.get("/api/health", () => json({ ok: true }));

router.get("/api/leaderboard", async (request: Request, env: Env) => {
  await ensureLeaderboardTable(env);

  // Top 10 by points
  const topRows = await env.DB.prepare(
    "SELECT address, wins, matches, points, best_streak, updated_at FROM leaderboard_stats ORDER BY points DESC, wins DESC, updated_at DESC LIMIT 10"
  ).all<{
    address: string;
    wins: number;
    matches: number;
    points: number;
    best_streak: number;
    updated_at: string;
  }>();

  // Total participant count
  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) as total FROM leaderboard_stats WHERE matches > 0"
  ).first<{ total: number }>();
  const totalPlayers = countRow?.total || 0;

  const entries: LeaderboardEntry[] = topRows.results.map((row, idx) => ({
    rank: idx + 1,
    address: row.address,
    wins: row.wins,
    matches: row.matches,
    points: row.points || 0,
    bestStreak: row.best_streak || 0,
    updatedAt: row.updated_at
  }));

  // Check if caller is authenticated and get their rank if outside top 10
  let myEntry: LeaderboardEntry | null = null;
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (token) {
    const session = await env.DB.prepare(
      "SELECT address FROM sessions WHERE token = ?"
    ).bind(token).first<{ address: string }>();
    if (session) {
      const inTop = entries.some(e => e.address === session.address);
      if (!inTop) {
        // Get their rank via counting how many have more points
        const rankRow = await env.DB.prepare(
          "SELECT COUNT(*) + 1 as rank FROM leaderboard_stats WHERE points > (SELECT COALESCE(points, 0) FROM leaderboard_stats WHERE address = ?)"
        ).bind(session.address).first<{ rank: number }>();
        const myRow = await env.DB.prepare(
          "SELECT address, wins, matches, points, best_streak, updated_at FROM leaderboard_stats WHERE address = ?"
        ).bind(session.address).first<{
          address: string;
          wins: number;
          matches: number;
          points: number;
          best_streak: number;
          updated_at: string;
        }>();
        if (myRow) {
          myEntry = {
            rank: rankRow?.rank || totalPlayers,
            address: myRow.address,
            wins: myRow.wins,
            matches: myRow.matches,
            points: myRow.points || 0,
            bestStreak: myRow.best_streak || 0,
            updatedAt: myRow.updated_at
          };
        }
      }
    }
  }

  return json({ entries, totalPlayers, myEntry });
});

router.get("/api/shop", async (_request: Request) => {
  return json({ artifacts: ARTIFACTS });
});

router.get("/api/inventory", async (request: Request, env: Env) => {
  const auth = await requirePaidAuth(request, env);
  if (!auth) return json({ error: "Payment required" }, 402);
  const inventory = await getInventoryState(env, auth.address);
  return json(inventory);
});

router.post("/api/shop/buy", async (request: Request, env: Env) => {
  const auth = await requirePaidAuth(request, env);
  if (!auth) return json({ error: "Payment required" }, 402);

  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!idempotencyKey) return json({ error: "Idempotency key required" }, 400);

  const cached = await getIdempotent(env, auth.address, "/api/shop/buy", idempotencyKey);
  if (cached) return json(cached);

  const body = await readBody(request);
  const schema = z.object({ artifactId: z.string() });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid payload" }, 400);

  const artifact = ARTIFACTS.find((item) => item.id === parsed.data.artifactId);
  if (!artifact) return json({ error: "Artifact not found" }, 404);

  await ensureLeaderboardTable(env);
  await ensureInventoryTables(env);

  const now = new Date().toISOString();
  const itemId = nanoid(12);
  const debit = await env.DB.prepare(
    "UPDATE leaderboard_stats SET coins = coins - ?, updated_at = ? WHERE address = ? AND coins >= ?"
  ).bind(artifact.cost.coins, now, auth.address, artifact.cost.coins).run();
  if ((debit.meta.changes || 0) !== 1) {
    return json({ error: "Not enough coins" }, 400);
  }

  const insert = await env.DB.prepare(
    "INSERT INTO inventory_items (id, address, artifact_id, hero, slot, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(address, artifact_id) DO NOTHING"
  ).bind(itemId, auth.address, artifact.id, artifact.hero, artifact.slot, now).run();
  if ((insert.meta.changes || 0) !== 1) {
    // Another concurrent request already bought this item; refund this debit.
    await env.DB.prepare(
      "UPDATE leaderboard_stats SET coins = coins + ?, updated_at = ? WHERE address = ?"
    ).bind(artifact.cost.coins, now, auth.address).run();
    return json({ error: "Already owned" }, 409);
  }

  const updatedResources = await getResources(env, auth.address);

  const response = {
    item: {
      id: itemId,
      artifactId: artifact.id,
      hero: artifact.hero,
      slot: artifact.slot,
      acquiredAt: now
    },
    resources: updatedResources
  };

  await saveIdempotent(env, auth.address, "/api/shop/buy", idempotencyKey, response);
  await logEvent(env, auth.address, "shop_buy", { artifactId: artifact.id }, request);

  return json(response);
});

router.post("/api/inventory/equip", async (request: Request, env: Env) => {
  const auth = await requirePaidAuth(request, env);
  if (!auth) return json({ error: "Payment required" }, 402);
  const body = await readBody(request);
  const schema = z.object({ artifactId: z.string() });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid payload" }, 400);

  await ensureInventoryTables(env);

  const owned = await env.DB.prepare(
    "SELECT id, artifact_id, hero, slot FROM inventory_items WHERE address = ? AND artifact_id = ?"
  )
    .bind(auth.address, parsed.data.artifactId)
    .first<{ id: string; artifact_id: string; hero: HeroType; slot: string }>();

  if (!owned) return json({ error: "Artifact not owned" }, 404);

  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO equipped_items (address, hero, slot, artifact_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(address, hero, slot) DO UPDATE SET artifact_id = excluded.artifact_id, updated_at = excluded.updated_at"
  )
    .bind(auth.address, owned.hero, owned.slot, owned.artifact_id, now)
    .run();

  const inventory = await getInventoryState(env, auth.address);
  await logEvent(env, auth.address, "inventory_equip", { artifactId: owned.artifact_id }, request);

  return json(inventory);
});


router.post("/api/guest", async (request: Request, env: Env) => {
  await ensureCoreTables(env);
  if (env.API_ENV !== "local") return json({ error: "Not allowed" }, 403);
  const token = nanoid(32);
  const address = `guest_${nanoid(10)}`;
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  await env.DB.prepare(
    "INSERT INTO sessions (token, address, created_at, expires_at) VALUES (?, ?, ?, ?)"
  )
    .bind(token, address, now, expires)
    .run();

  await env.DB.prepare(
    "INSERT INTO users (address, created_at, has_onboarded, heroes_json, upgrades_json, last_active) VALUES (?, ?, 0, '[]', '{\"piercingLevel\":0}', ?) ON CONFLICT(address) DO UPDATE SET last_active = excluded.last_active"
  )
    .bind(address, now, now)
    .run();

  await logEvent(env, address, "guest_login", { address }, request);

  return json({ token, address });
});

router.post("/api/dev/reset-daily", async (request: Request, env: Env) => {
  const auth = await requireAuth(request, env);
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const host = new URL(request.url).hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  if (env.API_ENV !== "local" || !isLocalHost) return json({ error: "Not allowed" }, 403);

  await ensureMatchBankTable(env);
  await env.DB.prepare(
    "INSERT INTO match_bank (address, matches_available, last_day_key, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(address) DO UPDATE SET matches_available = excluded.matches_available, last_day_key = excluded.last_day_key, updated_at = excluded.updated_at"
  )
    .bind(auth.address, MATCH_LIMIT_PER_DAY, getDayKey(), new Date().toISOString())
    .run();

  const { matchesLeft, resetAt } = await getDailyLimit(env, auth.address);
  await logEvent(env, auth.address, "dev_reset_daily", { matchesLeft }, request);

  return json({ matchesLeft, resetAt });
});

router.get("/api/nonce", async (request: Request, env: Env) => {
  await ensureCoreTables(env);
  const url = new URL(request.url);
  const address = url.searchParams.get("address") || "";
  if (!isAddress(address)) return json({ error: "Invalid address" }, 400);
  const nonce = nanoid(16);
  const message = `Login to Sea Battle MVP. Nonce: ${nonce}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO nonces (address, nonce, created_at) VALUES (?, ?, ?) ON CONFLICT(address) DO UPDATE SET nonce = excluded.nonce, created_at = excluded.created_at"
  )
    .bind(address, nonce, now)
    .run();
  return json({ nonce, message });
});

router.post("/api/login", async (request: Request, env: Env) => {
  await ensureCoreTables(env);
  const rate = await enforceRateLimit(request, env);
  if (rate) return rate;
  const body = await readBody(request);
  const schema = z.object({
    address: z.string(),
    signature: z.string()
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid payload" }, 400);
  const { address, signature } = parsed.data;
  if (!isAddress(address)) return json({ error: "Invalid address" }, 400);

  const nonceRow = await env.DB.prepare(
    "SELECT nonce, created_at FROM nonces WHERE address = ?"
  )
    .bind(address)
    .first<{ nonce: string; created_at: string }>();
  if (!nonceRow?.nonce) return json({ error: "Nonce not found" }, 400);
  const nonceAgeMs = Date.now() - new Date(nonceRow.created_at).getTime();
  if (!Number.isFinite(nonceAgeMs) || nonceAgeMs > NONCE_TTL_MS) {
    await env.DB.prepare("DELETE FROM nonces WHERE address = ?").bind(address).run();
    return json({ error: "Nonce expired" }, 400);
  }

  const message = `Login to Sea Battle MVP. Nonce: ${nonceRow.nonce}`;
  const valid = await verifyMessage({ address, message, signature });
  if (!valid) return json({ error: "Invalid signature" }, 401);

  const token = nanoid(32);
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  await env.DB.prepare(
    "INSERT INTO sessions (token, address, created_at, expires_at) VALUES (?, ?, ?, ?)"
  )
    .bind(token, address, now, expires)
    .run();
  await env.DB.prepare(
    "INSERT INTO users (address, created_at, has_onboarded, heroes_json, upgrades_json, last_active) VALUES (?, ?, 0, '[]', '{\"piercingLevel\":0}', ?) ON CONFLICT(address) DO UPDATE SET last_active = excluded.last_active"
  )
    .bind(address, now, now)
    .run();
  await env.DB.prepare("DELETE FROM nonces WHERE address = ?")
    .bind(address)
    .run();

  await logEvent(env, address, "login", { address }, request);

  const entryPaid = await hasVerifiedEntryPayment(env, address);
  return json({ token, address, entryPaid });
});

router.get("/api/entry/status", async (request: Request, env: Env) => {
  const auth = await requireAuth(request, env);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const payment = await getLatestVerifiedEntryPayment(env, auth.address);
  return json({
    paid: Boolean(payment),
    txHash: payment?.txHash || null,
    amountWei: payment?.amountWei || null,
    verifiedAt: payment?.verifiedAt || null
  });
});

router.get("/api/pool", async (_request: Request, env: Env) => {
  const stats = await getPoolStats(env);
  return json(stats);
});

router.post("/api/entry/verify", async (request: Request, env: Env) => {
  const auth = await requireAuth(request, env);
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const body = await readBody(request);
  const schema = z.object({
    txHash: z.string().startsWith("0x"),
    amountWei: z.string().regex(/^[0-9]+$/).optional()
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid payload" }, 400);
  if (!env.MONAD_RPC_URL) return json({ error: "MONAD_RPC_URL is not configured" }, 500);

  await ensureEntryPaymentsTable(env);

  const entryTo = (env.ENTRY_RECEIVER || "0x782EB8568EEa9fC800B625E37A7cE486e92431E1").toLowerCase();
  const txHash = parsed.data.txHash as `0x${string}`;
  let requiredWei: bigint;
  try {
    requiredWei = parseRequiredEntryFeeWei(env);
  } catch (err) {
    return json({ error: (err as Error).message || "ENTRY_FEE_WEI is not configured" }, 500);
  }
  const claimedAddress = auth.address.toLowerCase();

  const existing = await env.DB.prepare(
    "SELECT address FROM entry_payments WHERE tx_hash = ?"
  ).bind(txHash).first<{ address: string }>();
  if (existing?.address && existing.address.toLowerCase() !== claimedAddress) {
    return json({ error: "Transaction hash already used by another player" }, 409);
  }

  const client = createPublicClient({
    transport: http(env.MONAD_RPC_URL)
  });

  let tx: Awaited<ReturnType<typeof client.getTransaction>>;
  let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;
  try {
    tx = await client.getTransaction({ hash: txHash });
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch {
    return json({ error: "Transaction not found yet" }, 400);
  }

  if (receipt.status !== "success") return json({ error: "Transaction failed" }, 400);
  if (!tx.to || tx.to.toLowerCase() !== entryTo) {
    return json({ error: "Transaction recipient mismatch" }, 400);
  }
  if ((tx.from || "").toLowerCase() !== claimedAddress) {
    return json({ error: "Transaction sender mismatch" }, 400);
  }
  if (tx.value < requiredWei) {
    return json({ error: "Transaction amount too low" }, 400);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO entry_payments (tx_hash, address, amount_wei, chain_id, verified_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tx_hash) DO UPDATE SET address = excluded.address, amount_wei = excluded.amount_wei, chain_id = excluded.chain_id, verified_at = excluded.verified_at"
  )
    .bind(txHash, auth.address, tx.value.toString(), Number(tx.chainId || 0), now)
    .run();

  await logEvent(env, auth.address, "entry_payment_verified", { txHash, amountWei: tx.value.toString() }, request);
  return json({ ok: true, txHash, amountWei: tx.value.toString() });
});

router.get("/api/state", async (request: Request, env: Env) => {
  const auth = await requirePaidAuth(request, env);
  if (!auth) return json({ error: "Payment required" }, 402);

  const { address } = auth;
  const user = await env.DB.prepare(
    "SELECT heroes_json, upgrades_json, has_onboarded FROM users WHERE address = ?"
  )
    .bind(address)
    .first<{
      heroes_json: string;
      upgrades_json: string;
      has_onboarded: number;
    }>();

  const { matchesLeft, resetAt } = await getDailyLimit(env, address);
  const resources = await getResources(env, address);
  const dailyChest = await getDailyChestState(env, address);

  return json({
    address,
    heroes: JSON.parse(user?.heroes_json || "[]"),
    upgrades: JSON.parse(user?.upgrades_json || "{\"piercingLevel\":0}"),
    matchesLeft,
    resetAt,
    hasOnboarded: user?.has_onboarded === 1,
    resources,
    dailyChest
  });
});

router.post("/api/onboarding/claim", async (request: Request, env: Env) => {
  const auth = await requirePaidAuth(request, env);
  if (!auth) return json({ error: "Payment required" }, 402);

  const { address } = auth;

  const rewards: RewardPayload = {
    coins: 0,
    pearls: 0,
    shards: 0,
    items: [],
    heroes: ["Shark", "Whale", "Shrimp"]
  };

  const chestId = nanoid(12);
  const now = new Date().toISOString();
  const claim = await env.DB.prepare(
    "UPDATE users SET has_onboarded = 1, heroes_json = ?, last_active = ? WHERE address = ? AND has_onboarded = 0"
  )
    .bind(JSON.stringify(rewards.heroes), now, address)
    .run();
  if ((claim.meta.changes || 0) !== 1) {
    const chest = await env.DB.prepare(
      "SELECT id, rewards_json FROM chests WHERE address = ? AND type = 'onboarding' ORDER BY created_at DESC LIMIT 1"
    )
      .bind(address)
      .first<{ id: string; rewards_json: string }>();
    if (chest) {
      return json({
        chestId: chest.id,
        rewards: JSON.parse(chest.rewards_json)
      });
    }
    return json({ error: "Already onboarded" }, 409);
  }

  await env.DB.prepare(
    "INSERT INTO chests (id, address, type, rewards_json, created_at) VALUES (?, ?, 'onboarding', ?, ?)"
  )
    .bind(chestId, address, JSON.stringify(rewards), now)
    .run();

  await applyRewards(env, address, rewards);
  await logEvent(env, address, "onboarding_claim", { chestId }, request);

  return json({ chestId, rewards });
});

router.post("/api/match/prepare", async (request: Request, env: Env) => {
  const auth = await requirePaidAuth(request, env);
  if (!auth) return json({ error: "Payment required" }, 402);
  const rate = await enforceRateLimit(request, env);
  if (rate) return rate;

  const body = await readBody(request);
  const schema = z.object({
    heroes: z.array(z.enum(["Shark", "Whale", "Shrimp"])).length(3)
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid payload" }, 400);
  const heroes = parsed.data.heroes as HeroType[];
  const { address } = auth;

  const user = await env.DB.prepare(
    "SELECT heroes_json, upgrades_json FROM users WHERE address = ?"
  )
    .bind(address)
    .first<{ heroes_json: string; upgrades_json: string }>();
  const ownedHeroes = JSON.parse(user?.heroes_json || "[]") as HeroType[];
  if (ownedHeroes.length > 0 && heroes.some((lineHero) => !ownedHeroes.includes(lineHero))) {
    return json({ error: "Hero not owned" }, 403);
  }

  const { matchesLeft, resetAt } = await getDailyLimit(env, address);
  if (matchesLeft <= 0) {
    return json({ error: "Daily limit reached", matchesLeft, resetAt }, 429);
  }

  const existing = await env.DB.prepare(
    "SELECT * FROM pending_matches WHERE address = ? ORDER BY created_at DESC LIMIT 1"
  )
    .bind(address)
    .first<{
      id: string;
      hero: string;
      opponent_id: string;
      opponent_hero: string;
      opponent_upgrades: string;
      weather_id: string;
      server_seed: string;
      created_at: string;
    }>();

  if (existing) {
    const ageMs = Date.now() - new Date(existing.created_at).getTime();
    if (ageMs < 10 * 60 * 1000) {
      await env.DB.prepare("UPDATE pending_matches SET hero = ? WHERE id = ?")
        .bind(JSON.stringify(heroes), existing.id)
        .run();

      const weather = WEATHER.find((w) => w.id === existing.weather_id);
      if (weather) {
        const opponentLineup = buildOpponentLineup(
          existing.opponent_id,
          existing.opponent_hero,
          existing.opponent_upgrades
        );

        return json({
          matchId: existing.id,
          weather,
          playerLineup: heroes,
          opponentLineup,
          matchesLeft,
          resetAt
        });
      }
    }
  }

  await ensureSeedProjections(env);
  const serverSeed = nanoid(16);
  const rng = createRng(`${serverSeed}:${address}`);

  const weather = WEATHER[Math.floor(rng() * WEATHER.length)];
  const opponentLineup = await pickOpponentLineup(env, rng, 3, weather.id);

  const matchId = nanoid(12);
  const now = new Date().toISOString();

  const opponentIds = opponentLineup.map((opp) => opp.id);
  const opponentHeroes = opponentLineup.map((opp) => opp.hero);
  const opponentUpgrades = opponentLineup.map((opp) => opp.upgrades);

  await env.DB.prepare(
    "INSERT INTO pending_matches (id, address, hero, opponent_id, opponent_hero, opponent_upgrades, weather_id, server_seed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      matchId,
      address,
      JSON.stringify(heroes),
      JSON.stringify(opponentIds),
      JSON.stringify(opponentHeroes),
      JSON.stringify(opponentUpgrades),
      weather.id,
      serverSeed,
      now
    )
    .run();

  await logEvent(env, address, "match_prepare", { matchId, heroes }, request);

  return json({
    matchId,
    weather,
    playerLineup: heroes,
    opponentLineup,
    matchesLeft,
    resetAt
  });
});

router.post("/api/match/resolve", async (request: Request, env: Env) => {
  const auth = await requirePaidAuth(request, env);
  if (!auth) return json({ error: "Payment required" }, 402);
  const rate = await enforceRateLimit(request, env);
  if (rate) return rate;

  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!idempotencyKey) return json({ error: "Idempotency key required" }, 400);

  const cached = await getIdempotent(env, auth.address, "/api/match/resolve", idempotencyKey);
  if (cached) return json(cached);

  const body = await readBody(request);
  const schema = z.object({ matchId: z.string() });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid payload" }, 400);

  const match = await env.DB.prepare(
    "SELECT * FROM pending_matches WHERE id = ? AND address = ?"
  )
    .bind(parsed.data.matchId, auth.address)
    .first<{
      id: string;
      hero: string;
      opponent_id: string;
      opponent_hero: string;
      opponent_upgrades: string;
      weather_id: string;
      server_seed: string;
    }>();
  if (!match) return json({ error: "Match not found" }, 404);

  const { matchesLeft, resetAt } = await getDailyLimit(env, auth.address);
  if (matchesLeft <= 0) {
    return json({ error: "Daily limit reached", matchesLeft, resetAt }, 429);
  }

  const weather = WEATHER.find((w) => w.id === match.weather_id) as WeatherDef;
  const playerLineup = parseHeroLineup(match.hero);
  const opponentLineup = buildOpponentLineup(
    match.opponent_id,
    match.opponent_hero,
    match.opponent_upgrades
  );

  const user = await env.DB.prepare(
    "SELECT upgrades_json FROM users WHERE address = ?"
  )
    .bind(auth.address)
    .first<{ upgrades_json: string }>();
  const upgrades = JSON.parse(user?.upgrades_json || "{\"piercingLevel\":0}");

  // Get player's current win streak for bonus calculations
  const streakRow = await env.DB.prepare(
    "SELECT win_streak FROM leaderboard_stats WHERE address = ?"
  ).bind(auth.address).first<{ win_streak: number }>();
  const streakLevel = streakRow?.win_streak || 0;

  const rng = createRng(`${match.server_seed}:${match.id}`);
  const rounds: Array<{
    playerHero: HeroType;
    opponentHero: HeroType;
    result: MatchResult;
  }> = [];
  let playerIndex = 0;
  let opponentIndex = 0;

  while (playerIndex < playerLineup.length && opponentIndex < opponentLineup.length) {
    const playerHero = playerLineup[playerIndex];
    const opponentHero = opponentLineup[opponentIndex].hero;
    const baseChance = computeWinChance(playerHero, opponentHero, weather, upgrades);
    const equipped = await getEquippedForHero(env, auth.address, playerHero);
    const artifactBonus = getArtifactBonus(equipped, opponentHero);
    const chance = clampChance(baseChance + artifactBonus, 0.20, 0.85);
    const win = rng() < chance;
    rounds.push({
      playerHero,
      opponentHero,
      result: win ? "win" : "lose"
    });
    if (win) {
      opponentIndex += 1;
    } else {
      playerIndex += 1;
    }
  }

  const result: MatchResult =
    opponentIndex >= opponentLineup.length ? "win" : "lose";

  const rewards = rollRewards(rng, result, streakLevel);
  const chestId = nanoid(12);
  const now = new Date().toISOString();
  const lock = await env.DB.prepare(
    "DELETE FROM pending_matches WHERE id = ? AND address = ?"
  ).bind(match.id, auth.address).run();
  if ((lock.meta.changes || 0) !== 1) {
    return json({ error: "Match already resolved" }, 409);
  }

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO chests (id, address, type, match_id, rewards_json, created_at) VALUES (?, ?, 'match', ?, ?, ?)"
    ).bind(chestId, auth.address, match.id, JSON.stringify(rewards), now),
    env.DB.prepare(
      "INSERT INTO projections (id, address, hero, lineup_json, weather_id, upgrades_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET hero = excluded.hero, lineup_json = excluded.lineup_json, weather_id = excluded.weather_id, upgrades_json = excluded.upgrades_json, updated_at = excluded.updated_at"
    ).bind(
      `${auth.address}:${weather.id}`,
      auth.address,
      playerLineup[0] || "Shark",
      JSON.stringify(playerLineup),
      weather.id,
      JSON.stringify(upgrades),
      now
    )
  ]);
  await trimOldWeatherProjections(env, weather.id, MAX_RECENT_PROJECTIONS_PER_WEATHER);
  await spendMatchFromBank(env, auth.address);

  await updateLeaderboardMatch(env, auth.address, result === "win", streakLevel);

  const { matchesLeft: updatedLeft, resetAt: updatedReset } = await getDailyLimit(
    env,
    auth.address
  );

  const pointsEarned = computePoints(result, streakLevel);
  const response = {
    matchId: match.id,
    result,
    weather,
    playerLineup,
    opponentLineup,
    rounds,
    chestId,
    matchesLeft: updatedLeft,
    resetAt: updatedReset,
    pointsEarned
  };

  await saveIdempotent(env, auth.address, "/api/match/resolve", idempotencyKey, response);
  await logEvent(env, auth.address, "match_resolve", response, request);

  // Gradually remove seed opponents once real players exist
  try { await cleanupSeedProjections(env); } catch { /* non-critical */ }

  return json(response);
});

router.post("/api/chest/open", async (request: Request, env: Env) => {
  const auth = await requirePaidAuth(request, env);
  if (!auth) return json({ error: "Payment required" }, 402);
  const rate = await enforceRateLimit(request, env);
  if (rate) return rate;

  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!idempotencyKey) return json({ error: "Idempotency key required" }, 400);

  const cached = await getIdempotent(env, auth.address, "/api/chest/open", idempotencyKey);
  if (cached) return json(cached);

  const body = await readBody(request);
  const schema = z.object({ chestId: z.string() });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid payload" }, 400);

  const chest = await env.DB.prepare(
    "SELECT rewards_json, opened_at FROM chests WHERE id = ? AND address = ?"
  )
    .bind(parsed.data.chestId, auth.address)
    .first<{ rewards_json: string; opened_at: string | null }>();
  if (!chest) return json({ error: "Chest not found" }, 404);

  if (!chest.opened_at) {
    const opened = await env.DB.prepare(
      "UPDATE chests SET opened_at = ? WHERE id = ? AND address = ? AND opened_at IS NULL"
    )
      .bind(new Date().toISOString(), parsed.data.chestId, auth.address)
      .run();
    if ((opened.meta.changes || 0) === 1) {
      await applyRewards(env, auth.address, JSON.parse(chest.rewards_json) as RewardPayload);
    }
  }

  const response = {
    chestId: parsed.data.chestId,
    rewards: JSON.parse(chest.rewards_json) as RewardPayload
  };

  await saveIdempotent(env, auth.address, "/api/chest/open", idempotencyKey, response);
  await logEvent(env, auth.address, "chest_open", response, request);

  return json(response);
});

/* ── Daily Free Chest ── */

router.get("/api/daily-chest", async (request: Request, env: Env) => {
  const auth = await requirePaidAuth(request, env);
  if (!auth) return json({ error: "Payment required" }, 402);
  const state = await getDailyChestState(env, auth.address);
  return json(state);
});

router.post("/api/daily-chest/claim", async (request: Request, env: Env) => {
  const auth = await requirePaidAuth(request, env);
  if (!auth) return json({ error: "Payment required" }, 402);

  await ensureDailyChestTable(env);
  await ensureLeaderboardTable(env);

  const todayKey = getDayKey();
  const { address } = auth;

  // Check if already claimed today
  const todayClaim = await env.DB.prepare(
    "SELECT streak_day FROM daily_chest_claims WHERE address = ? AND day_key = ?"
  ).bind(address, todayKey).first<{ streak_day: number }>();

  if (todayClaim) {
    return json({ error: "Already claimed today", claimedToday: true }, 409);
  }

  // Calculate streak: check if yesterday was claimed
  const yesterday = getYesterdayKey();
  const yesterdayClaim = await env.DB.prepare(
    "SELECT streak_day FROM daily_chest_claims WHERE address = ? AND day_key = ?"
  ).bind(address, yesterday).first<{ streak_day: number }>();

  let streakDay: number;
  if (yesterdayClaim) {
    // Continue streak (wrap around after day 7)
    streakDay = yesterdayClaim.streak_day >= 7 ? 1 : yesterdayClaim.streak_day + 1;
  } else {
    // Streak broken or first claim
    streakDay = 1;
  }

  const tier = DAILY_CHEST_TIERS[streakDay - 1] || DAILY_CHEST_TIERS[0];
  const rewards: RewardPayload = {
    coins: tier.coins,
    pearls: tier.pearls,
    shards: tier.shards,
    items: []
  };

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO daily_chest_claims (address, day_key, streak_day, rewards_json, claimed_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(address, todayKey, streakDay, JSON.stringify(rewards), now),
  ]);

  await applyRewards(env, address, rewards);
  const resources = await getResources(env, address);
  await logEvent(env, address, "daily_chest_claim", { streakDay, rewards }, request);

  return json({ streakDay, rewards, resources, claimedToday: true });
});

/* ── Base Building System ── */

router.get("/api/base", async (request: Request, env: Env) => {
  const auth = await requirePaidAuth(request, env);
  if (!auth) return json({ error: "Payment required" }, 402);
  const base = await getBaseState(env, auth.address);
  return json(base);
});

router.post("/api/base/build", async (request: Request, env: Env) => {
  const auth = await requirePaidAuth(request, env);
  if (!auth) return json({ error: "Payment required" }, 402);

  const body = await readBody(request);
  const schema = z.object({
    buildingType: z.enum(["shard_mine", "pearl_grotto", "training_reef", "storage_vault"])
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid payload" }, 400);

  const buildingType = parsed.data.buildingType as BuildingType;
  const def = BUILDINGS.find((b) => b.id === buildingType);
  if (!def) return json({ error: "Unknown building" }, 404);

  await ensureBaseTable(env);
  await ensureLeaderboardTable(env);

  // Check if player already has this building
  const existing = await env.DB.prepare(
    "SELECT id, level FROM base_buildings WHERE address = ? AND building_type = ?"
  ).bind(auth.address, buildingType).first<{ id: string; level: number }>();

  let targetLevel: number;
  let buildingId: string;

  if (existing) {
    // Upgrade existing building
    targetLevel = existing.level + 1;
    if (targetLevel > def.maxLevel) {
      return json({ error: "Building already at max level" }, 400);
    }
    buildingId = existing.id;
  } else {
    // Build new building
    targetLevel = 1;
    buildingId = nanoid(12);

    // Check slot limit
    const base = await getBaseState(env, auth.address);
    if (base.buildings.length >= base.maxSlots) {
      return json({ error: "No available building slots" }, 400);
    }
  }

  const cost = def.costs[targetLevel - 1];
  if (!cost) return json({ error: "Invalid level" }, 400);

  const resources = await getResources(env, auth.address);
  if (resources.coins < cost.coins) return json({ error: "Not enough coins" }, 400);
  if (resources.pearls < cost.pearls) return json({ error: "Not enough pearls" }, 400);

  const now = new Date().toISOString();

  if (existing) {
    // Upgrade: deduct resources and increase level
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE base_buildings SET level = ? WHERE id = ?"
      ).bind(targetLevel, buildingId),
      env.DB.prepare(
        "UPDATE leaderboard_stats SET coins = coins - ?, pearls = pearls - ?, updated_at = ? WHERE address = ?"
      ).bind(cost.coins, cost.pearls, now, auth.address)
    ]);
  } else {
    // New build: insert building and deduct resources
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO base_buildings (id, address, building_type, level, last_collected_at, created_at) VALUES (?, ?, ?, 1, ?, ?)"
      ).bind(buildingId, auth.address, buildingType, now, now),
      env.DB.prepare(
        "UPDATE leaderboard_stats SET coins = coins - ?, pearls = pearls - ?, updated_at = ? WHERE address = ?"
      ).bind(cost.coins, cost.pearls, now, auth.address)
    ]);
  }

  const updatedResources = await getResources(env, auth.address);
  const base = await getBaseState(env, auth.address);
  await logEvent(env, auth.address, "base_build", { buildingType, targetLevel }, request);

  return json({ base, resources: updatedResources });
});

router.post("/api/base/collect", async (request: Request, env: Env) => {
  const auth = await requirePaidAuth(request, env);
  if (!auth) return json({ error: "Payment required" }, 402);

  await ensureBaseTable(env);
  await ensureLeaderboardTable(env);

  const buildings = await env.DB.prepare(
    "SELECT id, building_type, level, last_collected_at FROM base_buildings WHERE address = ?"
  ).bind(auth.address).all<{
    id: string;
    building_type: string;
    level: number;
    last_collected_at: string;
  }>();

  // Calculate max accumulation hours (base 4h + 2h per storage_vault level)
  let maxAccumHours = 4;
  for (const b of buildings.results) {
    if (b.building_type === "storage_vault") {
      maxAccumHours += b.level * 2;
    }
  }

  let totalShards = 0;
  let totalPearls = 0;
  const now = new Date();
  const nowIso = now.toISOString();

  const updateStmts = [];

  for (const b of buildings.results) {
    const def = BUILDINGS.find((bd) => bd.id === b.building_type);
    if (!def || def.produces === "buff") continue;

    const lastCollected = new Date(b.last_collected_at);
    const hoursElapsed = Math.min(
      maxAccumHours,
      (now.getTime() - lastCollected.getTime()) / 3600000
    );

    if (hoursElapsed < 0.01) continue; // less than ~36 seconds, skip

    const rate = def.productionPerHour[b.level - 1] || 0;
    const produced = Math.floor(rate * hoursElapsed);

    if (produced <= 0) continue;

    if (def.produces === "shards") totalShards += produced;
    if (def.produces === "pearls") totalPearls += produced;

    updateStmts.push(
      env.DB.prepare("UPDATE base_buildings SET last_collected_at = ? WHERE id = ?")
        .bind(nowIso, b.id)
    );
  }

  if (totalShards > 0 || totalPearls > 0) {
    updateStmts.push(
      env.DB.prepare(
        "UPDATE leaderboard_stats SET shards = shards + ?, pearls = pearls + ?, updated_at = ? WHERE address = ?"
      ).bind(totalShards, totalPearls, nowIso, auth.address)
    );
  }

  if (updateStmts.length > 0) {
    await env.DB.batch(updateStmts);
  }

  const resources = await getResources(env, auth.address);
  const base = await getBaseState(env, auth.address);
  await logEvent(env, auth.address, "base_collect", { shards: totalShards, pearls: totalPearls }, request);

  return json({ base, resources, collected: { shards: totalShards, pearls: totalPearls } });
});

router.get("/api/base/state", async (request: Request, env: Env) => {
  const auth = await requireAuth(request, env);
  if (!auth) return json({ error: "Unauthorized" }, 401);
  await ensureBaseStateBlobTable(env);
  const row = await env.DB.prepare(
    "SELECT state_json, updated_at FROM base_state_blobs WHERE address = ?"
  )
    .bind(auth.address)
    .first<{ state_json: string; updated_at: string }>();

  if (!row) {
    return json({ stateJson: null, updatedAt: null });
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(row.state_json);
  } catch {
    parsed = null;
  }
  return json({ stateJson: parsed, updatedAt: row.updated_at });
});

router.post("/api/base/state", async (request: Request, env: Env) => {
  const auth = await requireAuth(request, env);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const nowMs = Date.now();
  const lastWriteMs = baseBlobWriteGuard.get(auth.address) ?? 0;
  if (nowMs - lastWriteMs < BASE_BLOB_WRITE_COOLDOWN_MS) {
    return json({ error: "Too many writes" }, 429);
  }

  const body = await readBody(request);
  const schema = z.object({
    stateJson: z.record(z.unknown()),
    clientUpdatedAt: z.string().optional()
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid payload" }, 400);

  const serialized = JSON.stringify(parsed.data.stateJson);
  if (serialized.length > BASE_BLOB_MAX_CHARS) {
    return json({ error: "Payload too large", limitChars: BASE_BLOB_MAX_CHARS }, 413);
  }

  await ensureBaseStateBlobTable(env);
  const row = await env.DB.prepare(
    "SELECT updated_at FROM base_state_blobs WHERE address = ?"
  )
    .bind(auth.address)
    .first<{ updated_at: string }>();
  const serverUpdatedAt = row?.updated_at ?? null;
  const clientUpdatedAt = parsed.data.clientUpdatedAt ?? null;
  if (clientUpdatedAt !== null && clientUpdatedAt !== serverUpdatedAt) {
    return json({ error: "Conflict", updatedAt: serverUpdatedAt }, 409);
  }

  const updatedAt = new Date(nowMs).toISOString();
  await env.DB.prepare(
    "INSERT INTO base_state_blobs (address, state_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(address) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at"
  )
    .bind(auth.address, serialized, updatedAt)
    .run();
  baseBlobWriteGuard.set(auth.address, nowMs);
  return json({ ok: true, updatedAt });
});

router.all("*", () => json({ error: "Not found" }, 404));

export default {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(Promise.all([cleanupSessions(env), cleanupRateLimits(env)]));
    try {
      return await router.handle(request, env);
    } catch (err) {
      const details = err instanceof Error ? err.message : "unknown";
      if (env.API_ENV === "local") {
        return json({ error: "Internal server error", details }, 500);
      }
      return json({ error: "Internal server error" }, 500);
    }
  }
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

async function readBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function requireAuth(request: Request, env: Env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace("Bearer ", "");
  if (!token) return null;
  const session = await env.DB.prepare(
    "SELECT address, expires_at FROM sessions WHERE token = ?"
  )
    .bind(token)
    .first<{ address: string; expires_at: string }>();
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;
  return { address: session.address };
}

async function requirePaidAuth(request: Request, env: Env) {
  // Payment gate disabled: wallet signature auth is enough.
  return requireAuth(request, env);
}

function parseRequiredEntryFeeWei(env: Env): bigint {
  const raw = `${env.ENTRY_FEE_WEI || ""}`.trim();
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error("ENTRY_FEE_WEI is not configured");
  }
  const value = BigInt(raw);
  if (value <= 0n) {
    throw new Error("ENTRY_FEE_WEI must be greater than 0");
  }
  return value;
}

async function getDailyLimit(env: Env, address: string) {
  const { matchesLeft } = await getMatchBankState(env, address);
  return {
    matchesLeft,
    resetAt: getNextReset()
  };
}

function getDayKey() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dayDiff(fromDayKey: string, toDayKey: string): number {
  const from = new Date(`${fromDayKey}T00:00:00.000Z`).getTime();
  const to = new Date(`${toDayKey}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.floor((to - from) / 86400000);
}

function getNextReset() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return next.toISOString();
}

let matchBankTableReady = false;
async function ensureMatchBankTable(env: Env) {
  if (matchBankTableReady) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS match_bank (address TEXT PRIMARY KEY, matches_available INTEGER NOT NULL DEFAULT 5, last_day_key TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run();
  matchBankTableReady = true;
}

async function getMatchBankState(env: Env, address: string): Promise<{ matchesLeft: number }> {
  await ensureMatchBankTable(env);
  const today = getDayKey();
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    "SELECT matches_available, last_day_key FROM match_bank WHERE address = ?"
  ).bind(address).first<{ matches_available: number; last_day_key: string }>();

  if (!existing) {
    await env.DB.prepare(
      "INSERT INTO match_bank (address, matches_available, last_day_key, updated_at) VALUES (?, ?, ?, ?)"
    ).bind(address, MATCH_LIMIT_PER_DAY, today, now).run();
    return { matchesLeft: MATCH_LIMIT_PER_DAY };
  }

  const elapsedDays = Math.max(0, dayDiff(existing.last_day_key, today));
  if (elapsedDays > 0) {
    const accrued = Math.min(
      MATCH_BANK_MAX,
      Math.max(0, existing.matches_available) + elapsedDays * MATCH_LIMIT_PER_DAY
    );
    await env.DB.prepare(
      "UPDATE match_bank SET matches_available = ?, last_day_key = ?, updated_at = ? WHERE address = ?"
    ).bind(accrued, today, now, address).run();
    return { matchesLeft: accrued };
  }

  return { matchesLeft: Math.max(0, existing.matches_available) };
}

async function spendMatchFromBank(env: Env, address: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE match_bank SET matches_available = CASE WHEN matches_available > 0 THEN matches_available - 1 ELSE 0 END, updated_at = ? WHERE address = ?"
  ).bind(now, address).run();
}

function createRng(seed: string) {
  let state = hashString(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function computeWinChance(
  player: HeroType,
  opponent: HeroType,
  weather: WeatherDef,
  upgrades: { piercingLevel: number }
) {
  let chance = 0.5;

  // Asymmetric matchup bonus
  chance += getMatchupBonus(player, opponent);

  // Weather bonus
  chance += getWeatherBonus(weather, player);
  chance -= getWeatherBonus(weather, opponent);

  // Piercing bonus when at a disadvantage
  const matchup = getMatchupState(player, opponent);
  if (matchup === "disadvantage") {
    const piercingBonus = Math.min(0.10, upgrades.piercingLevel * 0.02);
    chance += piercingBonus;
  }

  return clampChance(chance, 0.20, 0.85);
}

/** Points awarded per match based on result and streak */
function computePoints(result: "win" | "lose", streakLevel: number): number {
  if (result === "win") {
    // Base 10 points + 2 per streak level (max +10 at streak 5)
    return 10 + Math.min(10, streakLevel * 2);
  }
  // Loss: +1 point for participation
  return 1;
}

function rollRewards(rng: () => number, result: MatchResult, streakLevel = 0): RewardPayload {
  const win = result === "win";
  // Streak multiplier: +10% per streak level
  const streakMult = 1 + streakLevel * 0.1;

  // Coins always drop
  const baseCoins = win ? randRange(rng, 40, 100) : randRange(rng, 15, 35);
  const coins = Math.round(baseCoins * streakMult);

  // Pearls only on win
  const basePearls = win ? randRange(rng, 8, 18) : 0;
  const pearls = Math.round(basePearls * streakMult);

  // Shards: NOT from chests — only from Base buildings
  const shards = 0;

  const items: string[] = [];
  if (win && rng() < 0.20) items.push("Pearl Fragment");
  if (win && rng() < 0.05) items.push("Rare Shell");

  return { coins, pearls, shards, items };
}

function randRange(rng: () => number, min: number, max: number) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/**
 * Seed projections so there's always an opponent to fight.
 * Seeds use ids starting with "seed-" so we can distinguish them from real players.
 * Once enough real players exist, seeds are gradually phased out.
 */
async function ensureSeedProjections(env: Env) {
  const count = await env.DB.prepare("SELECT COUNT(*) as count FROM projections")
    .first<{ count: number }>();
  if ((count?.count || 0) > 0) return;

  const now = new Date().toISOString();
  const seeds: Array<{ id: string; hero: HeroType; lineup: HeroType[]; weatherId: string }> = [];
  for (const weather of WEATHER) {
    seeds.push(
      { id: `seed-shark-${weather.id}`, hero: "Shark", lineup: ["Shark", "Whale", "Shrimp"], weatherId: weather.id },
      { id: `seed-whale-${weather.id}`, hero: "Whale", lineup: ["Whale", "Shrimp", "Shark"], weatherId: weather.id },
      { id: `seed-shrimp-${weather.id}`, hero: "Shrimp", lineup: ["Shrimp", "Shark", "Whale"], weatherId: weather.id }
    );
  }
  const inserts = seeds.map((seed) =>
    env.DB.prepare(
      "INSERT INTO projections (id, address, hero, lineup_json, weather_id, upgrades_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(seed.id, seed.id, seed.hero, JSON.stringify(seed.lineup), seed.weatherId, JSON.stringify({ piercingLevel: 1 }), now)
  );
  await env.DB.batch(inserts);
}

/**
 * Clean up seed projections once there are enough real players.
 * Called periodically (e.g. after match resolve).
 * Threshold: if ≥ 10 real (non-seed) projections exist, delete all seeds.
 */
async function cleanupSeedProjections(env: Env) {
  const realCount = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM projections WHERE id NOT LIKE 'seed-%'"
  ).first<{ count: number }>();
  if ((realCount?.count || 0) >= 10) {
    await env.DB.prepare("DELETE FROM projections WHERE id LIKE 'seed-%'").run();
  }
}

function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed as T[];
  } catch {
    // fall through
  }
  return [value as unknown as T];
}

function parseUpgradeArray(value: string | null | undefined): UpgradeState[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed as UpgradeState[];
    if (parsed && typeof parsed === "object") return [parsed as UpgradeState];
  } catch {
    // fall through
  }
  return [];
}

function parseHeroLineup(value: string | null | undefined): HeroType[] {
  const parsed = parseJsonArray<HeroType>(value);
  return parsed.length > 0 ? parsed : ["Shark"];
}

function buildOpponentLineup(
  idsValue: string | null | undefined,
  heroesValue: string | null | undefined,
  upgradesValue: string | null | undefined
): OpponentProfile[] {
  const ids = parseJsonArray<string>(idsValue);
  const heroes = parseHeroLineup(heroesValue);
  const upgrades = parseUpgradeArray(upgradesValue);
  const count = Math.max(ids.length, heroes.length, upgrades.length, 1);
  return Array.from({ length: count }).map((_, index) => ({
    id: ids[index] || `opp-${index}`,
    hero: heroes[index] || heroes[0],
    upgrades: upgrades[index] || upgrades[0] || { piercingLevel: 0 }
  }));
}

async function pickOpponentLineup(
  env: Env,
  rng: () => number,
  count: number,
  weatherId: string
): Promise<OpponentProfile[]> {
  // Priority 1: real player projections for this weather (exclude seeds)
  const realWeatherRows = await env.DB.prepare(
    "SELECT id, hero, lineup_json, upgrades_json FROM projections WHERE weather_id = ? AND id NOT LIKE 'seed-%' ORDER BY updated_at DESC LIMIT ?"
  ).bind(weatherId, MAX_RECENT_PROJECTIONS_PER_WEATHER).all<{ id: string; hero: HeroType; lineup_json: string; upgrades_json: string }>();

  if (realWeatherRows.results.length > 0) {
    const pick = realWeatherRows.results[Math.floor(rng() * realWeatherRows.results.length)];
    const lineup = parseJsonArray<HeroType>(pick.lineup_json);
    if (lineup.length >= count) {
      return lineup.slice(0, count).map((hero, i) => ({
        id: `${pick.id}-${i}`,
        hero,
        upgrades: JSON.parse(pick.upgrades_json)
      }));
    }
  }

  // Priority 2: any projections for this weather (including seeds)
  const weatherRows = await env.DB.prepare(
    "SELECT id, hero, lineup_json, upgrades_json FROM projections WHERE weather_id = ? ORDER BY updated_at DESC LIMIT ?"
  ).bind(weatherId, MAX_RECENT_PROJECTIONS_PER_WEATHER).all<{ id: string; hero: HeroType; lineup_json: string; upgrades_json: string }>();

  if (weatherRows.results.length > 0) {
    const pick = weatherRows.results[Math.floor(rng() * weatherRows.results.length)];
    const lineup = parseJsonArray<HeroType>(pick.lineup_json);
    if (lineup.length >= count) {
      return lineup.slice(0, count).map((hero, i) => ({
        id: `${pick.id}-${i}`,
        hero,
        upgrades: JSON.parse(pick.upgrades_json)
      }));
    }
  }

  // Fallback: pick individual opponents
  const lineup: OpponentProfile[] = [];
  for (let i = 0; i < count; i += 1) {
    lineup.push(await pickOpponent(env, rng));
  }
  return lineup;
}

async function trimOldWeatherProjections(env: Env, weatherId: string, keep: number) {
  await env.DB.prepare(
    "DELETE FROM projections WHERE weather_id = ? AND id NOT LIKE 'seed-%' AND id NOT IN (SELECT id FROM projections WHERE weather_id = ? AND id NOT LIKE 'seed-%' ORDER BY updated_at DESC LIMIT ?)"
  )
    .bind(weatherId, weatherId, keep)
    .run();
}

async function pickOpponent(env: Env, rng: () => number): Promise<OpponentProfile> {
  const all = await env.DB.prepare(
    "SELECT id, hero, upgrades_json FROM projections ORDER BY updated_at DESC LIMIT 50"
  ).all<{ id: string; hero: HeroType; upgrades_json: string }>();
  const rows = all.results;
  if (rows.length === 0) {
    // Fallback: return a default opponent if projections are empty
    const heroes: HeroType[] = ["Shark", "Whale", "Shrimp"];
    return {
      id: "fallback",
      hero: heroes[Math.floor(rng() * heroes.length)],
      upgrades: { piercingLevel: 0 }
    };
  }
  const pick = rows[Math.floor(rng() * rows.length)];
  return {
    id: pick.id,
    hero: pick.hero,
    upgrades: JSON.parse(pick.upgrades_json)
  };
}

async function enforceRateLimit(request: Request, env: Env) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const minute = Math.floor(Date.now() / 60000);
  const key = `${ip}:${minute}`;
  const row = await env.DB.prepare(
    "SELECT count, reset_at FROM rate_limits WHERE key = ?"
  )
    .bind(key)
    .first<{ count: number; reset_at: number }>();

  if (row && row.count >= RATE_LIMIT_PER_MIN && row.reset_at > Date.now()) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  const resetAt = minute * 60000 + 60000;
  await env.DB.prepare(
    "INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1"
  )
    .bind(key, resetAt)
    .run();
  return null;
}

async function getIdempotent(
  env: Env,
  address: string,
  route: string,
  key: string
) {
  const row = await env.DB.prepare(
    "SELECT response_json FROM idempotency WHERE key = ? AND address = ? AND route = ?"
  )
    .bind(key, address, route)
    .first<{ response_json: string }>();
  if (!row?.response_json) return null;
  return JSON.parse(row.response_json);
}

async function saveIdempotent(
  env: Env,
  address: string,
  route: string,
  key: string,
  payload: unknown
) {
  await env.DB.prepare(
    "INSERT INTO idempotency (key, address, route, response_json, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(key, address, route, JSON.stringify(payload), new Date().toISOString())
    .run();
}

async function cleanupSessions(env: Env) {
  const now = new Date().toISOString();
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now).run();
}

async function cleanupRateLimits(env: Env) {
  await env.DB.prepare("DELETE FROM rate_limits WHERE reset_at < ?")
    .bind(Date.now())
    .run();
}

let coreTablesReady = false;
async function ensureCoreTables(env: Env) {
  if (coreTablesReady) return;
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS users (address TEXT PRIMARY KEY, created_at TEXT NOT NULL, has_onboarded INTEGER NOT NULL DEFAULT 0, heroes_json TEXT NOT NULL DEFAULT '[]', upgrades_json TEXT NOT NULL DEFAULT '{\"piercingLevel\":0}', last_active TEXT)"
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, address TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)"
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS nonces (address TEXT PRIMARY KEY, nonce TEXT NOT NULL, created_at TEXT NOT NULL)"
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS daily_limits (address TEXT NOT NULL, day_key TEXT NOT NULL, matches_played INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (address, day_key))"
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS pending_matches (id TEXT PRIMARY KEY, address TEXT NOT NULL, hero TEXT NOT NULL, opponent_id TEXT NOT NULL, opponent_hero TEXT NOT NULL, opponent_upgrades TEXT NOT NULL, weather_id TEXT NOT NULL, server_seed TEXT NOT NULL, created_at TEXT NOT NULL)"
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS chests (id TEXT PRIMARY KEY, address TEXT NOT NULL, type TEXT NOT NULL, match_id TEXT, rewards_json TEXT NOT NULL, created_at TEXT NOT NULL, opened_at TEXT)"
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS idempotency (key TEXT NOT NULL, address TEXT NOT NULL, route TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (key, address, route))"
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS projections (id TEXT PRIMARY KEY, address TEXT NOT NULL, hero TEXT NOT NULL, lineup_json TEXT NOT NULL DEFAULT '[]', weather_id TEXT NOT NULL DEFAULT '', upgrades_json TEXT NOT NULL, updated_at TEXT NOT NULL)"
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)"
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, address TEXT, event TEXT NOT NULL, payload_json TEXT, created_at TEXT NOT NULL, ip TEXT)"
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS base_state_blobs (address TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)"
    )
  ]);
  coreTablesReady = true;
}

let leaderboardTableReady = false;
async function ensureLeaderboardTable(env: Env) {
  if (leaderboardTableReady) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS leaderboard_stats (address TEXT PRIMARY KEY, wins INTEGER NOT NULL DEFAULT 0, matches INTEGER NOT NULL DEFAULT 0, coins INTEGER NOT NULL DEFAULT 0, pearls INTEGER NOT NULL DEFAULT 0, shards INTEGER NOT NULL DEFAULT 0, win_streak INTEGER NOT NULL DEFAULT 0, best_streak INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)"
  ).run();
  // Add streak columns if they don't exist (migration)
  try {
    await env.DB.prepare("ALTER TABLE leaderboard_stats ADD COLUMN win_streak INTEGER NOT NULL DEFAULT 0").run();
  } catch { /* column already exists */ }
  try {
    await env.DB.prepare("ALTER TABLE leaderboard_stats ADD COLUMN best_streak INTEGER NOT NULL DEFAULT 0").run();
  } catch { /* column already exists */ }
  // Add points column if it doesn't exist (migration)
  try {
    await env.DB.prepare("ALTER TABLE leaderboard_stats ADD COLUMN points INTEGER NOT NULL DEFAULT 0").run();
  } catch { /* column already exists */ }
  leaderboardTableReady = true;
}

async function getResources(env: Env, address: string): Promise<ResourceTotals> {
  await ensureLeaderboardTable(env);
  await ensureResourceRow(env, address);
  const row = await env.DB.prepare(
    "SELECT coins, pearls, shards FROM leaderboard_stats WHERE address = ?"
  )
    .bind(address)
    .first<{ coins: number; pearls: number; shards: number }>();
  return {
    coins: row?.coins || 0,
    pearls: row?.pearls || 0,
    shards: row?.shards || 0
  };
}

async function ensureResourceRow(env: Env, address: string) {
  const row = await env.DB.prepare(
    "SELECT address FROM leaderboard_stats WHERE address = ?"
  )
    .bind(address)
    .first<{ address: string }>();
  if (row?.address) return;
  await env.DB.prepare(
    "INSERT INTO leaderboard_stats (address, wins, matches, coins, pearls, shards, updated_at) VALUES (?, 0, 0, 0, 0, 0, ?)"
  )
    .bind(address, new Date().toISOString())
    .run();
}

let inventoryTablesReady = false;
async function ensureInventoryTables(env: Env) {
  if (inventoryTablesReady) return;
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS inventory_items (id TEXT PRIMARY KEY, address TEXT NOT NULL, artifact_id TEXT NOT NULL, hero TEXT NOT NULL, slot TEXT NOT NULL, created_at TEXT NOT NULL)"
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS equipped_items (address TEXT NOT NULL, hero TEXT NOT NULL, slot TEXT NOT NULL, artifact_id TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (address, hero, slot))"
    ),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_inventory_address ON inventory_items (address)"
    ),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_inventory_address_artifact ON inventory_items (address, artifact_id)"
    ),
    env.DB.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_address_artifact ON inventory_items (address, artifact_id)"
    )
  ]);
  inventoryTablesReady = true;
}

async function getInventoryState(env: Env, address: string): Promise<InventoryState> {
  await ensureInventoryTables(env);
  const itemsRes = await env.DB.prepare(
    "SELECT id, artifact_id, hero, slot, created_at FROM inventory_items WHERE address = ? ORDER BY created_at DESC"
  )
    .bind(address)
    .all<{ id: string; artifact_id: string; hero: HeroType; slot: string; created_at: string }>();

  const equippedRes = await env.DB.prepare(
    "SELECT hero, slot, artifact_id FROM equipped_items WHERE address = ?"
  )
    .bind(address)
    .all<{ hero: HeroType; slot: string; artifact_id: string }>();

  const equipped: Record<HeroType, EquippedSlots> = {
    Shark: {},
    Whale: {},
    Shrimp: {}
  };

  for (const row of equippedRes.results) {
    if (row.slot === "weapon" || row.slot === "armor") {
      equipped[row.hero][row.slot] = row.artifact_id;
    }
  }

  const items: InventoryItem[] = itemsRes.results.map((row) => ({
    id: row.id,
    artifactId: row.artifact_id,
    hero: row.hero,
    slot: row.slot as "weapon" | "armor",
    acquiredAt: row.created_at
  }));

  return { items, equipped };
}

async function getEquippedForHero(
  env: Env,
  address: string,
  hero: HeroType
): Promise<EquippedSlots> {
  await ensureInventoryTables(env);
  const rows = await env.DB.prepare(
    "SELECT slot, artifact_id FROM equipped_items WHERE address = ? AND hero = ?"
  )
    .bind(address, hero)
    .all<{ slot: string; artifact_id: string }>();
  const equipped: EquippedSlots = {};
  for (const row of rows.results) {
    if (row.slot === "weapon" || row.slot === "armor") {
      equipped[row.slot] = row.artifact_id;
    }
  }
  return equipped;
}

function getArtifactBonus(equipped: EquippedSlots, opponentHero: HeroType) {
  let bonus = 0;
  const ids = [equipped.weapon, equipped.armor].filter(Boolean) as string[];
  for (const id of ids) {
    const artifact = ARTIFACTS.find((item) => item.id === id);
    if (artifact && artifact.bonusAgainst === opponentHero) {
      bonus += artifact.bonus;
    }
  }
  // Synergy bonus: both slots filled → +3%
  if (equipped.weapon && equipped.armor) {
    bonus += SYNERGY_BONUS;
  }
  return bonus;
}

async function updateLeaderboardMatch(env: Env, address: string, won: boolean, streakLevel: number) {
  await ensureLeaderboardTable(env);
  const now = new Date().toISOString();
  const pts = computePoints(won ? "win" : "lose", streakLevel);
  if (won) {
    await env.DB.prepare(
      "INSERT INTO leaderboard_stats (address, wins, matches, coins, pearls, shards, win_streak, best_streak, points, updated_at) VALUES (?, 1, 1, 0, 0, 0, 1, 1, ?, ?) ON CONFLICT(address) DO UPDATE SET wins = wins + 1, matches = matches + 1, win_streak = win_streak + 1, best_streak = MAX(best_streak, win_streak + 1), points = points + ?, updated_at = excluded.updated_at"
    ).bind(address, pts, now, pts).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO leaderboard_stats (address, wins, matches, coins, pearls, shards, win_streak, best_streak, points, updated_at) VALUES (?, 0, 1, 0, 0, 0, 0, 0, ?, ?) ON CONFLICT(address) DO UPDATE SET matches = matches + 1, win_streak = 0, points = points + ?, updated_at = excluded.updated_at"
    ).bind(address, pts, now, pts).run();
  }
}

async function applyRewards(env: Env, address: string, rewards: RewardPayload) {
  await ensureLeaderboardTable(env);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO leaderboard_stats (address, wins, matches, coins, pearls, shards, updated_at) VALUES (?, 0, 0, ?, ?, ?, ?) ON CONFLICT(address) DO UPDATE SET coins = coins + ?, pearls = pearls + ?, shards = shards + ?, updated_at = excluded.updated_at"
  )
    .bind(
      address,
      rewards.coins,
      rewards.pearls,
      rewards.shards,
      now,
      rewards.coins,
      rewards.pearls,
      rewards.shards
    )
    .run();
}

/* ── Daily chest helpers ── */

let dailyChestTableReady = false;
async function ensureDailyChestTable(env: Env) {
  if (dailyChestTableReady) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS daily_chest_claims (address TEXT NOT NULL, day_key TEXT NOT NULL, streak_day INTEGER NOT NULL DEFAULT 1, rewards_json TEXT NOT NULL, claimed_at TEXT NOT NULL, PRIMARY KEY (address, day_key))"
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_daily_chest_address ON daily_chest_claims (address)"
  ).run();
  dailyChestTableReady = true;
}

function getYesterdayKey(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function getDailyChestState(env: Env, address: string): Promise<DailyChestState> {
  await ensureDailyChestTable(env);
  const todayKey = getDayKey();

  // Check today's claim
  const todayClaim = await env.DB.prepare(
    "SELECT streak_day FROM daily_chest_claims WHERE address = ? AND day_key = ?"
  ).bind(address, todayKey).first<{ streak_day: number }>();

  if (todayClaim) {
    // Already claimed today
    const nextDay = todayClaim.streak_day >= 7 ? 1 : todayClaim.streak_day + 1;
    return {
      streakDay: todayClaim.streak_day,
      claimedToday: true,
      nextReward: DAILY_CHEST_TIERS[nextDay - 1] || DAILY_CHEST_TIERS[0]
    };
  }

  // Not claimed today — check yesterday to see if streak continues
  const yesterday = getYesterdayKey();
  const yesterdayClaim = await env.DB.prepare(
    "SELECT streak_day FROM daily_chest_claims WHERE address = ? AND day_key = ?"
  ).bind(address, yesterday).first<{ streak_day: number }>();

  let nextStreakDay: number;
  if (yesterdayClaim) {
    nextStreakDay = yesterdayClaim.streak_day >= 7 ? 1 : yesterdayClaim.streak_day + 1;
  } else {
    nextStreakDay = 1;
  }

  return {
    streakDay: nextStreakDay,
    claimedToday: false,
    nextReward: DAILY_CHEST_TIERS[nextStreakDay - 1] || DAILY_CHEST_TIERS[0]
  };
}

/* ── Base helpers ── */
let baseTableReady = false;
async function ensureBaseTable(env: Env) {
  if (baseTableReady) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS base_buildings (id TEXT PRIMARY KEY, address TEXT NOT NULL, building_type TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 1, last_collected_at TEXT NOT NULL, created_at TEXT NOT NULL)"
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_base_buildings_address ON base_buildings (address)"
  ).run();
  baseTableReady = true;
}

let baseStateBlobTableReady = false;
async function ensureBaseStateBlobTable(env: Env) {
  if (baseStateBlobTableReady) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS base_state_blobs (address TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run();
  baseStateBlobTableReady = true;
}

async function getBaseState(env: Env, address: string): Promise<BaseState> {
  await ensureBaseTable(env);
  const rows = await env.DB.prepare(
    "SELECT id, building_type, level, last_collected_at, created_at FROM base_buildings WHERE address = ? ORDER BY created_at ASC"
  ).bind(address).all<{
    id: string;
    building_type: string;
    level: number;
    last_collected_at: string;
    created_at: string;
  }>();

  const buildings: PlayerBuilding[] = rows.results.map((row) => ({
    id: row.id,
    buildingType: row.building_type as BuildingType,
    level: row.level,
    lastCollectedAt: row.last_collected_at,
    createdAt: row.created_at
  }));

  // Base starts with 4 slots
  const maxSlots = 4;

  return { buildings, maxSlots };
}

let entryPaymentsTableReady = false;
async function ensureEntryPaymentsTable(env: Env) {
  if (entryPaymentsTableReady) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS entry_payments (tx_hash TEXT PRIMARY KEY, address TEXT NOT NULL, amount_wei TEXT NOT NULL, chain_id INTEGER NOT NULL, verified_at TEXT NOT NULL)"
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_entry_payments_address ON entry_payments (address)"
  ).run();
  entryPaymentsTableReady = true;
}

async function getLatestVerifiedEntryPayment(env: Env, address: string): Promise<{
  txHash: string;
  amountWei: string;
  verifiedAt: string;
} | null> {
  await ensureEntryPaymentsTable(env);
  const row = await env.DB.prepare(
    "SELECT tx_hash, amount_wei, verified_at FROM entry_payments WHERE address = ? ORDER BY verified_at DESC LIMIT 1"
  ).bind(address).first<{ tx_hash: string; amount_wei: string; verified_at: string }>();
  if (!row) return null;
  return {
    txHash: row.tx_hash,
    amountWei: row.amount_wei,
    verifiedAt: row.verified_at
  };
}

async function hasVerifiedEntryPayment(env: Env, address: string): Promise<boolean> {
  const latest = await getLatestVerifiedEntryPayment(env, address);
  return Boolean(latest);
}

async function getPoolStats(env: Env): Promise<{
  paidPlayers: number;
  totalWei: string;
  totalMon: string;
}> {
  await ensureEntryPaymentsTable(env);
  const baseWei = parseOptionalWei(env.POOL_BASE_WEI);
  const rows = await env.DB.prepare(
    "SELECT address, amount_wei FROM entry_payments"
  ).all<{ address: string; amount_wei: string }>();

  const uniquePlayers = new Set<string>();
  let totalWei = baseWei;

  for (const row of rows.results) {
    uniquePlayers.add((row.address || "").toLowerCase());
    try {
      totalWei += BigInt(row.amount_wei || "0");
    } catch {
      // Ignore malformed records without failing pool stats.
    }
  }

  return {
    paidPlayers: uniquePlayers.size,
    totalWei: totalWei.toString(),
    totalMon: formatWeiToMon(totalWei)
  };
}

function parseOptionalWei(raw: string | undefined): bigint {
  const value = `${raw || ""}`.trim();
  if (!value) return 0n;
  if (!/^[0-9]+$/.test(value)) return 0n;
  const wei = BigInt(value);
  return wei >= 0n ? wei : 0n;
}

function formatWeiToMon(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const fraction = wei % 10n ** 18n;
  const fractionPadded = fraction.toString().padStart(18, "0");
  const fractionShort = fractionPadded.slice(0, 4).replace(/0+$/, "");
  return fractionShort ? `${whole.toString()}.${fractionShort}` : whole.toString();
}

async function logEvent(
  env: Env,
  address: string | null,
  event: string,
  payload: unknown,
  request: Request
) {
  try {
    const ip = request.headers.get("cf-connecting-ip");
    await env.DB.prepare(
      "INSERT INTO logs (id, address, event, payload_json, created_at, ip) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(nanoid(12), address, event, JSON.stringify(payload), new Date().toISOString(), ip)
      .run();
  } catch {
    // Logging should never fail the main request
  }
}
