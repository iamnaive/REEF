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

export class ApiRequestError extends Error {
  status?: number;
  details?: unknown;
  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.details = details;
  }
}

export type BaseAuthoritativeResources = {
  cash: number;
  yield: number;
  alpha: number;
  faith: number;
  tickets: number;
  mon: number;
  lastTickMs: number;
  updatedAt: string;
};

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

export async function fetchPoolStats() {
  const res = await fetch(`${API_BASE}/api/pool`);
  if (!res.ok) throw new Error("Failed to load pool stats");
  return (await res.json()) as {
    paidPlayers: number;
    totalWei: string;
    totalMon: string;
  };
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

export async function getBaseStateBlob(token: string) {
  const res = await fetch(`${API_BASE}/api/base/state`, {
    headers: getHeaders(token)
  });
  if (!res.ok) {
    const details = await res.json().catch(() => null);
    throw new ApiRequestError("Failed to load base state blob", res.status, details);
  }
  return (await res.json()) as {
    stateJson: Record<string, unknown> | null;
    updatedAt: string | null;
  };
}

export async function setBaseStateBlob(
  token: string,
  stateJson: Record<string, unknown>,
  clientUpdatedAt?: string | null
) {
  const res = await fetch(`${API_BASE}/api/base/state`, {
    method: "POST",
    headers: getHeaders(token),
    body: JSON.stringify({
      stateJson,
      ...(clientUpdatedAt ? { clientUpdatedAt } : {})
    })
  });
  if (!res.ok) {
    const details = await res.json().catch(() => null);
    throw new ApiRequestError("Failed to save base state blob", res.status, details);
  }
  return (await res.json()) as { ok: true; updatedAt: string };
}

export async function getResources(token: string) {
  const res = await fetch(`${API_BASE}/api/resources`, {
    headers: getHeaders(token)
  });
  if (!res.ok) {
    const details = await res.json().catch(() => null);
    throw new ApiRequestError("Failed to load resources", res.status, details);
  }
  return (await res.json()) as {
    resources: BaseAuthoritativeResources;
    serverNowMs: number;
  };
}
