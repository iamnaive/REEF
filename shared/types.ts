export type HeroType = "Shark" | "Whale" | "Shrimp";

/* ── Base Building System ── */

export type BuildingType = "shard_mine" | "pearl_grotto" | "training_reef" | "storage_vault";

export type BuildingDef = {
  id: BuildingType;
  name: string;
  description: string;
  maxLevel: number;
  /** Costs per level (index 0 = level 1, etc.) */
  costs: Array<{ coins: number; pearls: number }>;
  /** Production per hour per level (index 0 = level 1) */
  productionPerHour: number[];
  /** Resource type produced */
  produces: "shards" | "pearls" | "buff";
};

export type PlayerBuilding = {
  id: string;
  buildingType: BuildingType;
  level: number;
  lastCollectedAt: string;
  createdAt: string;
};

export type BaseState = {
  buildings: PlayerBuilding[];
  /** Maximum number of building slots unlocked */
  maxSlots: number;
};

export const BUILDINGS: BuildingDef[] = [
  {
    id: "shard_mine",
    name: "Shard Mine",
    description: "Produces Crystal Shards over time. The only way to earn shards!",
    maxLevel: 5,
    costs: [
      { coins: 80, pearls: 0 },
      { coins: 160, pearls: 10 },
      { coins: 320, pearls: 25 },
      { coins: 500, pearls: 50 },
      { coins: 800, pearls: 80 }
    ],
    productionPerHour: [1, 2, 3.5, 5, 8],
    produces: "shards"
  },
  {
    id: "pearl_grotto",
    name: "Pearl Grotto",
    description: "Slowly cultivates Pearls from ocean currents.",
    maxLevel: 5,
    costs: [
      { coins: 100, pearls: 0 },
      { coins: 200, pearls: 15 },
      { coins: 400, pearls: 35 },
      { coins: 600, pearls: 60 },
      { coins: 1000, pearls: 100 }
    ],
    productionPerHour: [0.5, 1, 2, 3, 5],
    produces: "pearls"
  },
  {
    id: "training_reef",
    name: "Training Reef",
    description: "Boosts hero piercing level passively. Each level = +1 piercing.",
    maxLevel: 4,
    costs: [
      { coins: 150, pearls: 10 },
      { coins: 300, pearls: 30 },
      { coins: 600, pearls: 60 },
      { coins: 1200, pearls: 120 }
    ],
    productionPerHour: [0, 0, 0, 0],
    produces: "buff"
  },
  {
    id: "storage_vault",
    name: "Storage Vault",
    description: "Increases max accumulation time from 4h to higher. Each level adds +2h.",
    maxLevel: 3,
    costs: [
      { coins: 120, pearls: 5 },
      { coins: 250, pearls: 20 },
      { coins: 500, pearls: 50 }
    ],
    productionPerHour: [0, 0, 0],
    produces: "buff"
  }
];

export type WeatherType =
  | "SunlitShallows"
  | "CoralBloom"
  | "AbyssalGlow"
  | "DeepWater"
  | "CrimsonTide"
  | "MoonTide";

export type MatchResult = "win" | "lose";

export type UpgradeState = {
  piercingLevel: number;
};

export type Loadout = {
  hero: HeroType;
  upgrades: UpgradeState;
};

export type WeatherDef = {
  id: WeatherType;
  name: string;
  favored: HeroType;
  bonus: number;
  backgroundKey: string;
};

export type RewardPayload = {
  coins: number;
  pearls: number;
  shards: number;
  items: string[];
  heroes?: HeroType[];
};

export type ArtifactSlot = "weapon" | "armor";

export type ArtifactDef = {
  id: string;
  name: string;
  description: string;
  hero: HeroType;
  slot: ArtifactSlot;
  bonusAgainst: HeroType;
  bonus: number;
  cost: {
    coins: number;
  };
};

export type InventoryItem = {
  id: string;
  artifactId: string;
  hero: HeroType;
  slot: ArtifactSlot;
  acquiredAt: string;
};

export type EquippedSlots = {
  weapon?: string;
  armor?: string;
};

export type InventoryState = {
  items: InventoryItem[];
  equipped: Record<HeroType, EquippedSlots>;
};

export type ResourceTotals = {
  coins: number;
  pearls: number;
  shards: number;
};

export type LeaderboardEntry = {
  rank: number;
  address: string;
  wins: number;
  matches: number;
  points: number;
  bestStreak: number;
  updatedAt: string;
};

export type OpponentProfile = {
  id: string;
  hero: HeroType;
  upgrades: UpgradeState;
};

export type MatchRound = {
  playerHero: HeroType;
  opponentHero: HeroType;
  result: MatchResult;
};

export type MatchPreview = {
  matchId: string;
  weather: WeatherDef;
  playerLineup: HeroType[];
  opponentLineup: OpponentProfile[];
  matchesLeft: number;
  resetAt: string;
};

export type MatchResolution = {
  matchId: string;
  result: MatchResult;
  weather: WeatherDef;
  playerLineup: HeroType[];
  opponentLineup: OpponentProfile[];
  rounds: MatchRound[];
  chestId: string;
  matchesLeft: number;
  resetAt: string;
};

export const HEROES: HeroType[] = ["Shark", "Whale", "Shrimp"];

/**
 * Weather balance — compensates matchup asymmetry:
 *   Shark:  strongest attack (+18%) → weakest weather (6% / 5%)
 *   Whale:  weakest attack  (+14%) → strongest weather (10% / 7%)
 *   Shrimp: medium attack   (+16%) → medium weather (8% / 6%)
 *
 * Peak (advantage + best weather) = 74% for all heroes
 * Floor (disadvantage + enemy best weather) = 26% for all heroes
 */
export const WEATHER: WeatherDef[] = [
  {
    id: "SunlitShallows",
    name: "Sunlit Shallows",
    favored: "Shrimp",
    bonus: 0.08,
    backgroundKey: "weather_sunlit_shallows"
  },
  {
    id: "DeepWater",
    name: "Deep Water",
    favored: "Whale",
    bonus: 0.10,
    backgroundKey: "weather_deep_water"
  },
  {
    id: "CoralBloom",
    name: "Coral Bloom",
    favored: "Shrimp",
    bonus: 0.06,
    backgroundKey: "weather_coral_bloom"
  },
  {
    id: "AbyssalGlow",
    name: "Abyssal Glow",
    favored: "Whale",
    bonus: 0.07,
    backgroundKey: "weather_abyssal_glow"
  },
  {
    id: "CrimsonTide",
    name: "Crimson Tide",
    favored: "Shark",
    bonus: 0.06,
    backgroundKey: "weather_crimson_tide"
  },
  {
    id: "MoonTide",
    name: "Moon Tide",
    favored: "Shark",
    bonus: 0.05,
    backgroundKey: "weather_moon_tide"
  }
];

export const MATCH_LIMIT_PER_DAY = 5;

/* ── Daily Free Chest (7-day login streak cycle) ── */

export type DailyChestTier = {
  day: number;
  coins: number;
  pearls: number;
  shards: number;
  label: string;
};

export const DAILY_CHEST_TIERS: DailyChestTier[] = [
  { day: 1, coins: 20, pearls: 0, shards: 0, label: "Day 1" },
  { day: 2, coins: 30, pearls: 5, shards: 0, label: "Day 2" },
  { day: 3, coins: 40, pearls: 8, shards: 0, label: "Day 3" },
  { day: 4, coins: 50, pearls: 10, shards: 1, label: "Day 4" },
  { day: 5, coins: 60, pearls: 14, shards: 2, label: "Day 5" },
  { day: 6, coins: 80, pearls: 18, shards: 3, label: "Day 6" },
  { day: 7, coins: 120, pearls: 25, shards: 5, label: "Day 7 — JACKPOT!" }
];

export type DailyChestState = {
  /** Current streak day (1-7, resets after 7 or if a day is missed) */
  streakDay: number;
  /** Whether the player has already claimed today */
  claimedToday: boolean;
  /** Rewards for the next claim */
  nextReward: DailyChestTier;
};

export const ARTIFACTS: ArtifactDef[] = [
  {
    id: "shark_saber",
    name: "Crimson Saber",
    description: "+8% win chance vs Whale. Shark weapon.",
    hero: "Shark",
    slot: "weapon",
    bonusAgainst: "Whale",
    bonus: 0.08,
    cost: { coins: 150 }
  },
  {
    id: "shark_plating",
    name: "Abyssal Plating",
    description: "+6% win chance vs Shrimp. Shark armor.",
    hero: "Shark",
    slot: "armor",
    bonusAgainst: "Shrimp",
    bonus: 0.06,
    cost: { coins: 100 }
  },
  {
    id: "whale_harpoon",
    name: "Tidal Harpoon",
    description: "+8% win chance vs Shrimp. Whale weapon.",
    hero: "Whale",
    slot: "weapon",
    bonusAgainst: "Shrimp",
    bonus: 0.08,
    cost: { coins: 150 }
  },
  {
    id: "whale_hide",
    name: "Coral Hide",
    description: "+6% win chance vs Shark. Whale armor.",
    hero: "Whale",
    slot: "armor",
    bonusAgainst: "Shark",
    bonus: 0.06,
    cost: { coins: 100 }
  },
  {
    id: "shrimp_needle",
    name: "Moon Needle",
    description: "+8% win chance vs Shark. Shrimp weapon.",
    hero: "Shrimp",
    slot: "weapon",
    bonusAgainst: "Shark",
    bonus: 0.08,
    cost: { coins: 150 }
  },
  {
    id: "shrimp_shell",
    name: "Sunlit Shell",
    description: "+6% win chance vs Whale. Shrimp armor.",
    hero: "Shrimp",
    slot: "armor",
    bonusAgainst: "Whale",
    bonus: 0.06,
    cost: { coins: 100 }
  }
];
