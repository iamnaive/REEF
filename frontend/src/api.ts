import {
  MatchPreview,
  MatchResolution,
  RewardPayload,
  HeroType,
  LeaderboardEntry,
  ResourceTotals,
  ArtifactDef,
  InventoryState,
  BaseState,
  BuildingType,
  DailyChestState
} from "@shared/types";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";

function getHeaders(token?: string, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return headers;
}

export async function fetchNonce(address: string) {
  const res = await fetch(`${API_BASE}/api/nonce?address=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error("Failed to get nonce");
  return (await res.json()) as { nonce: string; message: string };
}

export async function login(address: string, signature: string) {
  const res = await fetch(`${API_BASE}/api/login`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ address, signature })
  });
  if (!res.ok) throw new Error("Login failed");
  return (await res.json()) as { token: string; address: string };
}

export async function verifyEntryPayment(token: string, txHash: string, amountWei: string) {
  const res = await fetch(`${API_BASE}/api/entry/verify`, {
    method: "POST",
    headers: getHeaders(token),
    body: JSON.stringify({ txHash, amountWei })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Entry payment verification failed" }));
    throw new Error((err as { error?: string }).error || "Entry payment verification failed");
  }
  return (await res.json()) as { ok: true; txHash: string; amountWei: string };
}

export async function getState(token: string) {
  const res = await fetch(`${API_BASE}/api/state`, {
    headers: getHeaders(token)
  });
  if (!res.ok) {
    const error = new Error("Failed to fetch state");
    (error as { status?: number }).status = res.status;
    throw error;
  }
  return (await res.json()) as {
    address: string;
    heroes: HeroType[];
    upgrades: { piercingLevel: number };
    matchesLeft: number;
    resetAt: string;
    hasOnboarded: boolean;
    resources: ResourceTotals;
    dailyChest: DailyChestState;
  };
}

export async function claimOnboarding(token: string) {
  const res = await fetch(`${API_BASE}/api/onboarding/claim`, {
    method: "POST",
    headers: getHeaders(token)
  });
  if (!res.ok) throw new Error("Onboarding claim failed");
  return (await res.json()) as { chestId: string; rewards: RewardPayload };
}

export async function prepareMatch(token: string, heroes: HeroType[]) {
  const res = await fetch(`${API_BASE}/api/match/prepare`, {
    method: "POST",
    headers: getHeaders(token),
    body: JSON.stringify({ heroes })
  });
  if (!res.ok) throw new Error("Match prepare failed");
  return (await res.json()) as MatchPreview;
}

export async function resolveMatch(
  token: string,
  matchId: string,
  idempotencyKey: string
) {
  const res = await fetch(`${API_BASE}/api/match/resolve`, {
    method: "POST",
    headers: getHeaders(token, idempotencyKey),
    body: JSON.stringify({ matchId })
  });
  if (!res.ok) throw new Error("Match resolve failed");
  return (await res.json()) as MatchResolution;
}

export async function openChest(token: string, chestId: string, idempotencyKey: string) {
  const res = await fetch(`${API_BASE}/api/chest/open`, {
    method: "POST",
    headers: getHeaders(token, idempotencyKey),
    body: JSON.stringify({ chestId })
  });
  if (!res.ok) throw new Error("Chest open failed");
  return (await res.json()) as { chestId: string; rewards: RewardPayload };
}

export async function resetDailyLimit(token: string) {
  const res = await fetch(`${API_BASE}/api/dev/reset-daily`, {
    method: "POST",
    headers: getHeaders(token)
  });
  if (!res.ok) throw new Error("Reset failed");
  return (await res.json()) as { matchesLeft: number; resetAt: string };
}

export async function fetchLeaderboard(token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/api/leaderboard`, { headers });
  if (!res.ok) throw new Error("Failed to load leaderboard");
  return (await res.json()) as {
    entries: LeaderboardEntry[];
    totalPlayers: number;
    myEntry: LeaderboardEntry | null;
  };
}

export async function fetchShop() {
  const res = await fetch(`${API_BASE}/api/shop`);
  if (!res.ok) throw new Error("Failed to load shop");
  return (await res.json()) as { artifacts: ArtifactDef[] };
}

export async function buyArtifact(token: string, artifactId: string) {
  const res = await fetch(`${API_BASE}/api/shop/buy`, {
    method: "POST",
    headers: getHeaders(token, crypto.randomUUID()),
    body: JSON.stringify({ artifactId })
  });
  if (!res.ok) throw new Error("Purchase failed");
  return (await res.json()) as {
    item: { id: string; artifactId: string; hero: HeroType; slot: "weapon" | "armor"; acquiredAt: string };
    resources: ResourceTotals;
  };
}

export async function fetchInventory(token: string) {
  const res = await fetch(`${API_BASE}/api/inventory`, {
    headers: getHeaders(token)
  });
  if (!res.ok) throw new Error("Failed to load inventory");
  return (await res.json()) as InventoryState;
}

export async function equipArtifact(token: string, artifactId: string) {
  const res = await fetch(`${API_BASE}/api/inventory/equip`, {
    method: "POST",
    headers: getHeaders(token),
    body: JSON.stringify({ artifactId })
  });
  if (!res.ok) throw new Error("Equip failed");
  return (await res.json()) as InventoryState;
}

/* ── Daily Chest ── */

export async function fetchDailyChest(token: string) {
  const res = await fetch(`${API_BASE}/api/daily-chest`, {
    headers: getHeaders(token)
  });
  if (!res.ok) throw new Error("Failed to load daily chest");
  return (await res.json()) as DailyChestState;
}

export async function claimDailyChest(token: string) {
  const res = await fetch(`${API_BASE}/api/daily-chest/claim`, {
    method: "POST",
    headers: getHeaders(token)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Claim failed" }));
    throw new Error((err as { error?: string }).error || "Claim failed");
  }
  return (await res.json()) as {
    streakDay: number;
    rewards: RewardPayload;
    resources: ResourceTotals;
    claimedToday: boolean;
  };
}

/* ── Base API ── */

export async function fetchBase(token: string) {
  const res = await fetch(`${API_BASE}/api/base`, {
    headers: getHeaders(token)
  });
  if (!res.ok) throw new Error("Failed to load base");
  return (await res.json()) as BaseState;
}

export async function buildOrUpgrade(token: string, buildingType: BuildingType) {
  const res = await fetch(`${API_BASE}/api/base/build`, {
    method: "POST",
    headers: getHeaders(token),
    body: JSON.stringify({ buildingType })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Build failed" }));
    throw new Error((err as { error?: string }).error || "Build failed");
  }
  return (await res.json()) as { base: BaseState; resources: ResourceTotals };
}

export async function collectBaseResources(token: string) {
  const res = await fetch(`${API_BASE}/api/base/collect`, {
    method: "POST",
    headers: getHeaders(token)
  });
  if (!res.ok) throw new Error("Collect failed");
  return (await res.json()) as {
    base: BaseState;
    resources: ResourceTotals;
    collected: { shards: number; pearls: number };
  };
}
