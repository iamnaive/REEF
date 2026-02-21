import { BUILDINGS_BY_ID, type ActionResourceMap, type BuildingId } from "./buildings";
import {
  clampResourcesToCaps,
  getResourceCaps,
  setPassiveRatesFromPlacements,
  tickResources,
  type ResourceState
} from "./resourcesState";

export type DebuffId = "fuders" | "kol_shills" | "impostors";

export interface DebuffDef {
  id: DebuffId;
  nameEn: string;
  descEn: string;
}

export const DEBUFFS: Record<DebuffId, DebuffDef> = {
  fuders: {
    id: "fuders",
    nameEn: "FUDers",
    descEn: "Reduces passive Yield and Alpha gains."
  },
  kol_shills: {
    id: "kol_shills",
    nameEn: "KOL Shills",
    descEn: "Siphons Cash per second and raises action Cash costs."
  },
  impostors: {
    id: "impostors",
    nameEn: "Impostors",
    descEn: "Can jam actions and increases build duration."
  }
};

export interface ActiveDebuff {
  id: DebuffId;
  expiresAtMs: number;
}

export interface MechanicsState {
  debuffs: ActiveDebuff[];
  coverageUntilMs: number;
  yieldBoostUntilMs: number;
  yieldBoostMul: number;
  boostCharges: number;
  perks: string[];
  yieldMode: "safe" | "aggro";
  lastActionMs: Record<string, number>;
  globalCharges: ChargeState;
  ticketFractionCarry: number;
  raidDaily: {
    dayIndex: number;
    launchRaidUses: number;
    intelBribeUses: number;
  };
}

export interface ChargeState {
  lastAccrueAtMs: number;
  charges: number;
}

export interface MechanicsResources {
  cash: number;
  yield: number;
  alpha: number;
  tickets: number;
  mon: number;
  faith: number;
}

export interface UseActionParams {
  nowMs: number;
  dayIndex: number;
  startedAtMs?: number;
  cellId: string;
  buildingId: BuildingId;
  actionId: string;
  tier: 1 | 2 | 3 | 4;
  res: MechanicsResources;
  mech: MechanicsState;
}

export interface UseActionResult {
  ok: boolean;
  reasonEn?: string;
  newRes: MechanicsResources;
  newMech: MechanicsState;
  toastEn?: string;
  chargesUsed?: number;
}

const RAID_REWARD_SAFETY_MUL = 0.35;
const THREAT_SPAWN_RATE_DIVISOR = 5;
const THREAT_EFFECT_MULTIPLIER = 5;

function defaultMechanicsState(): MechanicsState {
  const now = Date.now();
  return {
    debuffs: [],
    coverageUntilMs: 0,
    yieldBoostUntilMs: 0,
    yieldBoostMul: 1.15,
    boostCharges: 0,
    perks: [],
    yieldMode: "safe",
    lastActionMs: {},
    globalCharges: {
      lastAccrueAtMs: now,
      charges: 6
    },
    ticketFractionCarry: 0,
    raidDaily: {
      dayIndex: 0,
      launchRaidUses: 0,
      intelBribeUses: 0
    }
  };
}

const GLOBAL_CHARGE_PERIOD_MS = 60 * 60_000;
const GLOBAL_CHARGE_CAP = 6;
const HARVEST_ACTIONS = new Set<string>([
  "rug_salvage_yard:salvage_sweep",
  "rug_salvage_yard:junk_refine",
  "memes_market:flip_memes",
  "memes_market:liquidity_snipe",
  "whale_tap:tap_whale",
  "whale_tap:premium_hook",
  "yield_router_station:route_yield",
  "narrative_radar:scan_narrative",
  "hype_farm:farm_hype",
  "hype_farm:viral_push",
  "command_pit_egg_council_hq:issue_order",
  "command_pit_egg_council_hq:council_decree",
  "cult:ritual_conversion",
  "cult:fervor_drive",
  "openclaw_lab:synthesize_module",
  "booster_forge:overclock_line",
  "cold_vault_insurance:claim_payout",
  "raid_dock_alpha_desk:intel_bribe"
]);

function isHarvestAction(buildingId: BuildingId, actionId: string): boolean {
  return HARVEST_ACTIONS.has(`${buildingId}:${actionId}`);
}

function accrueGlobalCharges(mech: MechanicsState, nowMs: number): MechanicsState {
  const current = mech.globalCharges ?? { lastAccrueAtMs: nowMs, charges: 0 };
  if (current.charges >= GLOBAL_CHARGE_CAP) {
    if (current.lastAccrueAtMs === nowMs) return mech;
    return {
      ...mech,
      globalCharges: {
        lastAccrueAtMs: nowMs,
        charges: GLOBAL_CHARGE_CAP
      }
    };
  }
  const delta = Math.max(0, nowMs - current.lastAccrueAtMs);
  const gained = Math.floor(delta / GLOBAL_CHARGE_PERIOD_MS);
  if (gained <= 0) return mech;
  const nextCharges = Math.min(GLOBAL_CHARGE_CAP, current.charges + gained);
  const nextAccrueAtMs = nextCharges >= GLOBAL_CHARGE_CAP ? nowMs : current.lastAccrueAtMs + gained * GLOBAL_CHARGE_PERIOD_MS;
  return {
    ...mech,
    globalCharges: {
      lastAccrueAtMs: nextAccrueAtMs,
      charges: nextCharges
    }
  };
}

function computeDayIndexFromStartedAtMs(nowMs: number, startedAtMs?: number): number | null {
  if (typeof startedAtMs !== "number") return null;
  const elapsed = Math.max(0, nowMs - startedAtMs);
  return Math.floor(elapsed / 86_400_000);
}

function getRaidRewardMultiplier(usesToday: number): number {
  const sequence = [1.0, 0.8, 0.65, 0.5, 0.4, 0.35];
  return sequence[usesToday] ?? 0.35;
}

function ensureRaidDaily(mech: MechanicsState, dayIndex: number): MechanicsState {
  if (mech.raidDaily.dayIndex === dayIndex) return mech;
  return {
    ...mech,
    raidDaily: {
      dayIndex,
      launchRaidUses: 0,
      intelBribeUses: 0
    }
  };
}

function migrateDebuffId(id: string): DebuffId | null {
  if (id === "fuders" || id === "kol_shills" || id === "impostors") return id;
  if (id === "fud_wave") return "fuders";
  if (id === "kol_shill") return "kol_shills";
  return null;
}

function normalizeScale(
  tierScale: "linear25" | "flat" | { byTier: { 1: number; 2: number; 3: number; 4: number } } | undefined,
  tier: 1 | 2 | 3 | 4
): number {
  if (!tierScale || tierScale === "linear25") return 1 + (tier - 1) * 0.25;
  if (tierScale === "flat") return 1;
  return tierScale.byTier[tier];
}

function scaleResourceMap(
  value: ActionResourceMap | undefined,
  scale: number
): ActionResourceMap {
  if (!value) return {};
  return {
    cash: value.cash != null ? value.cash * scale : undefined,
    yield: value.yield != null ? value.yield * scale : undefined,
    alpha: value.alpha != null ? value.alpha * scale : undefined,
    tickets: value.tickets != null ? value.tickets * scale : undefined,
    mon: value.mon != null ? value.mon * scale : undefined,
    faith: value.faith != null ? value.faith * scale : undefined
  };
}

function canPayCost(res: MechanicsResources, cost: ActionResourceMap, dayIndex: number): { ok: boolean; reasonEn?: string } {
  if ((cost.mon ?? 0) > 0 && dayIndex < 2) return { ok: false, reasonEn: "MON locked until Day 2" };
  if ((cost.cash ?? 0) > res.cash) return { ok: false, reasonEn: "Not enough Cash" };
  if ((cost.yield ?? 0) > res.yield) return { ok: false, reasonEn: "Not enough Yield" };
  if ((cost.alpha ?? 0) > res.alpha) return { ok: false, reasonEn: "Not enough Alpha" };
  if ((cost.tickets ?? 0) > res.tickets) return { ok: false, reasonEn: "Not enough Tickets" };
  if ((cost.mon ?? 0) > res.mon) return { ok: false, reasonEn: "Not enough MON" };
  if ((cost.faith ?? 0) > res.faith) return { ok: false, reasonEn: "Not enough Faith" };
  return { ok: true };
}

function applyCostAndReward(
  res: MechanicsResources,
  cost: ActionResourceMap,
  reward: ActionResourceMap,
  dayIndex: number,
  ticketFractionCarry: number
): { res: MechanicsResources; ticketFractionCarry: number } {
  const next: MechanicsResources = { ...res };
  next.cash = next.cash - (cost.cash ?? 0) + (reward.cash ?? 0);
  next.yield = next.yield - (cost.yield ?? 0) + (reward.yield ?? 0);
  next.alpha = next.alpha - (cost.alpha ?? 0) + (reward.alpha ?? 0);
  next.faith = next.faith - (cost.faith ?? 0) + (reward.faith ?? 0);
  if (dayIndex >= 2) next.mon = next.mon - (cost.mon ?? 0) + (reward.mon ?? 0);

  const ticketDelta = (reward.tickets ?? 0) - (cost.tickets ?? 0);
  const ticketFloat = ticketFractionCarry + ticketDelta;
  const ticketWhole = Math.floor(ticketFloat);
  const ticketFracNext = ticketFloat - ticketWhole;
  next.tickets = next.tickets + ticketWhole;

  return {
    res: clampResourcesToCaps(next),
    ticketFractionCarry: Math.max(0, Math.min(0.999, ticketFracNext))
  };
}

export function loadMechanicsState(): MechanicsState {
  return defaultMechanicsState();
}

export function saveMechanicsState(state: MechanicsState): void {
  void state;
}

export function getCooldownLeftMs(state: MechanicsState, key: string, cooldownSec: number, nowMs: number): number {
  const last = state.lastActionMs[key] ?? 0;
  const readyAt = last + cooldownSec * 1000;
  return Math.max(0, readyAt - nowMs);
}

export function addDebuff(mech: MechanicsState, id: DebuffId, durationMs: number, nowMs: number): MechanicsState {
  const next = pruneExpiredDebuffs(mech, nowMs);
  return {
    ...next,
    debuffs: [...next.debuffs, { id, expiresAtMs: nowMs + durationMs }]
  };
}

export function removeDebuff(mech: MechanicsState, id: DebuffId): MechanicsState {
  const next = pruneExpiredDebuffs(mech, Date.now());
  return {
    ...next,
    debuffs: next.debuffs.filter((debuff) => debuff.id !== id)
  };
}

export function clearDebuffs(mech: MechanicsState): MechanicsState {
  if (mech.debuffs.length === 0) return mech;
  return {
    ...mech,
    debuffs: []
  };
}

export function pruneExpiredDebuffs(mech: MechanicsState, nowMs: number): MechanicsState {
  const debuffs = mech.debuffs.filter((debuff) => debuff.expiresAtMs > nowMs);
  if (debuffs.length === mech.debuffs.length) return mech;
  return { ...mech, debuffs };
}

export function getThreatModifiers(mech: MechanicsState, nowMs: number): {
  passiveYieldMul: number;
  passiveAlphaMul: number;
  cashDrainPerSec: number;
  actionCashCostMul: number;
  buildTimeMul: number;
  actionJamChance: number;
} {
  const pruned = pruneExpiredDebuffs(mech, nowMs);
  const fudPenalty = Math.min(0.95, (1 - 0.75) * THREAT_EFFECT_MULTIPLIER);
  const kolCashDrain = 0.6 * THREAT_EFFECT_MULTIPLIER;
  const kolActionCashExtra = (1.1 - 1) * THREAT_EFFECT_MULTIPLIER;
  const impostorBuildExtra = (1.15 - 1) * THREAT_EFFECT_MULTIPLIER;
  const impostorJam = Math.min(0.95, 0.22 * THREAT_EFFECT_MULTIPLIER);
  let passiveYieldMul = 1;
  let passiveAlphaMul = 1;
  let cashDrainPerSec = 0;
  let actionCashCostMul = 1;
  let buildTimeMul = 1;
  let actionJamChance = 0;
  for (const debuff of pruned.debuffs) {
    if (debuff.id === "fuders") {
      passiveYieldMul *= Math.max(0.05, 1 - fudPenalty);
      passiveAlphaMul *= Math.max(0.05, 1 - fudPenalty);
    } else if (debuff.id === "kol_shills") {
      cashDrainPerSec += kolCashDrain;
      actionCashCostMul *= 1 + kolActionCashExtra;
    } else if (debuff.id === "impostors") {
      buildTimeMul *= 1 + impostorBuildExtra;
      actionJamChance += impostorJam;
    }
  }
  if (pruned.yieldBoostUntilMs > nowMs) {
    passiveYieldMul *= pruned.yieldBoostMul > 0 ? pruned.yieldBoostMul : 1;
  }
  return {
    passiveYieldMul,
    passiveAlphaMul,
    cashDrainPerSec,
    actionCashCostMul,
    buildTimeMul,
    actionJamChance: Math.min(0.95, actionJamChance)
  };
}

export function tickThreats(
  nowMs: number,
  dayIndex: number,
  placements: Record<string, { buildingId: string; tier: number } | null>,
  mech: MechanicsState
): MechanicsState {
  let next = pruneExpiredDebuffs(mech, nowMs);
  // Impostors event is disabled: drop it from active debuffs as well.
  const withoutImpostors = next.debuffs.filter((debuff) => debuff.id !== "impostors");
  if (withoutImpostors.length !== next.debuffs.length) {
    next = { ...next, debuffs: withoutImpostors };
  }
  if (next.debuffs.length >= 2) return next;
  const hasRadar = Object.values(placements).some((item) => item?.buildingId === "narrative_radar");
  const hasInsurance = Object.values(placements).some((item) => item?.buildingId === "cold_vault_insurance");
  let spawnChance = (dayIndex >= 2 ? 0.015 : 0.005) / THREAT_SPAWN_RATE_DIVISOR;
  if (hasRadar) spawnChance *= 0.6;
  if (hasInsurance && next.coverageUntilMs > nowMs) spawnChance *= 0.4;
  if (Math.random() > spawnChance) return next;
  const pool: DebuffId[] = ["fuders", "kol_shills"];
  const notActive = pool.filter((id) => !next.debuffs.some((debuff) => debuff.id === id));
  if (notActive.length === 0) return next;
  const picked = notActive[Math.floor(Math.random() * notActive.length)];
  return addDebuff(next, picked, (dayIndex >= 2 ? 4 : 2) * 60_000, nowMs);
}

export function getCharges(
  actionKey: string,
  nowMs: number,
  mech: MechanicsState = defaultMechanicsState()
): { charges: number; cap: number; nextChargeInMs: number } {
  const [buildingIdRaw, actionIdRaw] = actionKey.split(":");
  if (!buildingIdRaw || !actionIdRaw) {
    return { charges: 0, cap: GLOBAL_CHARGE_CAP, nextChargeInMs: GLOBAL_CHARGE_PERIOD_MS };
  }
  if (isHarvestAction(buildingIdRaw as BuildingId, actionIdRaw)) {
    const accrued = accrueGlobalCharges(mech, nowMs);
    const gc = accrued.globalCharges;
    const nextChargeInMs = gc.charges >= GLOBAL_CHARGE_CAP ? 0 : Math.max(0, GLOBAL_CHARGE_PERIOD_MS - (nowMs - gc.lastAccrueAtMs));
    return {
      charges: gc.charges,
      cap: GLOBAL_CHARGE_CAP,
      nextChargeInMs
    };
  }
  return {
    charges: 1,
    cap: 1,
    nextChargeInMs: 0
  };
}

export interface TryUseActionParams extends UseActionParams {
  mode: "one" | "all";
}

export function tryUseAction(params: TryUseActionParams): UseActionResult {
  const { nowMs, dayIndex, startedAtMs, buildingId, actionId, tier } = params;
  const effectiveDayIndex = computeDayIndexFromStartedAtMs(nowMs, startedAtMs) ?? dayIndex;
  const building = BUILDINGS_BY_ID[buildingId];
  const action = building.actionsEn.find((item) => item.id === actionId);
  if (!action) {
    return { ok: false, reasonEn: "Action not found", newRes: params.res, newMech: params.mech };
  }

  const actionKey = `${buildingId}:${actionId}`;
  let mech = pruneExpiredDebuffs(params.mech, nowMs);
  mech = ensureRaidDaily(mech, effectiveDayIndex);
  let chargesUsed = 0;
  if (isHarvestAction(buildingId, actionId)) {
    mech = accrueGlobalCharges(mech, nowMs);
    const globalCharges = mech.globalCharges ?? { lastAccrueAtMs: nowMs, charges: 0 };
    if (globalCharges.charges <= 0) {
      return {
        ok: false,
        reasonEn: "No charges",
        newRes: params.res,
        newMech: mech
      };
    }
    chargesUsed = 1;
    mech = {
      ...mech,
      globalCharges: {
        ...globalCharges,
        charges: Math.max(0, globalCharges.charges - 1)
      }
    };
  }
  const cooldownLeftMs = getCooldownLeftMs(mech, actionKey, action.cooldownSec, nowMs);
  if (cooldownLeftMs > 0) {
    return { ok: false, reasonEn: "Action blocked by cooldown", newRes: params.res, newMech: mech };
  }
  const mods = getThreatModifiers(mech, nowMs);
  if (mods.actionJamChance > 0 && Math.random() < mods.actionJamChance) {
    const jamAlphaPenalty = 6 * (1 + (tier - 1) * 0.25);
    let jammedRes = { ...params.res };
    if (jammedRes.alpha >= jamAlphaPenalty) {
      jammedRes.alpha -= jamAlphaPenalty;
    }
    mech = {
      ...mech,
      lastActionMs: {
        ...mech.lastActionMs,
        [actionKey]: nowMs - (action.cooldownSec * 1000 - 8_000)
      }
    };
    return { ok: false, reasonEn: "Impostors jammed the action", newRes: jammedRes, newMech: mech };
  }

  const scale = normalizeScale(action.tierScale, tier);
  const costScaled = scaleResourceMap(action.cost, scale);
  const rewardScaled = scaleResourceMap(action.reward, scale);
  const rewardAdjusted = { ...rewardScaled };
  const rewardMulByCharges = 1;
  rewardAdjusted.cash = rewardAdjusted.cash != null ? rewardAdjusted.cash * rewardMulByCharges : undefined;
  rewardAdjusted.yield = rewardAdjusted.yield != null ? rewardAdjusted.yield * rewardMulByCharges : undefined;
  rewardAdjusted.alpha = rewardAdjusted.alpha != null ? rewardAdjusted.alpha * rewardMulByCharges : undefined;
  rewardAdjusted.tickets = rewardAdjusted.tickets != null ? rewardAdjusted.tickets * rewardMulByCharges : undefined;
  rewardAdjusted.mon = rewardAdjusted.mon != null ? rewardAdjusted.mon * rewardMulByCharges : undefined;
  rewardAdjusted.faith = rewardAdjusted.faith != null ? rewardAdjusted.faith * rewardMulByCharges : undefined;
  if (buildingId === "raid_dock_alpha_desk" && (actionId === "launch_raid" || actionId === "intel_bribe")) {
    const usesToday = actionId === "launch_raid" ? mech.raidDaily.launchRaidUses : mech.raidDaily.intelBribeUses;
    const cap = actionId === "launch_raid" ? 6 : 8;
    if (usesToday >= cap) {
      return {
        ok: false,
        reasonEn: actionId === "launch_raid" ? "Launch Raid daily cap reached" : "Intel Bribe daily cap reached",
        newRes: params.res,
        newMech: mech
      };
    }
    const rewardMul = getRaidRewardMultiplier(usesToday);
    rewardAdjusted.cash = rewardAdjusted.cash != null ? rewardAdjusted.cash * rewardMul : undefined;
    rewardAdjusted.yield = rewardAdjusted.yield != null ? rewardAdjusted.yield * rewardMul : undefined;
    rewardAdjusted.alpha = rewardAdjusted.alpha != null ? rewardAdjusted.alpha * rewardMul : undefined;
    rewardAdjusted.tickets = rewardAdjusted.tickets != null ? rewardAdjusted.tickets * rewardMul : undefined;
    rewardAdjusted.mon = rewardAdjusted.mon != null ? rewardAdjusted.mon * rewardMul : undefined;
    rewardAdjusted.faith = rewardAdjusted.faith != null ? rewardAdjusted.faith * rewardMul : undefined;
    rewardAdjusted.cash = rewardAdjusted.cash != null ? rewardAdjusted.cash * RAID_REWARD_SAFETY_MUL : undefined;
    rewardAdjusted.yield = rewardAdjusted.yield != null ? rewardAdjusted.yield * RAID_REWARD_SAFETY_MUL : undefined;
    rewardAdjusted.alpha = rewardAdjusted.alpha != null ? rewardAdjusted.alpha * RAID_REWARD_SAFETY_MUL : undefined;
    rewardAdjusted.tickets = rewardAdjusted.tickets != null ? rewardAdjusted.tickets * RAID_REWARD_SAFETY_MUL : undefined;
    rewardAdjusted.mon = rewardAdjusted.mon != null ? rewardAdjusted.mon * RAID_REWARD_SAFETY_MUL : undefined;
    rewardAdjusted.faith = rewardAdjusted.faith != null ? rewardAdjusted.faith * RAID_REWARD_SAFETY_MUL : undefined;
  }
  if (buildingId === "raid_dock_alpha_desk" && actionId === "launch_raid") {
    rewardAdjusted.cash = 0;
    rewardAdjusted.alpha = 0;
    rewardAdjusted.tickets = 0;
    rewardAdjusted.yield = 0;
    rewardAdjusted.mon = 0;
    rewardAdjusted.faith = 0;
  }
  if (buildingId === "raid_dock_alpha_desk" && actionId === "intel_bribe") {
    rewardAdjusted.cash = 0;
    rewardAdjusted.tickets = 0;
  }
  if (buildingId === "cold_vault_insurance" && (actionId === "activate_coverage" || actionId === "claim_payout")) {
    rewardAdjusted.cash = 0;
    rewardAdjusted.alpha = 0;
    rewardAdjusted.yield = 0;
    rewardAdjusted.tickets = 0;
    rewardAdjusted.mon = 0;
    rewardAdjusted.faith = 0;
  }
  if (buildingId === "yield_router_station" && actionId === "route_yield") {
    rewardAdjusted.cash = 0;
    rewardAdjusted.alpha = 0;
    rewardAdjusted.yield = 0;
    rewardAdjusted.tickets = 0;
    rewardAdjusted.mon = 0;
    rewardAdjusted.faith = 0;
  }
  if ((costScaled.cash ?? 0) > 0) costScaled.cash = (costScaled.cash ?? 0) * mods.actionCashCostMul;
  const afford = canPayCost(params.res, costScaled, effectiveDayIndex);
  if (!afford.ok) {
    return { ok: false, reasonEn: afford.reasonEn, newRes: params.res, newMech: mech };
  }

  const applied = applyCostAndReward(params.res, costScaled, rewardAdjusted, effectiveDayIndex, mech.ticketFractionCarry);
  let nextRes = applied.res;
  let toastEn = `${action.label} activated`;
  let nextMech: MechanicsState = {
    ...mech,
    ticketFractionCarry: applied.ticketFractionCarry
  };
  if (buildingId === "booster_forge") {
    if (actionId === "ignite_booster") nextMech.boostCharges += 1;
    if (actionId === "overclock_line") {
      if (nextMech.boostCharges <= 0) return { ok: false, reasonEn: "No Boost Charges", newRes: params.res, newMech: mech };
      nextMech.boostCharges -= 1;
    }
  }

  if (buildingId === "yield_router_station" && actionId === "toggle_mode") {
    nextMech.yieldMode = nextMech.yieldMode === "safe" ? "aggro" : "safe";
    toastEn = `Yield mode switched to ${nextMech.yieldMode.toUpperCase()}`;
  }

  if (buildingId === "rehab_bay" && actionId === "rehab_protocol") {
    if (nextMech.debuffs.length === 0) {
      return { ok: false, reasonEn: "No debuffs to cleanse", newRes: params.res, newMech: mech };
    }
    let cleansesLeft = 1;
    while (cleansesLeft > 0 && nextMech.debuffs.length > 0) {
      const sorted = [...nextMech.debuffs].sort((a, b) => b.expiresAtMs - a.expiresAtMs);
      const target = sorted[0];
      if (nextMech.debuffs.length > 1) {
        nextMech.debuffs = nextMech.debuffs.filter((debuff) => debuff !== target);
        toastEn = `Rehab cleared: ${DEBUFFS[target.id].nameEn}`;
      } else {
        nextMech.debuffs = nextMech.debuffs.map((debuff) =>
          debuff === target
            ? { ...debuff, expiresAtMs: Math.max(nowMs, debuff.expiresAtMs - 120_000) }
            : debuff
        );
        toastEn = `Rehab reduced: ${DEBUFFS[target.id].nameEn}`;
      }
      cleansesLeft -= 1;
    }
  }

  if (buildingId === "cold_vault_insurance" && actionId === "activate_coverage") {
    nextMech.coverageUntilMs = nowMs + 30 * 60_000;
  }
  if (buildingId === "cold_vault_insurance" && actionId === "claim_payout") {
    nextMech.coverageUntilMs = nowMs + 30 * 60_000;
    toastEn = "Coverage extended";
  }

  if (buildingId === "whale_tap" && actionId === "tap_whale") {
    if (nextRes.faith < 60 && Math.random() < 0.2) {
      nextMech = addDebuff(nextMech, "kol_shills", 4 * 60_000, nowMs);
      toastEn = "KOL Shills infiltrated the channel";
    }
  }

  if (buildingId === "raid_dock_alpha_desk" && actionId === "launch_raid") {
    const rewardMul = getRaidRewardMultiplier(mech.raidDaily.launchRaidUses);
    nextRes.cash += 250 * rewardMul;
    nextRes.alpha += 20 * rewardMul;
    const ticketFloat = nextMech.ticketFractionCarry + 0.25 * rewardMul;
    const gainedWholeTickets = Math.floor(ticketFloat);
    nextMech.ticketFractionCarry = ticketFloat - gainedWholeTickets;
    if (gainedWholeTickets > 0) nextRes.tickets += gainedWholeTickets;
    nextMech.raidDaily = {
      ...nextMech.raidDaily,
      launchRaidUses: nextMech.raidDaily.launchRaidUses + 1
    };
    toastEn = "Raid executed";
  }

  if (buildingId === "raid_dock_alpha_desk" && actionId === "intel_bribe") {
    const rewardMul = getRaidRewardMultiplier(mech.raidDaily.intelBribeUses);
    nextRes.alpha += 28 * rewardMul;
    const ticketFloat = nextMech.ticketFractionCarry + 0.25 * rewardMul;
    const gainedWholeTickets = Math.floor(ticketFloat);
    nextMech.ticketFractionCarry = ticketFloat - gainedWholeTickets;
    if (gainedWholeTickets > 0) nextRes.tickets += gainedWholeTickets;
    nextMech.raidDaily = {
      ...nextMech.raidDaily,
      intelBribeUses: nextMech.raidDaily.intelBribeUses + 1
    };
    toastEn = "Bribe routed into Alpha intel";
  }

  if (buildingId === "yield_router_station" && actionId === "route_yield") {
    nextMech.yieldBoostUntilMs = nowMs + 20 * 60_000;
    nextMech.yieldBoostMul = 1.15;
    toastEn = "Yield boost active";
  }

  if (buildingId === "openclaw_lab" && actionId === "run_experiment") {
    nextMech.perks = [...nextMech.perks, "+5% Cash/sec"];
  }

  if (buildingId === "command_pit_egg_council_hq" && actionId === "issue_order") {
    nextMech.perks = [...nextMech.perks, "+10% build speed next job"];
  }

  if (buildingId === "narrative_radar" && actionId === "counter_signal" && nextMech.debuffs.length > 0) {
    const sorted = [...nextMech.debuffs].sort((a, b) => b.expiresAtMs - a.expiresAtMs);
    sorted[0] = { ...sorted[0], expiresAtMs: Math.max(nowMs, sorted[0].expiresAtMs - 60_000) };
    nextMech.debuffs = sorted;
  }

  if (buildingId === "hype_farm" && actionId === "farm_hype") {
    if (Math.random() < 0.15) {
      nextMech = addDebuff(nextMech, "fuders", 3 * 60_000, nowMs);
      toastEn = "FUDers stirred by hype overuse";
    }
  }

  nextRes = clampResourcesToCaps(nextRes);

  return {
    ok: true,
    newRes: nextRes,
    newMech: nextMech,
    toastEn,
    chargesUsed: chargesUsed > 0 ? chargesUsed : undefined
  };
}

export function runEconomyDebugSimulation(nowMs = Date.now()): {
  capsAfterPlacement: ReturnType<typeof getResourceCaps>;
  after12h: MechanicsResources;
  after6Harvest: MechanicsResources;
  after3Days: MechanicsResources;
  canAffordRugT3: boolean;
} {
  const placements: Record<string, { buildingId: string; tier: 1 | 2 | 3 | 4 } | null> = {
    cell_1: { buildingId: "command_pit_egg_council_hq", tier: 1 },
    cell_2: { buildingId: "rug_salvage_yard", tier: 1 },
    cell_3: { buildingId: "narrative_radar", tier: 1 },
    cell_4: { buildingId: "yield_router_station", tier: 1 }
  };
  setPassiveRatesFromPlacements(placements);
  const initial: ResourceState = {
    res: { cash: 600, yield: 0, alpha: 0, tickets: 1, mon: 0, faith: 0 },
    startedAtMs: nowMs,
    lastTickMs: nowMs
  };

  const after12h = tickResources(initial, nowMs + 12 * 60 * 60_000);
  const after6HarvestRes = clampResourcesToCaps({
    ...after12h.res,
    cash: after12h.res.cash + 6 * 90
  });
  let simRes = { ...after6HarvestRes };
  const sessions = 6;
  for (let i = 0; i < sessions; i += 1) {
    simRes = clampResourcesToCaps({
      ...simRes,
      cash: simRes.cash + 3 * 90 + 35,
      alpha: simRes.alpha + 2 * 45 + 40,
      yield: simRes.yield + 55
    });
    simRes = tickResources(
      {
        res: simRes,
        startedAtMs: nowMs,
        lastTickMs: nowMs + (i + 1) * 12 * 60 * 60_000
      },
      nowMs + (i + 2) * 12 * 60 * 60_000
    ).res;
  }
  const canAffordRugT3 = simRes.cash >= 2400 && simRes.alpha >= 30 && simRes.yield >= 120 && simRes.tickets >= 1;
  console.log("[RR Sim] Caps:", getResourceCaps());
  console.log("[RR Sim] After 12h:", after12h.res);
  console.log("[RR Sim] After 6 global charges:", after6HarvestRes);
  console.log("[RR Sim] After 3 days (2 sessions/day):", simRes);
  console.log("[RR Sim] Can afford Rug T3:", canAffordRugT3);
  return {
    capsAfterPlacement: getResourceCaps(),
    after12h: after12h.res,
    after6Harvest: after6HarvestRes,
    after3Days: simRes,
    canAffordRugT3
  };
}

export function useAction(params: UseActionParams): UseActionResult {
  return tryUseAction({ ...params, mode: "one" });
}
