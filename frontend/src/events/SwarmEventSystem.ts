import { BASE_MAP_HEIGHT, BASE_MAP_WIDTH } from "../base/cellLayout";
import type { DebuffId } from "../base/mechanics";
import { SWARM_CONFIG, SWARM_DEFAULT_WIPE_DAMAGE, SWARM_DEFAULT_WIPE_RADIUS } from "./swarmConfig";

export interface SwarmUnit {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  label: string;
  nextLabelAtMs: number;
  hitUntilMs: number;
}

export interface SwarmImpact {
  debuffId: DebuffId;
  cellId: string;
  x: number;
  y: number;
  cashLossText: number;
}

export interface SwarmFinishResult {
  debuffId: DebuffId;
  cleaned: number;
  total: number;
  cashSaved: number;
  perfect: boolean;
}

export interface SwarmInstance {
  debuffId: DebuffId;
  units: SwarmUnit[];
  totalUnits: number;
  orbitAngle: number;
  nextLungeAtMs: number;
  lungeTargetCellId: string | null;
  lungeUntilMs: number;
  lungeImpactDone: boolean;
}

export interface SwarmSystemState {
  byDebuff: Partial<Record<DebuffId, SwarmInstance>>;
}

export interface SwarmTickResult {
  state: SwarmSystemState;
  impacts: SwarmImpact[];
  finished: SwarmFinishResult[];
  extraDrainPerSec: number;
}

export interface SwarmWipeResult {
  state: SwarmSystemState;
  hits: number;
  kills: number;
  remaining: number;
  total: number;
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomRange(min, max + 1));
}

function randomLabel(id: DebuffId): string {
  const list = SWARM_CONFIG[id].labels;
  return list[Math.floor(Math.random() * list.length)];
}

function makeUnit(id: DebuffId, centerX: number, centerY: number, nowMs: number): SwarmUnit {
  const angle = randomRange(0, Math.PI * 2);
  const radius = randomRange(34, 70);
  return {
    id: crypto.randomUUID(),
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius,
    vx: randomRange(-1.2, 1.2),
    vy: randomRange(-1.2, 1.2),
    hp: randomInt(1, 3),
    label: randomLabel(id),
    nextLabelAtMs: nowMs + randomRange(1500, 3000),
    hitUntilMs: 0
  };
}

function spawnSwarm(id: DebuffId, nowMs: number): SwarmInstance {
  const cfg = SWARM_CONFIG[id];
  const total = randomInt(cfg.spawnMin, cfg.spawnMax);
  const centerX = BASE_MAP_WIDTH * 0.5;
  const centerY = BASE_MAP_HEIGHT * 0.5;
  const units = Array.from({ length: total }).map(() => makeUnit(id, centerX, centerY, nowMs));
  return {
    debuffId: id,
    units,
    totalUnits: total,
    orbitAngle: randomRange(0, Math.PI * 2),
    nextLungeAtMs: nowMs + randomRange(cfg.lungeMinMs, cfg.lungeMaxMs),
    lungeTargetCellId: null,
    lungeUntilMs: 0,
    lungeImpactDone: false
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function createSwarmSystemState(): SwarmSystemState {
  return { byDebuff: {} };
}

export function getSwarmExtraDrainPerSec(state: SwarmSystemState): number {
  let drain = 0;
  for (const id of Object.keys(state.byDebuff) as DebuffId[]) {
    const swarm = state.byDebuff[id];
    if (!swarm) continue;
    const cfg = SWARM_CONFIG[id];
    drain += cfg.baseDrainPerSec + cfg.perUnitDrainPerSec * swarm.units.length;
  }
  return drain;
}

export function tickSwarmSystem(
  prev: SwarmSystemState,
  nowMs: number,
  placedCenters: Record<string, { x: number; y: number }>,
  activeDebuffs: DebuffId[]
): SwarmTickResult {
  const next: SwarmSystemState = {
    byDebuff: { ...prev.byDebuff }
  };
  const impacts: SwarmImpact[] = [];
  const finished: SwarmFinishResult[] = [];
  const activeSet = new Set(activeDebuffs);

  for (const id of activeDebuffs) {
    if (!next.byDebuff[id]) {
      next.byDebuff[id] = spawnSwarm(id, nowMs);
    }
  }

  for (const id of Object.keys(next.byDebuff) as DebuffId[]) {
    const swarm = next.byDebuff[id];
    if (!swarm) continue;
    if (!activeSet.has(id)) {
      finished.push({
        debuffId: id,
        cleaned: swarm.totalUnits - swarm.units.length,
        total: swarm.totalUnits,
        cashSaved: Math.round((swarm.totalUnits - swarm.units.length) * 12),
        perfect: swarm.units.length === 0
      });
      delete next.byDebuff[id];
      continue;
    }

    const cfg = SWARM_CONFIG[id];
    const placedCellIds = Object.keys(placedCenters);
    if (swarm.lungeTargetCellId == null && placedCellIds.length > 0 && nowMs >= swarm.nextLungeAtMs) {
      swarm.lungeTargetCellId = placedCellIds[Math.floor(Math.random() * placedCellIds.length)];
      swarm.lungeUntilMs = nowMs + cfg.lungeDurationMs;
      swarm.lungeImpactDone = false;
    }
    if (swarm.lungeTargetCellId && nowMs >= swarm.lungeUntilMs) {
      swarm.lungeTargetCellId = null;
      swarm.nextLungeAtMs = nowMs + randomRange(cfg.lungeMinMs, cfg.lungeMaxMs);
    }

    swarm.orbitAngle += 0.024 + cfg.chaos * 0.01;
    const orbitTargetX = BASE_MAP_WIDTH * 0.5 + Math.cos(swarm.orbitAngle) * 170;
    const orbitTargetY = BASE_MAP_HEIGHT * 0.5 + Math.sin(swarm.orbitAngle) * 118;

    const lungeTarget = swarm.lungeTargetCellId ? placedCenters[swarm.lungeTargetCellId] : null;
    const targetX = lungeTarget?.x ?? orbitTargetX;
    const targetY = lungeTarget?.y ?? orbitTargetY;
    let centroidX = 0;
    let centroidY = 0;

    swarm.units = swarm.units.map((unit) => {
      if (nowMs >= unit.nextLabelAtMs) {
        unit.label = randomLabel(id);
        unit.nextLabelAtMs = nowMs + randomRange(1500, 3000);
      }
      const dx = targetX - unit.x;
      const dy = targetY - unit.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const pull = swarm.lungeTargetCellId ? 1.15 : 0.32;
      unit.vx += (dx / dist) * pull + randomRange(-0.07, 0.07) * cfg.chaos;
      unit.vy += (dy / dist) * pull + randomRange(-0.07, 0.07) * cfg.chaos;
      unit.vx *= 0.9;
      unit.vy *= 0.9;
      unit.vx = clamp(unit.vx, -5.2, 5.2);
      unit.vy = clamp(unit.vy, -5.2, 5.2);
      unit.x = clamp(unit.x + unit.vx, 24, BASE_MAP_WIDTH - 24);
      unit.y = clamp(unit.y + unit.vy, 24, BASE_MAP_HEIGHT - 24);
      centroidX += unit.x;
      centroidY += unit.y;
      return unit;
    });

    if (swarm.units.length > 0) {
      centroidX /= swarm.units.length;
      centroidY /= swarm.units.length;
    } else {
      centroidX = targetX;
      centroidY = targetY;
    }

    if (swarm.lungeTargetCellId && !swarm.lungeImpactDone && lungeTarget) {
      const distToTarget = Math.hypot(centroidX - lungeTarget.x, centroidY - lungeTarget.y);
      if (distToTarget <= 56) {
        impacts.push({
          debuffId: id,
          cellId: swarm.lungeTargetCellId,
          x: lungeTarget.x,
          y: lungeTarget.y,
          cashLossText: id === "kol_shills" ? randomInt(8, 16) : randomInt(4, 10)
        });
        swarm.lungeImpactDone = true;
      }
    }
  }

  return {
    state: next,
    impacts,
    finished,
    extraDrainPerSec: getSwarmExtraDrainPerSec(next)
  };
}

export function applySwarmWipe(
  prev: SwarmSystemState,
  debuffId: DebuffId,
  centerX: number,
  centerY: number,
  nowMs: number,
  radius = SWARM_DEFAULT_WIPE_RADIUS,
  damage = SWARM_DEFAULT_WIPE_DAMAGE
): SwarmWipeResult {
  const swarm = prev.byDebuff[debuffId];
  if (!swarm) {
    return { state: prev, hits: 0, kills: 0, remaining: 0, total: 0 };
  }
  const next: SwarmSystemState = {
    byDebuff: { ...prev.byDebuff }
  };
  const clone: SwarmInstance = {
    ...swarm,
    units: [...swarm.units]
  };
  let hits = 0;
  let kills = 0;
  clone.units = clone.units
    .map((unit) => {
      const dx = unit.x - centerX;
      const dy = unit.y - centerY;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) return unit;
      hits += 1;
      const knock = Math.max(0.4, 1 - dist / Math.max(1, radius));
      const nx = dist > 0 ? dx / dist : randomRange(-1, 1);
      const ny = dist > 0 ? dy / dist : randomRange(-1, 1);
      const hp = unit.hp - damage;
      if (hp <= 0) {
        kills += 1;
      }
      return {
        ...unit,
        hp,
        vx: unit.vx + nx * 2.4 * knock,
        vy: unit.vy + ny * 2.4 * knock,
        hitUntilMs: nowMs + 220
      };
    })
    .filter((unit) => unit.hp > 0);

  next.byDebuff[debuffId] = clone;
  return {
    state: next,
    hits,
    kills,
    remaining: clone.units.length,
    total: clone.totalUnits
  };
}
