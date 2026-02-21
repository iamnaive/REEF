import type { DebuffId } from "../base/mechanics";

export interface SwarmDebuffConfig {
  spawnMin: number;
  spawnMax: number;
  baseDrainPerSec: number;
  perUnitDrainPerSec: number;
  lungeMinMs: number;
  lungeMaxMs: number;
  lungeDurationMs: number;
  chaos: number;
  labels: string[];
}

export const SWARM_CONFIG: Record<DebuffId, SwarmDebuffConfig> = {
  fuders: {
    spawnMin: 10,
    spawnMax: 14,
    baseDrainPerSec: 0.18,
    perUnitDrainPerSec: 0.045,
    lungeMinMs: 1800,
    lungeMaxMs: 3200,
    lungeDurationMs: 1200,
    chaos: 0.9,
    labels: ["SCAM", "RUG", "DEAD", "NGMI", "SELL", "FAKE", "EXIT", "L"]
  },
  kol_shills: {
    spawnMin: 8,
    spawnMax: 12,
    baseDrainPerSec: 0.0,
    perUnitDrainPerSec: 0.015,
    lungeMinMs: 2300,
    lungeMaxMs: 3800,
    lungeDurationMs: 1250,
    chaos: 0.55,
    labels: ["BUY NOW", "ALPHA", "100x", "SPONSORED", "FOLLOW", "NEW META"]
  },
  impostors: {
    spawnMin: 6,
    spawnMax: 10,
    baseDrainPerSec: 0.08,
    perUnitDrainPerSec: 0.02,
    lungeMinMs: 2100,
    lungeMaxMs: 3400,
    lungeDurationMs: 1150,
    chaos: 0.7,
    labels: ["OFFICIAL", "VERIFY", "CLAIM", "AIRDROP", "LINK"]
  }
};

export const SWARM_DEFAULT_WIPE_RADIUS = 80;
export const SWARM_DEFAULT_WIPE_DAMAGE = 1;
