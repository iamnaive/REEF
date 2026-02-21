import type { Tier } from "./economy";

const DAY_MS = 86_400_000;

export interface Resources {
  cash: number;
  yield: number;
  alpha: number;
  tickets: number;
  mon: number;
  faith: number;
}

export interface ResourceState {
  res: Resources;
  startedAtMs: number;
  lastTickMs: number;
}

export interface ResourceCaps {
  cash: number;
  yield: number;
  alpha: number;
  tickets: number;
  faith: number;
}

let passiveRates = {
  cashPerSec: 0,
  yieldPerSec: 0,
  alphaPerSec: 0
};

const BASE_CAPS: ResourceCaps = {
  cash: 2000,
  yield: 800,
  alpha: 800,
  tickets: 4,
  faith: 400
};

let currentCaps: ResourceCaps = { ...BASE_CAPS };

function defaultState(now: number): ResourceState {
  return {
    res: {
      cash: 600,
      yield: 0,
      alpha: 0,
      tickets: 1,
      mon: 0,
      faith: 0
    },
    startedAtMs: now,
    lastTickMs: now
  };
}

export function loadResourceState(): ResourceState {
  const now = Date.now();
  return defaultState(now);
}

export function saveResourceState(state: ResourceState): void {
  void state;
}

export function getResourceCaps(): ResourceCaps {
  return { ...currentCaps };
}

export function clampResourcesToCaps<T extends Partial<Resources>>(res: T): T {
  return {
    ...res,
    cash: res.cash == null ? res.cash : Math.min(res.cash, currentCaps.cash),
    yield: res.yield == null ? res.yield : Math.min(res.yield, currentCaps.yield),
    alpha: res.alpha == null ? res.alpha : Math.min(res.alpha, currentCaps.alpha),
    tickets: res.tickets == null ? res.tickets : Math.min(res.tickets, currentCaps.tickets),
    faith: res.faith == null ? res.faith : Math.min(res.faith, currentCaps.faith)
  } as T;
}

export function setCapsFromPlacements(
  placements: Record<string, { buildingId: string; tier: Tier } | null>
): void {
  const caps: ResourceCaps = { ...BASE_CAPS };
  Object.values(placements).forEach((placement) => {
    if (!placement) return;
    const tier = placement.tier;
    if (placement.buildingId === "command_pit_egg_council_hq") {
      if (tier === 2) {
        caps.cash += 4000;
        caps.yield += 600;
        caps.alpha += 600;
        caps.tickets += 2;
        caps.faith += 250;
      } else if (tier === 3) {
        caps.cash += 9000;
        caps.yield += 1400;
        caps.alpha += 1400;
        caps.tickets += 4;
        caps.faith += 550;
      } else if (tier === 4) {
        caps.cash += 18000;
        caps.yield += 2800;
        caps.alpha += 2800;
        caps.tickets += 7;
        caps.faith += 1100;
      }
      return;
    }
    if (placement.buildingId === "cold_vault_insurance") caps.cash += 2500 * tier;
    if (placement.buildingId === "memes_market") caps.cash += 1500 * tier;
    if (placement.buildingId === "rug_salvage_yard") caps.cash += 1000 * tier;
    if (placement.buildingId === "yield_router_station") caps.yield += 900 * tier;
    if (placement.buildingId === "narrative_radar") caps.alpha += 900 * tier;
    if (placement.buildingId === "cult") caps.faith += 450 * tier;
  });
  currentCaps = caps;
}

export function getDayIndex(state: ResourceState, now: number): number {
  return Math.floor((now - state.startedAtMs) / DAY_MS);
}

function tierRate(tier: Tier, r1: number, r2: number, r3: number, r4: number): number {
  if (tier === 1) return r1;
  if (tier === 2) return r2;
  if (tier === 3) return r3;
  return r4;
}

export function setPassiveRatesFromPlacements(
  placements: Record<string, { buildingId: string; tier: Tier } | null>
): void {
  setCapsFromPlacements(placements);
  let cashPerSec = 0;
  let yieldPerSec = 0;
  let alphaPerSec = 0;

  Object.values(placements).forEach((placement) => {
    if (!placement) return;
    if (placement.buildingId === "rug_salvage_yard") {
      cashPerSec += tierRate(placement.tier, 0.06, 0.12, 0.2, 0.3);
    } else if (placement.buildingId === "memes_market") {
      cashPerSec += tierRate(placement.tier, 0.04, 0.09, 0.16, 0.24);
    } else if (placement.buildingId === "yield_router_station") {
      yieldPerSec += tierRate(placement.tier, 0.04, 0.08, 0.13, 0.19);
    } else if (placement.buildingId === "narrative_radar") {
      alphaPerSec += tierRate(placement.tier, 0.03, 0.06, 0.1, 0.15);
    }
  });

  passiveRates = { cashPerSec, yieldPerSec, alphaPerSec };
}

export function tickResources(
  state: ResourceState,
  now: number,
  mods?: { passiveYieldMul?: number; passiveAlphaMul?: number; cashDrainPerSec?: number }
): ResourceState {
  const dt = Math.max(0, (now - state.lastTickMs) / 1000);
  if (dt <= 0) return state;
  const passiveYieldMul = mods?.passiveYieldMul ?? 1;
  const passiveAlphaMul = mods?.passiveAlphaMul ?? 1;
  const cashDrainPerSec = mods?.cashDrainPerSec ?? 0;
  const nextCash = Math.max(0, state.res.cash + passiveRates.cashPerSec * dt - cashDrainPerSec * dt);
  const clamped = clampResourcesToCaps({
    ...state.res,
    cash: nextCash,
    yield: state.res.yield + passiveRates.yieldPerSec * dt * passiveYieldMul,
    alpha: state.res.alpha + passiveRates.alphaPerSec * dt * passiveAlphaMul
  });
  return {
    ...state,
    res: clamped,
    lastTickMs: now
  };
}

export function canAfford(res: Resources, cost: Cost, dayIndex: number): { ok: boolean; reason?: string } {
  if ((cost.mon ?? 0) > 0 && dayIndex < 2) return { ok: false, reason: "MON locked until Day 2" };
  if ((cost.cash ?? 0) > res.cash) return { ok: false, reason: "Not enough Cash" };
  if ((cost.yield ?? 0) > res.yield) return { ok: false, reason: "Not enough Yield" };
  if ((cost.alpha ?? 0) > res.alpha) return { ok: false, reason: "Not enough Alpha" };
  if ((cost.tickets ?? 0) > res.tickets) return { ok: false, reason: "Not enough Tickets" };
  if ((cost.mon ?? 0) > res.mon) return { ok: false, reason: "Not enough MON" };
  if ((cost.faith ?? 0) > res.faith) return { ok: false, reason: "Not enough Faith" };
  return { ok: true };
}

export function spend(res: Resources, cost: Cost, dayIndex: number): Resources {
  return clampResourcesToCaps({
    ...res,
    cash: res.cash - (cost.cash ?? 0),
    yield: res.yield - (cost.yield ?? 0),
    alpha: res.alpha - (cost.alpha ?? 0),
    tickets: res.tickets - (cost.tickets ?? 0),
    mon: dayIndex >= 2 ? res.mon - (cost.mon ?? 0) : res.mon,
    faith: res.faith - (cost.faith ?? 0)
  });
}

type Cost = {
  cash?: number;
  yield?: number;
  alpha?: number;
  tickets?: number;
  mon?: number;
  faith?: number;
};
