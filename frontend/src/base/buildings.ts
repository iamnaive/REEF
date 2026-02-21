import type { Tier } from "./economy";

export type BuildingId =
  | "booster_forge"
  | "cold_vault_insurance"
  | "command_pit_egg_council_hq"
  | "cult"
  | "hype_farm"
  | "memes_market"
  | "narrative_radar"
  | "openclaw_lab"
  | "raid_dock_alpha_desk"
  | "rehab_bay"
  | "rug_salvage_yard"
  | "whale_tap"
  | "yield_router_station";

export interface TierCost {
  cash?: number;
  yield?: number;
  alpha?: number;
  tickets?: number;
  mon?: number;
}

export interface ActionResourceMap {
  cash?: number;
  yield?: number;
  alpha?: number;
  tickets?: number;
  mon?: number;
  faith?: number;
}

export interface BuildingActionDef {
  id: string;
  label: string;
  cooldownSec: number;
  help: string;
  cost?: ActionResourceMap;
  reward?: ActionResourceMap;
  tierScale?: "linear25" | "flat" | { byTier: { 1: number; 2: number; 3: number; 4: number } };
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
  buildPriority: number;
  folderName: string;
  assetBaseName?: string;
  costsByTier: Record<Tier, TierCost>;
  descriptionEn: string;
  passiveEn: string;
  actionsEn: BuildingActionDef[];
  tagEn?: string;
}

function makeTierCosts(baseCash: number, monAtT4?: number): Record<Tier, TierCost> {
  return {
    1: { cash: baseCash },
    2: { cash: Math.round(baseCash * 2.5), alpha: 10 },
    3: { cash: Math.round(baseCash * 8), alpha: 30, yield: 120, tickets: 1 },
    4: {
      cash: Math.round(baseCash * 25),
      alpha: 80,
      yield: 400,
      tickets: 2,
      ...(monAtT4 ? { mon: monAtT4 } : {})
    }
  };
}

export const BUILDINGS: BuildingDef[] = [
  {
    id: "booster_forge",
    name: "Booster Forge",
    buildPriority: 7,
    folderName: "Booster Forge",
    costsByTier: makeTierCosts(1200, 0.04),
    descriptionEn: "Crafts boost charges.",
    passiveEn: "Boosts Yield bursts.",
    tagEn: "Boost",
    actionsEn: [
      {
        id: "ignite_booster",
        label: "Ignite Booster",
        cooldownSec: 120,
        help: "Gain +1 Boost Charge.",
        cost: { cash: 520, alpha: 22 },
        reward: {},
        tierScale: "linear25"
      },
      {
        id: "overclock_line",
        label: "Overclock Line",
        cooldownSec: 95,
        help: "Yield spike from 1 Boost Charge.",
        cost: {},
        reward: { yield: 70 },
        tierScale: "linear25"
      }
    ]
  },
  {
    id: "cold_vault_insurance",
    name: "Cold Vault Insurance",
    buildPriority: 8,
    folderName: "Cold Vault Insurance",
    costsByTier: makeTierCosts(1600, 0.08),
    descriptionEn: "Protects from threat spikes.",
    passiveEn: "Stores short coverage window.",
    tagEn: "Defense",
    actionsEn: [
      {
        id: "activate_coverage",
        label: "Activate Coverage",
        cooldownSec: 180,
        help: "Enable 10m coverage.",
        cost: { tickets: 2, mon: 0.03 },
        reward: {},
        tierScale: "flat"
      },
      {
        id: "claim_payout",
        label: "Claim Payout",
        cooldownSec: 140,
        help: "Cash payout from active coverage.",
        cost: { tickets: 1 },
        reward: { cash: 220 },
        tierScale: "linear25"
      }
    ]
  },
  {
    id: "command_pit_egg_council_hq",
    name: "Command Pit Egg Council (HQ)",
    buildPriority: 1,
    folderName: "Command Pit Egg Council",
    assetBaseName: "Council",
    costsByTier: makeTierCosts(300, 0.12),
    descriptionEn: "Unlocks base control.",
    passiveEn: "Boosts next build speed.",
    tagEn: "Command",
    actionsEn: [
      {
        id: "issue_order",
        label: "Issue Order",
        cooldownSec: 90,
        help: "Gain Alpha + next build speed.",
        cost: {},
        reward: { alpha: 28 },
        tierScale: "linear25"
      },
      {
        id: "council_decree",
        label: "Council Decree",
        cooldownSec: 150,
        help: "Gain Faith + Tickets.",
        cost: { cash: 120 },
        reward: { faith: 14, tickets: 0.35 },
        tierScale: "linear25"
      }
    ]
  },
  {
    id: "cult",
    name: "Cult",
    buildPriority: 10,
    folderName: "Cult",
    costsByTier: makeTierCosts(900, 0.03),
    descriptionEn: "Converts Alpha and Faith.",
    passiveEn: "Stores Faith pressure.",
    tagEn: "Faith",
    actionsEn: [
      {
        id: "ritual_conversion",
        label: "Ritual Conversion",
        cooldownSec: 75,
        help: "Alpha to Faith.",
        cost: { alpha: 22 },
        reward: { faith: 26 },
        tierScale: "linear25"
      },
      {
        id: "fervor_drive",
        label: "Fervor Drive",
        cooldownSec: 110,
        help: "Faith to Alpha pulse.",
        cost: { faith: 14 },
        reward: { alpha: 30 },
        tierScale: "linear25"
      }
    ]
  },
  {
    id: "hype_farm",
    name: "Hype Farm",
    buildPriority: 13,
    folderName: "Hype Farm",
    costsByTier: makeTierCosts(980, 0.04),
    descriptionEn: "Converts Yield to Alpha.",
    passiveEn: "Boosts social conversion.",
    tagEn: "Convert",
    actionsEn: [
      {
        id: "farm_hype",
        label: "Farm Hype",
        cooldownSec: 70,
        help: "Yield to Alpha + small Cash.",
        cost: { yield: 55 },
        reward: { alpha: 40, cash: 35 },
        tierScale: "linear25"
      },
      {
        id: "viral_push",
        label: "Viral Push",
        cooldownSec: 105,
        help: "Buy Yield burst with Cash.",
        cost: { cash: 180 },
        reward: { yield: 85 },
        tierScale: "linear25"
      }
    ]
  },
  {
    id: "memes_market",
    name: "Memes Market",
    buildPriority: 3,
    folderName: "Memes Market",
    assetBaseName: "Memes",
    costsByTier: makeTierCosts(450, 0.05),
    descriptionEn: "Converts Alpha to Cash.",
    passiveEn: "Boosts quick trade flow.",
    tagEn: "Cash",
    actionsEn: [
      {
        id: "flip_memes",
        label: "Flip Memes",
        cooldownSec: 65,
        help: "Alpha to Cash burst.",
        cost: { alpha: 25 },
        reward: { cash: 240 },
        tierScale: "linear25"
      },
      {
        id: "liquidity_snipe",
        label: "Liquidity Snipe",
        cooldownSec: 120,
        help: "Tickets to Cash + Alpha.",
        cost: { tickets: 1 },
        reward: { cash: 180, alpha: 22 },
        tierScale: "linear25"
      }
    ]
  },
  {
    id: "narrative_radar",
    name: "Narrative Radar",
    buildPriority: 5,
    folderName: "Narrative Radar",
    costsByTier: makeTierCosts(600, 0.05),
    descriptionEn: "Scans narrative pressure.",
    passiveEn: "Boosts Alpha scouting.",
    tagEn: "Alpha",
    actionsEn: [
      {
        id: "scan_narrative",
        label: "Run Scan",
        cooldownSec: 55,
        help: "Gain Alpha + reveal hint.",
        cost: {},
        reward: { alpha: 45 },
        tierScale: "linear25"
      },
      {
        id: "counter_signal",
        label: "Counter Signal",
        cooldownSec: 100,
        help: "Weaken pressure + gain Cash.",
        cost: { alpha: 32 },
        reward: { cash: 320 },
        tierScale: "flat"
      }
    ]
  },
  {
    id: "openclaw_lab",
    name: "OpenClaw Lab",
    buildPriority: 11,
    folderName: "OpenClaw Lab",
    assetBaseName: "Lab",
    costsByTier: makeTierCosts(1300, 0.06),
    descriptionEn: "Crafts perks and modules.",
    passiveEn: "Boosts advanced ops.",
    tagEn: "Perk",
    actionsEn: [
      {
        id: "run_experiment",
        label: "Run Experiment",
        cooldownSec: 100,
        help: "Add 1 random Perk.",
        cost: { alpha: 46 },
        reward: {},
        tierScale: "linear25"
      },
      {
        id: "synthesize_module",
        label: "Synthesize Module",
        cooldownSec: 135,
        help: "Gain Alpha + Faith.",
        cost: { yield: 45, cash: 160 },
        reward: { alpha: 32, faith: 8 },
        tierScale: "linear25"
      }
    ]
  },
  {
    id: "raid_dock_alpha_desk",
    name: "Alpha Desk",
    buildPriority: 6,
    folderName: "ALPHA DESK",
    assetBaseName: "Desk",
    costsByTier: makeTierCosts(1400, 0.07),
    descriptionEn: "Launches raid operations.",
    passiveEn: "Boosts loot reliability.",
    tagEn: "Raid",
    actionsEn: [
      {
        id: "launch_raid",
        label: "Launch Raid",
        cooldownSec: 110,
        help: "Random loot roll.",
        cost: { tickets: 1 },
        reward: {},
        tierScale: "flat"
      },
      {
        id: "intel_bribe",
        label: "Intel Bribe",
        cooldownSec: 85,
        help: "Gain Alpha + Tickets.",
        cost: { cash: 220 },
        reward: { alpha: 28, tickets: 0.25 },
        tierScale: "linear25"
      }
    ]
  },
  {
    id: "rehab_bay",
    name: "Rehab Bay",
    buildPriority: 9,
    folderName: "Rehab Bay",
    costsByTier: makeTierCosts(1080, 0.04),
    descriptionEn: "Cleanses active debuffs.",
    passiveEn: "Reduces threat pressure.",
    tagEn: "Cleanse",
    actionsEn: [
      {
        id: "rehab_protocol",
        label: "Rehab Protocol",
        cooldownSec: 80,
        help: "Remove 1 active debuff.",
        cost: {},
        reward: {},
        tierScale: "flat"
      },
      {
        id: "recovery_boost",
        label: "Recovery Boost",
        cooldownSec: 120,
        help: "Gain Alpha + Cash.",
        cost: { faith: 14 },
        reward: { alpha: 54, cash: 180 },
        tierScale: "linear25"
      }
    ]
  },
  {
    id: "rug_salvage_yard",
    name: "Rug Salvage Yard",
    buildPriority: 2,
    folderName: "Rug Salvage Yard",
    costsByTier: makeTierCosts(300, 0.04),
    descriptionEn: "Generates salvage cash.",
    passiveEn: "Boosts salvage output.",
    tagEn: "Cash",
    actionsEn: [
      {
        id: "salvage_sweep",
        label: "Salvage Sweep",
        cooldownSec: 60,
        help: "Instant Cash burst.",
        cost: {},
        reward: { cash: 90 },
        tierScale: "linear25"
      },
      {
        id: "junk_refine",
        label: "Junk Refine",
        cooldownSec: 95,
        help: "Yield to Cash + small Alpha.",
        cost: { yield: 65 },
        reward: { cash: 190, alpha: 26 },
        tierScale: "linear25"
      }
    ]
  },
  {
    id: "whale_tap",
    name: "Whale Tap",
    buildPriority: 12,
    folderName: "Whale Tap",
    costsByTier: makeTierCosts(1180, 0.06),
    descriptionEn: "Generates big Cash bursts.",
    passiveEn: "Boosts payout pulls.",
    tagEn: "Burst",
    actionsEn: [
      {
        id: "tap_whale",
        label: "Tap Whale",
        cooldownSec: 150,
        help: "Large Cash burst.",
        cost: {},
        reward: { cash: 220 },
        tierScale: "linear25"
      },
      {
        id: "premium_hook",
        label: "Premium Hook",
        cooldownSec: 180,
        help: "Bonus Cash + Tickets.",
        cost: { faith: 12 },
        reward: { cash: 180, tickets: 0.25 },
        tierScale: "linear25"
      }
    ]
  },
  {
    id: "yield_router_station",
    name: "Yield Router Station",
    buildPriority: 4,
    folderName: "Yield Router Station",
    costsByTier: makeTierCosts(500, 0.08),
    descriptionEn: "Routes Yield bursts.",
    passiveEn: "Boosts route efficiency.",
    tagEn: "Yield",
    actionsEn: [
      {
        id: "route_yield",
        label: "Route Yield",
        cooldownSec: 85,
        help: "Yield burst, stronger in Aggro.",
        cost: {},
        reward: { yield: 55 },
        tierScale: "linear25"
      },
      {
        id: "toggle_mode",
        label: "Toggle Mode",
        cooldownSec: 30,
        help: "Switch Safe or Aggro.",
        cost: {},
        reward: {},
        tierScale: "flat"
      }
    ]
  }
];

export const BUILDINGS_BY_ID: Record<BuildingId, BuildingDef> = BUILDINGS.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<BuildingId, BuildingDef>
);
