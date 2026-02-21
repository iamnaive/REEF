import { BUILDINGS, type BuildingId, type TierCost } from "./buildings";

export type Tier = 1 | 2 | 3 | 4;

export interface Cost {
  cash?: number;
  yield?: number;
  alpha?: number;
  tickets?: number;
  mon?: number;
}

export interface BuildingTierEconomy {
  buildTimeMs: number;
  upgradeTimeMs: number;
  cost: Cost;
}

export interface BuildingEconomy {
  id: string;
  tiers: Record<Tier, BuildingTierEconomy>;
}

const BUILD_TIME_MS = 45_000;
const TIER_2_UPGRADE_MS = 8 * 60_000;
const TIER_3_UPGRADE_MS = 60 * 60_000;
const TIER_4_UPGRADE_MS = 6 * 60 * 60_000;

function timeForTier(tier: Tier): number {
  if (tier === 1) return BUILD_TIME_MS;
  if (tier === 2) return TIER_2_UPGRADE_MS;
  if (tier === 3) return TIER_3_UPGRADE_MS;
  return TIER_4_UPGRADE_MS;
}

function toCost(cost: TierCost): Cost {
  return {
    cash: cost.cash,
    yield: cost.yield,
    alpha: cost.alpha,
    tickets: cost.tickets,
    mon: cost.mon
  };
}

function makeBuildingEconomy(id: BuildingId, costsByTier: Record<Tier, TierCost>): BuildingEconomy {
  return {
    id,
    tiers: {
      1: {
        buildTimeMs: BUILD_TIME_MS,
        upgradeTimeMs: timeForTier(1),
        cost: toCost(costsByTier[1])
      },
      2: {
        buildTimeMs: BUILD_TIME_MS,
        upgradeTimeMs: timeForTier(2),
        cost: toCost(costsByTier[2])
      },
      3: {
        buildTimeMs: BUILD_TIME_MS,
        upgradeTimeMs: timeForTier(3),
        cost: toCost(costsByTier[3])
      },
      4: {
        buildTimeMs: BUILD_TIME_MS,
        upgradeTimeMs: timeForTier(4),
        cost: toCost(costsByTier[4])
      }
    }
  };
}

export const ECONOMY: Record<BuildingId, BuildingEconomy> = BUILDINGS.reduce(
  (acc, building) => {
    acc[building.id] = makeBuildingEconomy(building.id, building.costsByTier);
    return acc;
  },
  {} as Record<BuildingId, BuildingEconomy>
);
