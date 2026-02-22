import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import {
  BASE_CELL_DEFAULTS,
  BASE_CELL_IDS,
  BASE_MAP_HEIGHT,
  BASE_MAP_WIDTH,
  type BaseCellLayout,
  type CellId,
  type Point
} from "../base/cellLayout";
import { getBuildAssetUrl, type Tier } from "../base/buildAssets";
import { BUILDINGS, BUILDINGS_BY_ID, type BuildingId, type TierCost } from "../base/buildings";
import { ECONOMY } from "../base/economy";
import {
  enqueueJob,
  getProgress,
  tick,
  type BuildJob,
  type BuildQueueState
} from "../base/buildQueue";
import { formatMs, nowMs } from "../base/time";
import {
  getCharges,
  getThreatModifiers,
  loadMechanicsState,
  addDebuff,
  clearDebuffs,
  pruneExpiredDebuffs,
  removeDebuff,
  tickThreats,
  tryUseAction,
  type DebuffId,
  type MechanicsState
} from "../base/mechanics";
import {
  canAfford,
  clampResourcesToCaps,
  getDayIndex,
  loadResourceState,
  setPassiveRatesFromPlacements,
  spend,
  type ResourceState
} from "../base/resourcesState";
import {
  applySwarmWipe,
  createSwarmSystemState,
  getSwarmExtraDrainPerSec,
  tickSwarmSystem,
  type SwarmFinishResult,
  type SwarmSystemState
} from "../events/SwarmEventSystem";
import { SwarmLayer } from "./SwarmLayer";
import { SwarmFinishOverlay } from "./SwarmFinishOverlay";
import { ApiRequestError, buildOrUpgrade, getActionStates, getBaseStateBlob, getResources, performAction, setBaseStateBlob, type ServerActionState } from "../api";

type BaseCell = BaseCellLayout;

type ActiveEditTarget =
  | { kind: "point"; index: 0 | 1 | 2 | 3 }
  | { kind: "center" };

type Placement = {
  buildingId: BuildingId;
  tier: Tier;
};

type BuildingVisual = {
  offsetX: number;
  offsetY: number;
  scale: number;
};

type FxType = "tapBurst" | "confettiPop" | "shineSweep" | "glowRing" | "dustPuff";

interface FxEvent {
  id: string;
  type: FxType;
  x: number;
  y: number;
  t0: number;
  meta?: { w?: number; h?: number };
}

type MapToast = {
  id: string;
  kind: "tweet" | "kol";
  x: number;
  y: number;
  text: string;
  t0: number;
  debuff: DebuffId;
  dismissing?: boolean;
};

type FloatingCashHit = {
  id: string;
  x: number;
  y: number;
  text: string;
  t0: number;
  positive?: boolean;
};

type ServerResourceLike = Partial<{
  cash: number;
  yield: number;
  alpha: number;
  faith: number;
  tickets: number;
  mon: number;
  coins: number;
  pearls: number;
  shards: number;
}>;

function createServerPendingResourceState(now: number): ResourceState {
  return {
    res: {
      cash: 0,
      yield: 0,
      alpha: 0,
      faith: 0,
      tickets: 0,
      mon: 0
    },
    startedAtMs: now,
    lastTickMs: now
  };
}

type BaseScreenProps = {
  token: string | null;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onBack: () => void;
  onTrenches: () => void;
};
const BASE_QUEUE_LIMIT = 1;
const BUILDING_BASE_SIZE_MAP_UNITS = 180;
const THREAT_ORDER: DebuffId[] = ["fuders", "kol_shills"];
const THREAT_SHORT_LABEL: Record<DebuffId, string> = {
  fuders: "FUDers",
  kol_shills: "KOL shills",
  impostors: "Impostors"
};
const THREAT_FALLBACK_MS: Record<DebuffId, number> = {
  fuders: 90_000,
  kol_shills: 75_000,
  impostors: 80_000
};
const FUD_PHRASES = ["Panic selling", "Fear spike", "Weak hands", "Exit now", "Red candles", "No conviction", "Sell pressure", "Trend breaks"];
const IMPOSTOR_PHRASES = ["Build jammed", "Ops delay", "Fake signal", "System spoof", "Crew mismatch", "Command lost", "Queue blocked", "Access denied"];
const KOL_PHRASES = ["BUY THE DIP", "MOON SOON", "INSIDE ALPHA", "WHALE ALERT", "MAX BULLISH", "PUMP SIGNAL", "ENTRY NOW", "SEND IT"];
const GLOBAL_CHARGE_CAP_UI = 6;
const GLOBAL_CHARGE_PERIOD_MS_UI = 60 * 60_000;

function cloneCells(cells: BaseCell[]): BaseCell[] {
  return cells.map((cell) => ({
    ...cell,
    points: [
      { x: cell.points[0].x, y: cell.points[0].y },
      { x: cell.points[1].x, y: cell.points[1].y },
      { x: cell.points[2].x, y: cell.points[2].y },
      { x: cell.points[3].x, y: cell.points[3].y }
    ]
  }));
}

function createDefaultPlacements(): Record<CellId, Placement | null> {
  return BASE_CELL_IDS.reduce((acc, cellId) => {
    acc[cellId] = null;
    return acc;
  }, {} as Record<CellId, Placement | null>);
}

function createDefaultBuildingVisuals(): Record<BuildingId, BuildingVisual> {
  return {
    booster_forge: { offsetX: 3, offsetY: -22, scale: 0.6 },
    cold_vault_insurance: { offsetX: 1, offsetY: -24, scale: 0.5 },
    command_pit_egg_council_hq: { offsetX: 2, offsetY: -24, scale: 0.7 },
    cult: { offsetX: 1, offsetY: -25, scale: 0.6 },
    hype_farm: { offsetX: 5, offsetY: -18, scale: 0.6 },
    memes_market: { offsetX: -1, offsetY: -25, scale: 0.6 },
    narrative_radar: { offsetX: 0, offsetY: -21, scale: 0.6 },
    openclaw_lab: { offsetX: 1, offsetY: -22, scale: 0.6 },
    raid_dock_alpha_desk: { offsetX: -2, offsetY: -12, scale: 0.6 },
    rehab_bay: { offsetX: 2, offsetY: -23, scale: 0.6 },
    rug_salvage_yard: { offsetX: 0, offsetY: -27, scale: 0.7 },
    whale_tap: { offsetX: 0, offsetY: -26, scale: 0.7 },
    yield_router_station: { offsetX: 0, offsetY: -14, scale: 0.6 }
  };
}

function parseStoredCells(raw: string | null): BaseCell[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BaseCell[];
    if (!Array.isArray(parsed)) return null;
    const byId = new Map(parsed.map((cell) => [cell.id, cell]));
    const normalized: BaseCell[] = [];
    for (const id of BASE_CELL_IDS) {
      const cell = byId.get(id);
      if (
        !cell ||
        !Array.isArray(cell.points) ||
        cell.points.length !== 4 ||
        typeof cell.offsetX !== "number" ||
        typeof cell.offsetY !== "number" ||
        cell.points.some((point) => typeof point?.x !== "number" || typeof point?.y !== "number")
      ) {
        return null;
      }
      normalized.push({
        id,
        points: [
          { x: cell.points[0].x, y: cell.points[0].y },
          { x: cell.points[1].x, y: cell.points[1].y },
          { x: cell.points[2].x, y: cell.points[2].y },
          { x: cell.points[3].x, y: cell.points[3].y }
        ],
        offsetX: cell.offsetX,
        offsetY: cell.offsetY
      });
    }
    return normalized;
  } catch {
    return null;
  }
}

function parseStoredPlacements(raw: string | null): Record<CellId, Placement | null> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<CellId, Placement | null>>;
    const normalized = createDefaultPlacements();
    for (const cellId of BASE_CELL_IDS) {
      const entry = parsed[cellId];
      if (!entry) continue;
      const isValidTier = entry.tier >= 1 && entry.tier <= 4;
      if (!isValidTier) continue;
      if (!(entry.buildingId in BUILDINGS_BY_ID)) continue;
      normalized[cellId] = {
        buildingId: entry.buildingId as BuildingId,
        tier: entry.tier as Tier
      };
    }
    return normalized;
  } catch {
    return null;
  }
}

function parseStoredBuildingVisuals(raw: string | null): Record<BuildingId, BuildingVisual> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<BuildingId, BuildingVisual>>;
    const defaults = createDefaultBuildingVisuals();
    for (const building of BUILDINGS) {
      const entry = parsed[building.id];
      if (!entry) continue;
      if (
        typeof entry.offsetX !== "number" ||
        typeof entry.offsetY !== "number" ||
        typeof entry.scale !== "number"
      ) {
        continue;
      }
      defaults[building.id] = {
        offsetX: entry.offsetX,
        offsetY: entry.offsetY,
        scale: entry.scale > 0 ? entry.scale : 1
      };
    }
    return defaults;
  } catch {
    return null;
  }
}

function parseStoredBuildQueue(raw: string | null): BuildQueueState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BuildQueueState;
    const validateJob = (job: BuildJob | null): BuildJob | null => {
      if (!job) return null;
      if (
        typeof job.id !== "string" ||
        typeof job.cellId !== "string" ||
        typeof job.buildingId !== "string" ||
        typeof job.fromTier !== "number" ||
        typeof job.toTier !== "number" ||
        (job.type !== "build" && job.type !== "upgrade") ||
        (job.startedAtMs !== null && typeof job.startedAtMs !== "number") ||
        typeof job.durationMs !== "number"
      ) {
        return null;
      }
      return job;
    };
    const active = validateJob(parsed.active);
    const queued = Array.isArray(parsed.queued)
      ? parsed.queued.map((job) => validateJob(job)).filter((job): job is BuildJob => Boolean(job)).slice(0, BASE_QUEUE_LIMIT)
      : [];
    return { active, queued };
  } catch {
    return null;
  }
}

type BaseStateBlobPayload = {
  version: 1;
  cells: BaseCell[];
  placements: Record<CellId, Placement | null>;
  buildingVisuals: Record<BuildingId, BuildingVisual>;
  buildQueue: BuildQueueState;
  mechanicsState: MechanicsState;
};

function parseBlobState(raw: unknown): BaseStateBlobPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as {
    version?: number;
    cells?: unknown;
    placements?: unknown;
    buildingVisuals?: unknown;
    buildQueue?: unknown;
    mechanicsState?: unknown;
  };
  if (candidate.version !== 1) return null;
  const cells = parseStoredCells(JSON.stringify(candidate.cells));
  const placements = parseStoredPlacements(JSON.stringify(candidate.placements));
  const buildingVisuals = parseStoredBuildingVisuals(JSON.stringify(candidate.buildingVisuals));
  const buildQueue = parseStoredBuildQueue(JSON.stringify(candidate.buildQueue));
  const mechanicsState = clearDebuffs((candidate.mechanicsState as MechanicsState) ?? loadMechanicsState());
  if (!cells || !placements || !buildingVisuals || !buildQueue) return null;
  return {
    version: 1,
    cells,
    placements,
    buildingVisuals,
    buildQueue,
    mechanicsState
  };
}

function toBlobState(payload: BaseStateBlobPayload): Record<string, unknown> {
  return {
    version: 1,
    cells: payload.cells,
    placements: payload.placements,
    buildingVisuals: payload.buildingVisuals,
    buildQueue: payload.buildQueue,
    mechanicsState: payload.mechanicsState
  };
}

function applyCompletedJobsToPlacements(
  source: Record<CellId, Placement | null>,
  completedJobs: BuildJob[]
): Record<CellId, Placement | null> {
  if (completedJobs.length === 0) return source;
  const next = { ...source };
  completedJobs.forEach((job) => {
    const cellId = job.cellId as CellId;
    if (job.type === "build") {
      next[cellId] = {
        buildingId: job.buildingId as BuildingId,
        tier: job.toTier as Tier
      };
      return;
    }
    const existing = next[cellId];
    if (!existing) return;
    next[cellId] = {
      ...existing,
      tier: job.toTier as Tier
    };
  });
  return next;
}

function getRemainingMs(job: BuildJob, now: number): number {
  if (job.startedAtMs == null) return job.durationMs;
  return Math.max(0, job.durationMs - (now - job.startedAtMs));
}

function getJobCost(job: BuildJob): TierCost | null {
  const buildingEconomy = ECONOMY[job.buildingId as BuildingId];
  if (!buildingEconomy) return null;
  const tier = job.toTier as Tier;
  const tierEconomy = buildingEconomy.tiers[tier];
  if (!tierEconomy) return null;
  return tierEconomy.cost as TierCost;
}

function getPointsWithOffset(cell: BaseCell): Point[] {
  return cell.points.map((point) => ({
    x: point.x + cell.offsetX,
    y: point.y + cell.offsetY
  }));
}

function pointsToPolygon(points: Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function getCenter(points: Point[]) {
  const sum = points.reduce(
    (acc, point) => {
      acc.x += point.x;
      acc.y += point.y;
      return acc;
    },
    { x: 0, y: 0 }
  );
  return {
    x: sum.x / points.length,
    y: sum.y / points.length
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatCost(cost: TierCost): string {
  const chunks: string[] = [`Cash ${cost.cash}`];
  if (cost.alpha != null) chunks.push(`Alpha ${cost.alpha}`);
  if ((cost as { yield?: number }).yield != null) chunks.push(`Yield ${(cost as { yield?: number }).yield}`);
  if (cost.tickets != null) chunks.push(`Tickets ${cost.tickets}`);
  if (cost.mon != null) chunks.push(`MON ${cost.mon}`);
  return chunks.join(" | ");
}

type UiResourceKey = "cash" | "alpha" | "yield" | "faith" | "tickets" | "mon";

const RESOURCE_ORDER: UiResourceKey[] = ["cash", "alpha", "yield", "faith", "tickets", "mon"];
const RESOURCE_LABEL: Record<UiResourceKey, string> = {
  cash: "Cash",
  alpha: "Alpha",
  yield: "Yield",
  faith: "Faith",
  tickets: "Tickets",
  mon: "MON"
};

function formatChipValue(key: UiResourceKey, value: number): string {
  if (key === "mon") return `${Number(value.toFixed(2))}`;
  return `${Math.round(value)}`;
}

function toResourceChips(
  data: Partial<Record<UiResourceKey, number>> | undefined,
  sign: "+" | "-"
): Array<{ key: UiResourceKey; text: string }> {
  if (!data) return [];
  const out: Array<{ key: UiResourceKey; text: string }> = [];
  RESOURCE_ORDER.forEach((key) => {
    const raw = data[key];
    if (raw == null || raw <= 0) return;
    out.push({
      key,
      text: `${sign}${RESOURCE_LABEL[key]} ${formatChipValue(key, raw)}`
    });
  });
  return out;
}

function getActionMicroline(actionId: string): string | null {
  if (actionId === "rehab_protocol") return "Removes 1 active Debuff";
  if (actionId === "activate_coverage") return "Enable coverage for 10m";
  if (actionId === "toggle_mode") return "Switch Safe / Aggro";
  return null;
}

function getServerActionKey(buildingId: BuildingId, actionId: string): string | null {
  if ((buildingId as string) === "shard_mine" && (actionId === "collect" || actionId === "collect_shard_mine")) {
    return "collect:shard_mine";
  }
  if ((buildingId as string) === "pearl_grotto" && (actionId === "collect" || actionId === "collect_pearl_grotto")) {
    return "collect:pearl_grotto";
  }
  if ((buildingId as string) === "training_reef" && (actionId === "activate" || actionId === "activate_training_reef")) {
    return "activate:training_reef";
  }
  return `${buildingId}:${actionId}`;
}

function getServerBuildingType(buildingId: BuildingId): string | null {
  return buildingId;
}

function getNextTier(tier: Tier): Tier | null {
  if (tier === 1) return 2;
  if (tier === 2) return 3;
  if (tier === 3) return 4;
  return null;
}

function getServerCharges(
  actionKey: string,
  nowMs: number,
  serverStates: Record<string, ServerActionState>
): { charges: number; cap: number; nextChargeInMs: number; cooldownRemainingMs: number } | null {
  const state = serverStates[actionKey];
  if (!state) return null;
  const sinceReceived = Math.max(0, nowMs - state.receivedAtMs);
  let regenned = 0;
  if (state.regenMsPerCharge > 0 && state.charges < state.chargeCap) {
    regenned = Math.floor(sinceReceived / state.regenMsPerCharge);
  }
  const charges = Math.min(state.chargeCap, state.charges + regenned);
  let nextChargeInMs = 0;
  if (charges < state.chargeCap && state.regenMsPerCharge > 0) {
    nextChargeInMs = Math.max(0, state.regenMsPerCharge - (sinceReceived % state.regenMsPerCharge));
  }
  const cooldownRemainingMs = state.cooldownEndMs > 0
    ? Math.max(0, state.cooldownEndMs - nowMs)
    : 0;
  return { charges, cap: state.chargeCap, nextChargeInMs, cooldownRemainingMs };
}

export function BaseScreen({ token, soundEnabled, onToggleSound, onBack, onTrenches }: BaseScreenProps) {
  const devMode = import.meta.env.DEV;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const queueTitleRef = useRef<HTMLDivElement | null>(null);
  const fxTimerRef = useRef<number[]>([]);
  const shineTimerRef = useRef<number[]>([]);
  const centerDragRef = useRef<{
    cellId: CellId;
    startClientX: number;
    startClientY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);
  const buildingDragRef = useRef<{
    buildingId: BuildingId;
    startClientX: number;
    startClientY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);

  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [cameraPx, setCameraPx] = useState({ x: 0, y: 0 });
  const [cells, setCells] = useState<BaseCell[]>(() => cloneCells(BASE_CELL_DEFAULTS));
  const [placements, setPlacements] = useState<Record<CellId, Placement | null>>(() => createDefaultPlacements());
  const [buildingVisuals, setBuildingVisuals] = useState<Record<BuildingId, BuildingVisual>>(() => createDefaultBuildingVisuals());
  const [buildQueue, setBuildQueue] = useState<BuildQueueState>(() => ({ active: null, queued: [] }));
  const [tickNowMs, setTickNowMs] = useState<number>(() => nowMs());
  const [chargesFlash, setChargesFlash] = useState(false);
  const [resourceState, setResourceState] = useState<ResourceState>(() => {
    const now = nowMs();
    return token ? createServerPendingResourceState(now) : loadResourceState();
  });

  const [selectedCellId, setSelectedCellId] = useState<CellId | null>(null);
  const [hoveredCellId, setHoveredCellId] = useState<CellId | null>(null);
  const [activeTarget, setActiveTarget] = useState<ActiveEditTarget>({ kind: "point", index: 0 });
  const [debugBuildingId, setDebugBuildingId] = useState<BuildingId>(BUILDINGS[0]?.id ?? "booster_forge");
  const [pendingBuildId, setPendingBuildId] = useState<BuildingId>(BUILDINGS[0]?.id ?? "booster_forge");
  const [buildError, setBuildError] = useState<string>("");
  const [debugVisible] = useState(false);
  const [isBuildPickerOpen, setIsBuildPickerOpen] = useState(false);
  const [mechanicsState, setMechanicsState] = useState<MechanicsState>(() => clearDebuffs(loadMechanicsState()));
  const [actionMessage, setActionMessage] = useState<string>("");
  const [serverActionStates, setServerActionStates] = useState<Record<string, ServerActionState>>({});
  const serverStatesLoadedRef = useRef(false);
  const [fx, setFx] = useState<FxEvent[]>([]);
  const [toasts, setToasts] = useState<MapToast[]>([]);
  const [threatPulse, setThreatPulse] = useState<Record<DebuffId, boolean>>({
    fuders: false,
    kol_shills: false,
    impostors: false
  });
  const [hudPulse, setHudPulse] = useState<{ cash: boolean; yield: boolean; alpha: boolean }>({
    cash: false,
    yield: false,
    alpha: false
  });
  const [selectedBounceCellId, setSelectedBounceCellId] = useState<CellId | null>(null);
  const [poppingCells, setPoppingCells] = useState<Record<string, boolean>>({});
  const [swarmState, setSwarmState] = useState<SwarmSystemState>(() => createSwarmSystemState());
  const [swarmFinish, setSwarmFinish] = useState<SwarmFinishResult | null>(null);
  const [impactPulseUntilByCell, setImpactPulseUntilByCell] = useState<Record<string, number>>({});
  const [floatingCashHits, setFloatingCashHits] = useState<FloatingCashHit[]>([]);
  const [jamPulse, setJamPulse] = useState(false);
  const isServerHydratedRef = useRef(false);
  const lastServerUpdatedAtRef = useRef<string | null>(null);
  const saveBlobTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const prevTierByCellRef = useRef<Record<string, Tier | undefined>>({});
  const tierWatchReadyRef = useRef(false);
  const prevResRef = useRef(resourceState.res);
  const prevActiveDebuffsRef = useRef<Set<DebuffId>>(new Set());
  const toastsRef = useRef<MapToast[]>(toasts);
  const swarmStateRef = useRef<SwarmSystemState>(swarmState);
  const prevHudChargesRef = useRef<number | null>(null);
  const activatedAtRef = useRef<Record<DebuffId, number>>({
    fuders: 0,
    kol_shills: 0,
    impostors: 0
  });
  const nextToastAtRef = useRef<Record<DebuffId, number>>({
    fuders: 0,
    kol_shills: 0,
    impostors: 0
  });
  const panGestureRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCameraX: number;
    startCameraY: number;
    isPanning: boolean;
  } | null>(null);
  const suppressTapRef = useRef(false);
  const suppressTapTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const update = () => {
      setViewport({
        width: node.clientWidth || window.innerWidth,
        height: node.clientHeight || window.innerHeight
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      fxTimerRef.current.forEach((timerId) => window.clearTimeout(timerId));
      shineTimerRef.current.forEach((timerId) => window.clearTimeout(timerId));
      if (saveBlobTimerRef.current != null) {
        window.clearTimeout(saveBlobTimerRef.current);
      }
      if (suppressTapTimerRef.current != null) {
        window.clearTimeout(suppressTapTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    swarmStateRef.current = swarmState;
  }, [swarmState]);

  useEffect(() => {
    toastsRef.current = toasts;
  }, [toasts]);

  useEffect(() => {
    document.documentElement.classList.add("base-screen-no-scroll");
    document.body.classList.add("base-screen-no-scroll");
    return () => {
      document.documentElement.classList.remove("base-screen-no-scroll");
      document.body.classList.remove("base-screen-no-scroll");
    };
  }, []);

  const applyServerResources = useCallback((totals: ServerResourceLike, serverNowMs?: number) => {
    const serverNow = Number.isFinite(serverNowMs) ? (serverNowMs as number) : nowMs();
    const nextCash = totals.cash ?? totals.coins ?? 0;
    const nextYield = totals.yield ?? totals.pearls ?? 0;
    const nextAlpha = totals.alpha ?? totals.shards ?? 0;
    const nextFaith = totals.faith ?? 0;
    const nextTickets = totals.tickets ?? 0;
    const nextMon = totals.mon ?? 0;
    setTickNowMs(serverNow);
    setResourceState((prev) => ({
      ...prev,
      res: {
        cash: nextCash,
        yield: nextYield,
        alpha: nextAlpha,
        faith: nextFaith,
        tickets: nextTickets,
        mon: nextMon
      },
      lastTickMs: serverNow
    }));
  }, []);

  const syncResourcesFromServer = useCallback(async () => {
    if (!token) return;
    const result = await getResources(token);
    applyServerResources(result.resources, result.serverNowMs);
  }, [applyServerResources, token]);

  const syncActionStatesFromServer = useCallback(async () => {
    if (!token) return;
    try {
      const result = await getActionStates(token);
      if (result.ok && result.states) {
        const now = Date.now();
        const withTimestamp: Record<string, ServerActionState> = {};
        for (const [key, state] of Object.entries(result.states)) {
          withTimestamp[key] = { ...state, receivedAtMs: now, cooldownEndMs: 0 };
        }
        setServerActionStates(withTimestamp);
        serverStatesLoadedRef.current = true;
      }
    } catch {
      // non-critical
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const now = nowMs();
      const baseDefaultCells = cloneCells(BASE_CELL_DEFAULTS);
      const baseDefaultPlacements = createDefaultPlacements();
      const baseDefaultQueue: BuildQueueState = { active: null, queued: [] };
      const baseDefaultResources = token ? createServerPendingResourceState(now) : loadResourceState();
      const baseDefaultMechanics = clearDebuffs(loadMechanicsState());

      let sourceCells = baseDefaultCells;
      let sourcePlacements = baseDefaultPlacements;
      let sourceBuildingVisuals = createDefaultBuildingVisuals();
      let sourceQueue = baseDefaultQueue;
      let sourceMechanics = baseDefaultMechanics;

      if (token) {
        try {
          const blob = await getBaseStateBlob(token);
          lastServerUpdatedAtRef.current = blob.updatedAt;
          const parsed = blob.stateJson ? parseBlobState(blob.stateJson) : null;
          if (parsed) {
            sourceCells = parsed.cells;
            sourcePlacements = parsed.placements;
            sourceBuildingVisuals = parsed.buildingVisuals;
            sourceQueue = parsed.buildQueue;
            sourceMechanics = parsed.mechanicsState;
          }
        } catch (error) {
          console.warn("[BaseScreen] failed to load server blob state", error);
        }
      }

      setPassiveRatesFromPlacements(sourcePlacements);
      const queueTicked = tick(sourceQueue, now);
      const placementsAfterQueue = applyCompletedJobsToPlacements(sourcePlacements, queueTicked.completed);
      setPassiveRatesFromPlacements(placementsAfterQueue);
      const mechanicsPruned = pruneExpiredDebuffs(sourceMechanics, now);
      const mechanicsTicked = tickThreats(now, getDayIndex(baseDefaultResources, now), placementsAfterQueue, mechanicsPruned);

      if (cancelled) return;
      setCells(sourceCells);
      setPlacements(placementsAfterQueue);
      setBuildingVisuals(sourceBuildingVisuals);
      setBuildQueue(queueTicked.state);
      setResourceState(baseDefaultResources);
      setMechanicsState(mechanicsTicked);
      setTickNowMs(now);
      isServerHydratedRef.current = true;
      try {
        await Promise.all([syncResourcesFromServer(), syncActionStatesFromServer()]);
      } catch (error) {
        console.warn("[BaseScreen] failed to load server resources/action states", error);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
      isServerHydratedRef.current = false;
    };
  }, [syncResourcesFromServer, syncActionStatesFromServer, token]);

  useEffect(() => {
    if (!token || !isServerHydratedRef.current) return;
    if (saveBlobTimerRef.current != null) {
      window.clearTimeout(saveBlobTimerRef.current);
    }
    saveBlobTimerRef.current = window.setTimeout(async () => {
      if (!token || !isServerHydratedRef.current || saveInFlightRef.current) return;
      saveInFlightRef.current = true;
      const payload: BaseStateBlobPayload = {
        version: 1,
        cells,
        placements,
        buildingVisuals,
        buildQueue,
        mechanicsState
      };
      try {
        const saved = await setBaseStateBlob(token, toBlobState(payload), lastServerUpdatedAtRef.current);
        lastServerUpdatedAtRef.current = saved.updatedAt;
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 409) {
          try {
            const latest = await getBaseStateBlob(token);
            lastServerUpdatedAtRef.current = latest.updatedAt;
            const parsed = latest.stateJson ? parseBlobState(latest.stateJson) : null;
            if (parsed) {
              const now = nowMs();
              setPassiveRatesFromPlacements(parsed.placements);
              setCells(parsed.cells);
              setPlacements(parsed.placements);
              setBuildingVisuals(parsed.buildingVisuals);
              setBuildQueue(parsed.buildQueue);
              setMechanicsState(pruneExpiredDebuffs(parsed.mechanicsState, now));
              setTickNowMs(now);
              try {
                await syncResourcesFromServer();
              } catch (syncError) {
                console.warn("[BaseScreen] failed to sync resources after conflict", syncError);
              }
            }
          } catch (reloadError) {
            console.warn("[BaseScreen] failed to resolve state conflict", reloadError);
          }
        } else if (error instanceof ApiRequestError && error.status === 429) {
          // Write throttled by server guard, next state change retries naturally.
        } else {
          console.warn("[BaseScreen] failed to save server blob state", error);
        }
      } finally {
        saveInFlightRef.current = false;
      }
    }, 500);
    return () => {
      if (saveBlobTimerRef.current != null) {
        window.clearTimeout(saveBlobTimerRef.current);
        saveBlobTimerRef.current = null;
      }
    };
  }, [token, cells, placements, buildingVisuals, buildQueue, mechanicsState, syncResourcesFromServer]);

  useEffect(() => {
    if (!token || !isServerHydratedRef.current) return;
    const timer = window.setInterval(() => {
      void syncResourcesFromServer();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [syncResourcesFromServer, token]);

  useEffect(() => {
    setPassiveRatesFromPlacements(placements);
  }, [placements]);

  const selectedCell = selectedCellId ? cells.find((cell) => cell.id === selectedCellId) ?? null : null;
  const selectedCellPoints = selectedCell ? getPointsWithOffset(selectedCell) : null;
  const selectedCenter = selectedCellPoints ? getCenter(selectedCellPoints) : null;
  const selectedPlacement = selectedCellId ? placements[selectedCellId] : null;
  const selectedBuildingDef = selectedPlacement ? BUILDINGS_BY_ID[selectedPlacement.buildingId] : null;
  const uniqueRecentPerks = useMemo(() => {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (let i = mechanicsState.perks.length - 1; i >= 0; i -= 1) {
      const perk = mechanicsState.perks[i].trim();
      if (!perk || seen.has(perk)) continue;
      seen.add(perk);
      unique.unshift(perk);
      if (unique.length >= 3) break;
    }
    return unique;
  }, [mechanicsState.perks]);
  const builtBuildingIds = useMemo(() => {
    return new Set(
      Object.values(placements)
        .filter((item): item is Placement => Boolean(item))
        .map((item) => item.buildingId)
    );
  }, [placements]);
  const isHqBuilt = builtBuildingIds.has("command_pit_egg_council_hq");
  const buildSidebarItems = useMemo(() => {
    return BUILDINGS
      .filter((building) => !builtBuildingIds.has(building.id))
      .sort((a, b) => {
        if (a.buildPriority !== b.buildPriority) return a.buildPriority - b.buildPriority;
        return a.name.localeCompare(b.name);
      });
  }, [builtBuildingIds]);
  const selectedBuildingId = selectedPlacement?.buildingId ?? null;
  const activeJob = buildQueue.active;
  const dayIndex = getDayIndex(resourceState, tickNowMs);
  const hudGlobalCharges = useMemo(() => {
    const base = mechanicsState.globalCharges;
    if (!base) return 0;
    const elapsed = Math.max(0, tickNowMs - base.lastAccrueAtMs);
    const gained = Math.floor(elapsed / GLOBAL_CHARGE_PERIOD_MS_UI);
    return Math.max(0, Math.min(GLOBAL_CHARGE_CAP_UI, base.charges + gained));
  }, [mechanicsState.globalCharges, tickNowMs]);
  const hudNextChargeInMs = useMemo(() => {
    const base = mechanicsState.globalCharges;
    if (!base) return GLOBAL_CHARGE_PERIOD_MS_UI;
    if (hudGlobalCharges >= GLOBAL_CHARGE_CAP_UI) return 0;
    const elapsed = Math.max(0, tickNowMs - base.lastAccrueAtMs);
    const periodProgress = elapsed % GLOBAL_CHARGE_PERIOD_MS_UI;
    return Math.max(0, GLOBAL_CHARGE_PERIOD_MS_UI - periodProgress);
  }, [hudGlobalCharges, mechanicsState.globalCharges, tickNowMs]);
  const hudNextChargeText = hudGlobalCharges >= GLOBAL_CHARGE_CAP_UI ? "Ready" : formatMs(hudNextChargeInMs);
  const hasPendingJobForCell = useCallback(
    (cellId: CellId) => {
      if (buildQueue.active?.cellId === cellId) return true;
      return buildQueue.queued.some((job) => job.cellId === cellId);
    },
    [buildQueue.active, buildQueue.queued]
  );

  const cellById = useMemo(() => {
    return cells.reduce((acc, cell) => {
      acc[cell.id] = cell;
      return acc;
    }, {} as Record<CellId, BaseCell>);
  }, [cells]);

  const placedBuildingCenters = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    BASE_CELL_IDS.forEach((cellId) => {
      const placement = placements[cellId];
      if (!placement) return;
      const cell = cellById[cellId];
      if (!cell) return;
      map[cellId] = getCenter(getPointsWithOffset(cell));
    });
    return map;
  }, [cellById, placements]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = nowMs();
      setTickNowMs(now);
      let extraSwarmDrain = 0;
      setSwarmState((prev) => {
        const swarmTick = tickSwarmSystem(
          prev,
          now,
          placedBuildingCenters,
          []
        );
        extraSwarmDrain = swarmTick.extraDrainPerSec;
        if (swarmTick.impacts.length > 0) {
          setImpactPulseUntilByCell((prevPulse) => {
            const next = { ...prevPulse };
            swarmTick.impacts.forEach((impact) => {
              next[impact.cellId] = now + 720;
              const hitId = crypto.randomUUID();
              setFloatingCashHits((prevHits) => [
                ...prevHits,
                {
                  id: hitId,
                  x: impact.x,
                  y: impact.y,
                  text: `-${impact.cashLossText}`,
                  t0: now
                }
              ]);
              const rmTimer = window.setTimeout(() => {
                setFloatingCashHits((prevHits) => prevHits.filter((item) => item.id !== hitId));
              }, 900);
              fxTimerRef.current.push(rmTimer);
            });
            return next;
          });
        }
        if (swarmTick.finished.length > 0) {
          setSwarmFinish((prevFinish) => prevFinish ?? swarmTick.finished[0]);
        }
        return swarmTick.state;
      });
      if (extraSwarmDrain <= 0) {
        extraSwarmDrain = getSwarmExtraDrainPerSec(swarmStateRef.current);
      }
      setMechanicsState((prev) => tickThreats(now, getDayIndex(resourceState, now), placements, prev));
    }, 250);
    return () => window.clearInterval(timer);
  }, [mechanicsState, placements, resourceState, placedBuildingCenters]);

  const fxDurationByType: Record<FxType, number> = {
    tapBurst: 560,
    confettiPop: 1050,
    shineSweep: 650,
    glowRing: 620,
    dustPuff: 620
  };

  const spawnFx = useCallback((type: FxType, x: number, y: number, meta?: { w?: number; h?: number }) => {
    const id = crypto.randomUUID();
    const event: FxEvent = { id, type, x, y, t0: nowMs(), meta };
    setFx((prev) => [...prev, event]);
    const timerId = window.setTimeout(() => {
      setFx((prev) => prev.filter((item) => item.id !== id));
    }, fxDurationByType[type]);
    fxTimerRef.current.push(timerId);
  }, []);

  const triggerShine = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    element.classList.remove("rr-shine-target");
    void element.offsetWidth;
    element.classList.add("rr-shine-target");
    const timerId = window.setTimeout(() => {
      element.classList.remove("rr-shine-target");
    }, 700);
    shineTimerRef.current.push(timerId);
  }, []);

  const toStageCoords = useCallback((clientX: number, clientY: number) => {
    const rect = stageWrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const scaleX = rect.width / BASE_MAP_WIDTH;
    const scaleY = rect.height / BASE_MAP_HEIGHT;
    if (scaleX <= 0 || scaleY <= 0) return null;
    return {
      x: (clientX - rect.left) / scaleX,
      y: (clientY - rect.top) / scaleY
    };
  }, []);

  const randomRange = useCallback((min: number, max: number) => {
    return min + Math.random() * (max - min);
  }, []);

  const pickDebuffPhrase = useCallback((debuffId: DebuffId) => {
    const source =
      debuffId === "fuders"
        ? FUD_PHRASES
        : debuffId === "kol_shills"
          ? KOL_PHRASES
          : IMPOSTOR_PHRASES;
    return source[Math.floor(Math.random() * source.length)];
  }, []);

  const pickRandomCellCenter = useCallback(() => {
    const randomCellId = BASE_CELL_IDS[Math.floor(Math.random() * BASE_CELL_IDS.length)];
    const cell = cellById[randomCellId];
    if (!cell) return { x: BASE_MAP_WIDTH * 0.5, y: BASE_MAP_HEIGHT * 0.5 };
    return getCenter(getPointsWithOffset(cell));
  }, [cellById]);

  const spawnMapToast = useCallback((debuffId: DebuffId, kind?: "tweet" | "kol") => {
    const center = pickRandomCellCenter();
    const resolvedKind = kind ?? (debuffId === "kol_shills" && Math.random() < 0.5 ? "kol" : "tweet");
    const toast: MapToast = {
      id: crypto.randomUUID(),
      kind: resolvedKind,
      x: center.x + randomRange(-18, 18),
      y: center.y + randomRange(-18, 18),
      text: pickDebuffPhrase(debuffId),
      t0: nowMs(),
      debuff: debuffId
    };
    setToasts((prev) => {
      if (prev.length >= 24) return prev;
      return [...prev, toast];
    });
  }, [pickDebuffPhrase, pickRandomCellCenter, randomRange]);

  const dismissMapToast = useCallback((toastId: string, debuffId: DebuffId) => {
    const toast = toastsRef.current.find((item) => item.id === toastId);
    setToasts((prev) =>
      prev.map((item) => (item.id === toastId ? { ...item, dismissing: true } : item))
    );
    const removeTimer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== toastId));
    }, 260);
    fxTimerRef.current.push(removeTimer);
    const cashGain = Math.random() < 0.5 ? 1 : 2;
    setResourceState((prev) => ({
      ...prev,
      res: clampResourcesToCaps({
        ...prev.res,
        cash: prev.res.cash + cashGain
      })
    }));
    if (toast) {
      const hitId = crypto.randomUUID();
      setFloatingCashHits((prev) => [
        ...prev,
        {
          id: hitId,
          x: toast.x,
          y: toast.y,
          text: `+${cashGain}`,
          t0: nowMs(),
          positive: true
        }
      ]);
      const rmHitTimer = window.setTimeout(() => {
        setFloatingCashHits((prev) => prev.filter((item) => item.id !== hitId));
      }, 900);
      fxTimerRef.current.push(rmHitTimer);
    }
    setActionMessage(`Threat post cleaned (${THREAT_SHORT_LABEL[debuffId]})`);
  }, []);

  const applyCompletedJobs = useCallback((completedJobs: BuildJob[]) => {
    if (completedJobs.length === 0) return;
    const payableJobIds = new Set<string>();
    let nextRes = resourceState.res;
    let hadBlockedUnpaidJob = false;
    completedJobs.forEach((job) => {
      if (job.costPaid === true) {
        payableJobIds.add(job.id);
        return;
      }
      const cost = getJobCost(job);
      if (!cost) {
        payableJobIds.add(job.id);
        return;
      }
      const affordability = canAfford(nextRes, cost as TierCost & { yield?: number; faith?: number }, dayIndex);
      if (!affordability.ok) {
        hadBlockedUnpaidJob = true;
        return;
      }
      nextRes = spend(nextRes, cost as TierCost & { yield?: number; faith?: number }, dayIndex);
      payableJobIds.add(job.id);
    });
    if (hadBlockedUnpaidJob) {
      setActionMessage("Not enough resources to finish unpaid queued job");
      if (token) {
        void syncResourcesFromServer();
      }
    }
    if (nextRes !== resourceState.res) {
      setResourceState((prev) => ({ ...prev, res: nextRes }));
    }
    const jobsToApply = completedJobs.filter((job) => payableJobIds.has(job.id));
    if (jobsToApply.length === 0) return;
    setPlacements((prev) => {
      const next = { ...prev };
      jobsToApply.forEach((job) => {
        const cellId = job.cellId as CellId;
        if (job.type === "build") {
          next[cellId] = {
            buildingId: job.buildingId as BuildingId,
            tier: job.toTier as Tier
          };
          return;
        }
        const existing = next[cellId];
        if (!existing) return;
        next[cellId] = {
          ...existing,
          tier: job.toTier as Tier
        };
      });
      return next;
    });
    jobsToApply.forEach((job) => {
      const cell = cellById[job.cellId as CellId];
      if (!cell) return;
      const center = getCenter(getPointsWithOffset(cell));
      if (job.type === "build") {
        spawnFx("dustPuff", center.x, center.y);
      }
      spawnFx("glowRing", center.x, center.y);
    });
    if (token) {
      void syncResourcesFromServer();
    }
  }, [cellById, dayIndex, resourceState.res, spawnFx, syncResourcesFromServer, token]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = nowMs();
      setTickNowMs(now);
      setBuildQueue((prev) => {
        const result = tick(prev, now);
        if (result.completed.length > 0) {
          applyCompletedJobs(result.completed);
        }
        return result.state;
      });
    }, 200);
    return () => window.clearInterval(timer);
  }, [applyCompletedJobs]);

  useEffect(() => {
    setMechanicsState((prev) => pruneExpiredDebuffs(prev, tickNowMs));
  }, [tickNowMs]);

  useEffect(() => {
    const now = tickNowMs;
    const activeNow = new Set(mechanicsState.debuffs.map((item) => item.id));
    const prevActive = prevActiveDebuffsRef.current;
    THREAT_ORDER.forEach((id) => {
      if (activeNow.has(id) && !prevActive.has(id)) {
        activatedAtRef.current[id] = now;
        nextToastAtRef.current[id] = now + randomRange(3500, 5000);
        setThreatPulse((prev) => ({ ...prev, [id]: true }));
        spawnMapToast(id);
        spawnMapToast(id);
        const pulseTimer = window.setTimeout(() => {
          setThreatPulse((prev) => ({ ...prev, [id]: false }));
        }, 520);
        shineTimerRef.current.push(pulseTimer);
      }
      if (!activeNow.has(id)) {
        activatedAtRef.current[id] = 0;
        nextToastAtRef.current[id] = 0;
      }
    });
    prevActiveDebuffsRef.current = activeNow;
  }, [mechanicsState.debuffs, randomRange, spawnMapToast, tickNowMs]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = nowMs();
      const activeSet = new Set(mechanicsState.debuffs.map((item) => item.id));
      THREAT_ORDER.forEach((id) => {
        if (!activeSet.has(id)) return;
        if (nextToastAtRef.current[id] === 0) {
          nextToastAtRef.current[id] = now + randomRange(3500, 5000);
          return;
        }
        if (now >= nextToastAtRef.current[id]) {
          spawnMapToast(id);
          nextToastAtRef.current[id] = now + randomRange(3500, 5000);
        }
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [mechanicsState.debuffs, randomRange, spawnMapToast]);

  const panMetrics = useMemo(() => {
    const scale = Math.max(viewport.width / BASE_MAP_WIDTH, viewport.height / BASE_MAP_HEIGHT);
    const width = BASE_MAP_WIDTH * scale;
    const height = BASE_MAP_HEIGHT * scale;
    const baseLeft = (viewport.width - width) / 2;
    const baseTop = (viewport.height - height) / 2;
    const canPanX = width > viewport.width + 0.5;
    const canPanY = height > viewport.height + 0.5;
    const minCameraX = canPanX ? viewport.width - width - baseLeft : 0;
    const maxCameraX = canPanX ? -baseLeft : 0;
    const minCameraY = canPanY ? viewport.height - height - baseTop : 0;
    const maxCameraY = canPanY ? -baseTop : 0;
    return {
      width,
      height,
      baseLeft,
      baseTop,
      canPanX,
      canPanY,
      minCameraX,
      maxCameraX,
      minCameraY,
      maxCameraY,
      leftMin: viewport.width - width,
      leftMax: 0,
      topMin: viewport.height - height,
      topMax: 0
    };
  }, [viewport.height, viewport.width]);

  useEffect(() => {
    setCameraPx((prev) => {
      const nextX = panMetrics.canPanX ? clampNumber(prev.x, panMetrics.minCameraX, panMetrics.maxCameraX) : 0;
      const nextY = panMetrics.canPanY ? clampNumber(prev.y, panMetrics.minCameraY, panMetrics.maxCameraY) : 0;
      if (nextX === prev.x && nextY === prev.y) return prev;
      return { x: nextX, y: nextY };
    });
  }, [panMetrics]);

  const drawRect = useMemo(() => {
    const clampedX = panMetrics.canPanX ? clampNumber(cameraPx.x, panMetrics.minCameraX, panMetrics.maxCameraX) : 0;
    const clampedY = panMetrics.canPanY ? clampNumber(cameraPx.y, panMetrics.minCameraY, panMetrics.maxCameraY) : 0;
    const left = panMetrics.canPanX
      ? clampNumber(panMetrics.baseLeft + clampedX, panMetrics.leftMin, panMetrics.leftMax)
      : panMetrics.baseLeft;
    const top = panMetrics.canPanY
      ? clampNumber(panMetrics.baseTop + clampedY, panMetrics.topMin, panMetrics.topMax)
      : panMetrics.baseTop;
    return {
      width: panMetrics.width,
      height: panMetrics.height,
      left,
      top
    };
  }, [cameraPx.x, cameraPx.y, panMetrics]);

  const mapScaleX = drawRect.width / BASE_MAP_WIDTH;
  const mapScaleY = drawRect.height / BASE_MAP_HEIGHT;

  const onPanPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    if (!panMetrics.canPanX && !panMetrics.canPanY) return;
    panGestureRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCameraX: cameraPx.x,
      startCameraY: cameraPx.y,
      isPanning: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [cameraPx.x, cameraPx.y, panMetrics.canPanX, panMetrics.canPanY]);

  const onPanPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startClientX;
    const dy = event.clientY - gesture.startClientY;
    if (!gesture.isPanning && Math.hypot(dx, dy) > 8) {
      gesture.isPanning = true;
      suppressTapRef.current = true;
    }
    if (!gesture.isPanning) return;
    event.preventDefault();
    const nextX = panMetrics.canPanX
      ? clampNumber(gesture.startCameraX + dx, panMetrics.minCameraX, panMetrics.maxCameraX)
      : 0;
    const nextY = panMetrics.canPanY
      ? clampNumber(gesture.startCameraY + dy, panMetrics.minCameraY, panMetrics.maxCameraY)
      : 0;
    setCameraPx({ x: nextX, y: nextY });
  }, [panMetrics.canPanX, panMetrics.canPanY, panMetrics.maxCameraX, panMetrics.maxCameraY, panMetrics.minCameraX, panMetrics.minCameraY]);

  const onPanPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panGestureRef.current = null;
    if (suppressTapTimerRef.current != null) {
      window.clearTimeout(suppressTapTimerRef.current);
    }
    suppressTapTimerRef.current = window.setTimeout(() => {
      suppressTapRef.current = false;
    }, 120);
  }, []);

  const updateSelectedCell = (updater: (cell: BaseCell) => BaseCell) => {
    if (!selectedCellId) return;
    setCells((prevState) => prevState.map((cell) => (cell.id === selectedCellId ? updater(cell) : cell)));
  };

  const moveActiveTarget = useCallback(
    (dx: number, dy: number) => {
      if (!selectedCellId) return;
      setCells((prevState) => {
        return prevState.map((cell) => {
          if (cell.id !== selectedCellId) return cell;
          if (activeTarget.kind === "center") {
            return {
              ...cell,
              offsetX: cell.offsetX + dx,
              offsetY: cell.offsetY + dy
            };
          }
          const nextPoints = [...cell.points] as [Point, Point, Point, Point];
          const targetPoint = nextPoints[activeTarget.index];
          nextPoints[activeTarget.index] = {
            x: targetPoint.x + dx,
            y: targetPoint.y + dy
          };
          return { ...cell, points: nextPoints };
        });
      });
    },
    [activeTarget, selectedCellId]
  );

  const removeSelectedPlacement = useCallback(() => {
    if (!selectedCellId) return;
    setPlacements((prev) => ({ ...prev, [selectedCellId]: null }));
  }, [selectedCellId]);

  const setSelectedPlacementTier = useCallback(
    (tier: Tier) => {
      if (!selectedCellId) return;
      setPlacements((prev) => {
        const current = prev[selectedCellId];
        if (!current) return prev;
        return {
          ...prev,
          [selectedCellId]: { ...current, tier }
        };
      });
    },
    [selectedCellId]
  );

  const setBuildingVisualById = useCallback((buildingId: BuildingId, patch: Partial<BuildingVisual>) => {
    setBuildingVisuals((prev) => {
      const current = prev[buildingId] ?? { offsetX: 0, offsetY: 0, scale: 1 };
      const nextScale = patch.scale ?? current.scale;
      return {
        ...prev,
        [buildingId]: {
          offsetX: patch.offsetX ?? current.offsetX,
          offsetY: patch.offsetY ?? current.offsetY,
          scale: Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1
        }
      };
    });
  }, []);

  const adjustSelectedBuildingScale = useCallback(
    (delta: number) => {
      if (!selectedBuildingId) return;
      setBuildingVisualById(selectedBuildingId, {
        scale: Number(((buildingVisuals[selectedBuildingId]?.scale ?? 1) + delta).toFixed(2))
      });
    },
    [selectedBuildingId, setBuildingVisualById, buildingVisuals]
  );

  useEffect(() => {
    if (!selectedBuildingId) return;
    setDebugBuildingId(selectedBuildingId);
  }, [selectedBuildingId]);

  useEffect(() => {
    if (!selectedCellId) return;
    if (placements[selectedCellId]) return;
    if (buildSidebarItems.length === 0) return;
    if (!isHqBuilt) {
      setPendingBuildId("command_pit_egg_council_hq");
      return;
    }
    if (!buildSidebarItems.some((building) => building.id === pendingBuildId)) {
      setPendingBuildId(buildSidebarItems[0].id);
    }
  }, [buildSidebarItems, isHqBuilt, pendingBuildId, placements, selectedCellId]);

  useEffect(() => {
    if (selectedCellId && !placements[selectedCellId]) {
      setIsBuildPickerOpen(true);
      return;
    }
    setIsBuildPickerOpen(false);
  }, [placements, selectedCellId]);

  useEffect(() => {
    setBuildError("");
  }, [selectedCellId, pendingBuildId]);

  useEffect(() => {
    setActionMessage("");
  }, [selectedCellId]);

  useEffect(() => {
    if (!actionMessage) return;
    const timer = window.setTimeout(() => setActionMessage(""), 2000);
    return () => window.clearTimeout(timer);
  }, [actionMessage]);

  useEffect(() => {
    if (!selectedCellId) return;
    setSelectedBounceCellId(selectedCellId);
    const timer = window.setTimeout(() => setSelectedBounceCellId((prev) => (prev === selectedCellId ? null : prev)), 360);
    return () => window.clearTimeout(timer);
  }, [selectedCellId]);

  useEffect(() => {
    const prev = prevHudChargesRef.current;
    if (prev == null) {
      prevHudChargesRef.current = hudGlobalCharges;
      return;
    }
    prevHudChargesRef.current = hudGlobalCharges;
    if (hudGlobalCharges < prev) {
      setChargesFlash(true);
      const timer = window.setTimeout(() => setChargesFlash(false), 260);
      return () => window.clearTimeout(timer);
    }
    return;
  }, [hudGlobalCharges]);

  useEffect(() => {
    const prev = prevTierByCellRef.current;
    const next: Record<string, Tier | undefined> = {};
    const canAnimate = tierWatchReadyRef.current;
    BASE_CELL_IDS.forEach((cellId) => {
      const tier = placements[cellId]?.tier;
      next[cellId] = tier;
      if (canAnimate && tier != null && prev[cellId] !== tier) {
        setPoppingCells((state) => ({ ...state, [cellId]: true }));
        window.setTimeout(() => {
          setPoppingCells((state) => {
            const copy = { ...state };
            delete copy[cellId];
            return copy;
          });
        }, 420);
      }
    });
    prevTierByCellRef.current = next;
    if (!tierWatchReadyRef.current) tierWatchReadyRef.current = true;
  }, [placements]);

  const triggerHudPulse = useCallback((key: "cash" | "yield" | "alpha") => {
    setHudPulse((prev) => ({ ...prev, [key]: true }));
    window.setTimeout(() => {
      setHudPulse((prev) => ({ ...prev, [key]: false }));
    }, 260);
  }, []);

  const triggerScreenFlash = useCallback((type: "spend" | "earn") => {
    const el = rootRef.current;
    if (!el) return;
    const cls = type === "spend" ? "rr-spend-flash" : "rr-earn-flash";
    el.classList.remove("rr-spend-flash", "rr-earn-flash");
    void el.offsetWidth;
    el.classList.add(cls);
    const timer = window.setTimeout(() => el.classList.remove(cls), 550);
    shineTimerRef.current.push(timer);
  }, []);

  useEffect(() => {
    const prev = prevResRef.current;
    const curr = resourceState.res;
    const gained = curr.cash > prev.cash || curr.yield > prev.yield || curr.alpha > prev.alpha;
    const lost = curr.cash < prev.cash || curr.yield < prev.yield || curr.alpha < prev.alpha;
    if (curr.cash > prev.cash) triggerHudPulse("cash");
    if (curr.yield > prev.yield) triggerHudPulse("yield");
    if (curr.alpha > prev.alpha) triggerHudPulse("alpha");
    if (lost) triggerScreenFlash("spend");
    else if (gained) triggerScreenFlash("earn");
    prevResRef.current = curr;
  }, [resourceState.res, triggerHudPulse, triggerScreenFlash]);

  useEffect(() => {
    if (!devMode) return;
    const win = window as typeof window & {
      __rrDebug?: { startDebuff?: (id: DebuffId, durationSec?: number) => void; clearDebuffs?: () => void };
    };
    const prevDebug = win.__rrDebug;
    win.__rrDebug = {
      ...prevDebug,
      startDebuff: (id: DebuffId, durationSec = 120) => {
        setMechanicsState((prev) => addDebuff(prev, id, durationSec * 1000, nowMs()));
      },
      clearDebuffs: () => {
        setMechanicsState((prev) => clearDebuffs(prev));
      }
    };
    return () => {
      if (!win.__rrDebug) return;
      if (prevDebug) {
        win.__rrDebug = prevDebug;
      } else {
        delete win.__rrDebug;
      }
    };
  }, [devMode]);

  useEffect(() => {
    if (!devMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelectedPlacement();
        return;
      }

      if (event.key.toLowerCase() === "u") {
        event.preventDefault();
        if (!selectedCellId || !selectedPlacement) return;
        if (hasPendingJobForCell(selectedCellId)) return;
        const nextTier = getNextTier(selectedPlacement.tier);
        if (!nextTier) return;
        const buildingEconomy = ECONOMY[selectedPlacement.buildingId];
        if (!buildingEconomy) return;
        const tierEconomy = buildingEconomy.tiers[nextTier];
        const affordability = canAfford(resourceState.res, tierEconomy.cost, dayIndex);
        if (!affordability.ok) {
          setBuildError(affordability.reason || "Cannot upgrade");
          return;
        }
        setBuildError("");
        setResourceState((prev) => {
          const next = {
            ...prev,
            res: spend(prev.res, tierEconomy.cost, dayIndex)
          };
          return next;
        });
        const job: BuildJob = {
          id: crypto.randomUUID(),
          cellId: selectedCellId,
          buildingId: selectedPlacement.buildingId,
          fromTier: selectedPlacement.tier,
          toTier: nextTier,
          type: "upgrade",
          startedAtMs: null,
          durationMs: Math.round(tierEconomy.upgradeTimeMs * getThreatModifiers(mechanicsState, tickNowMs).buildTimeMul),
          costPaid: true
        };
        setBuildQueue((prev) => enqueueJob(prev, job));
        return;
      }

      if (event.key === "1" || event.key === "2" || event.key === "3" || event.key === "4") {
        event.preventDefault();
        setSelectedPlacementTier(Number(event.key) as Tier);
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        adjustSelectedBuildingScale(event.shiftKey ? 0.1 : 0.02);
        return;
      }

      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        adjustSelectedBuildingScale(event.shiftKey ? -0.1 : -0.02);
        return;
      }

      const step = event.shiftKey ? 10 : 1;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveActiveTarget(-step, 0);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        moveActiveTarget(step, 0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveActiveTarget(0, -step);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        moveActiveTarget(0, step);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    devMode,
    moveActiveTarget,
    removeSelectedPlacement,
    setSelectedPlacementTier,
    adjustSelectedBuildingScale,
    selectedCellId,
    selectedPlacement,
    hasPendingJobForCell,
    resourceState.res,
    dayIndex,
    mechanicsState,
    tickNowMs
  ]);

  useEffect(() => {
    if (!devMode) return;

    const onPointerMove = (event: PointerEvent) => {
      const dragState = centerDragRef.current;
      if (mapScaleX <= 0 || mapScaleY <= 0) return;

      if (dragState) {
        const deltaClientX = event.clientX - dragState.startClientX;
        const deltaClientY = event.clientY - dragState.startClientY;
        const deltaMapX = deltaClientX / mapScaleX;
        const deltaMapY = deltaClientY / mapScaleY;

        setCells((prevState) =>
          prevState.map((cell) =>
            cell.id === dragState.cellId
              ? {
                  ...cell,
                  offsetX: dragState.startOffsetX + deltaMapX,
                  offsetY: dragState.startOffsetY + deltaMapY
                }
              : cell
          )
        );
      }

      const buildingDrag = buildingDragRef.current;
      if (buildingDrag) {
        const deltaClientX = event.clientX - buildingDrag.startClientX;
        const deltaClientY = event.clientY - buildingDrag.startClientY;
        const deltaMapX = deltaClientX / mapScaleX;
        const deltaMapY = deltaClientY / mapScaleY;
        setBuildingVisualById(buildingDrag.buildingId, {
          offsetX: buildingDrag.startOffsetX + deltaMapX,
          offsetY: buildingDrag.startOffsetY + deltaMapY
        });
      }
    };

    const onPointerUp = () => {
      centerDragRef.current = null;
      buildingDragRef.current = null;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [devMode, mapScaleX, mapScaleY, setBuildingVisualById]);

  const onPointChange = (pointIndex: number, axis: "x" | "y", value: number) => {
    updateSelectedCell((cell) => {
      const nextPoints = [...cell.points] as [Point, Point, Point, Point];
      nextPoints[pointIndex] = {
        ...nextPoints[pointIndex],
        [axis]: Number.isFinite(value) ? value : 0
      };
      return { ...cell, points: nextPoints };
    });
  };

  const onOffsetChange = (axis: "offsetX" | "offsetY", value: number) => {
    updateSelectedCell((cell) => ({
      ...cell,
      [axis]: Number.isFinite(value) ? value : 0
    }));
  };

  const onSaveCells = () => {
    const snapshot = cloneCells(cells);
    const snapshotJson = JSON.stringify(snapshot, null, 2);
    console.log("[BaseScreen] cells snapshot object", snapshot);
    console.log("[BaseScreen] cells snapshot json", snapshotJson);
  };

  const onCopyCellsJson = async () => {
    const snapshotJson = JSON.stringify(cloneCells(cells), null, 2);
    try {
      await navigator.clipboard.writeText(snapshotJson);
      console.log("[BaseScreen] copied cells snapshot json to clipboard");
    } catch {
      console.log("[BaseScreen] copy failed, manual json follows:");
      console.log(snapshotJson);
    }
  };

  const onResetCells = () => {
    const defaults = cloneCells(BASE_CELL_DEFAULTS);
    setCells(defaults);
  };

  const setDebugBuildingVisual = (key: keyof BuildingVisual, value: number) => {
    setBuildingVisualById(debugBuildingId, {
      [key]: key === "scale" ? (Number.isFinite(value) && value > 0 ? value : 1) : Number.isFinite(value) ? value : 0
    });
  };

  const onSaveBuildingVisuals = () => {
    console.log("[BaseScreen] building visuals snapshot", buildingVisuals);
  };

  const onResetBuildingVisuals = () => {
    const defaults = createDefaultBuildingVisuals();
    setBuildingVisuals(defaults);
  };

  const onCenterPointerDown = (event: ReactPointerEvent<SVGCircleElement>, cell: BaseCell) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedCellId(cell.id);
    setActiveTarget({ kind: "center" });
    centerDragRef.current = {
      cellId: cell.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffsetX: cell.offsetX,
      startOffsetY: cell.offsetY
    };
  };

  const onBuildingAnchorPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    buildingId: BuildingId,
    visual: BuildingVisual
  ) => {
    event.preventDefault();
    event.stopPropagation();
    centerDragRef.current = null;
    setDebugBuildingId(buildingId);
    buildingDragRef.current = {
      buildingId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffsetX: visual.offsetX,
      startOffsetY: visual.offsetY
    };
  };

  const onBuildingAnchorWheel = (
    event: ReactWheelEvent<HTMLDivElement>,
    buildingId: BuildingId,
    currentScale: number
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 0.1 : 0.02;
    const delta = event.deltaY < 0 ? step : -step;
    setBuildingVisualById(buildingId, {
      scale: Number((currentScale + delta).toFixed(2))
    });
  };

  const placeBuildingOnSelectedCell = (buildingId: BuildingId) => {
    if (!isHqBuilt && buildingId !== "command_pit_egg_council_hq") {
      setActionMessage("Build HQ first");
      return;
    }
    setPendingBuildId(buildingId);
  };

  const enqueueBuildForSelectedCell = async () => {
    if (!selectedCellId || !pendingBuildId) return;
    if (placements[selectedCellId]) return;
    if (hasPendingJobForCell(selectedCellId)) return;
    const buildingEconomy = ECONOMY[pendingBuildId];
    if (!buildingEconomy) return;
    const buildTier = buildingEconomy.tiers[1];
    const serverBuildingType = getServerBuildingType(pendingBuildId);
    let serverPaid = false;
    if (token && serverBuildingType) {
      try {
        const response = await buildOrUpgrade(token, serverBuildingType);
        applyServerResources(response.resources as ServerResourceLike);
        serverPaid = true;
      } catch (error) {
        const message =
          error instanceof ApiRequestError
            ? ((error.details as { error?: string } | null)?.error || error.message)
            : "Build failed";
        setBuildError(message);
        await syncResourcesFromServer().catch(() => null);
        return;
      }
    }
    if (!serverPaid) {
      const affordability = canAfford(resourceState.res, buildTier.cost, dayIndex);
      if (!affordability.ok) {
        setBuildError(affordability.reason || "Cannot build");
        return;
      }
      setResourceState((prev) => ({
        ...prev,
        res: spend(prev.res, buildTier.cost, dayIndex)
      }));
    }
    setBuildError("");
    const job: BuildJob = {
      id: crypto.randomUUID(),
      cellId: selectedCellId,
      buildingId: pendingBuildId,
      fromTier: 1,
      toTier: 1,
      type: "build",
      startedAtMs: null,
      durationMs: Math.round(buildTier.buildTimeMs * getThreatModifiers(mechanicsState, tickNowMs).buildTimeMul),
      costPaid: true
    };
    setBuildQueue((prev) => enqueueJob(prev, job));
  };

  const enqueueUpgradeForSelectedCell = async () => {
    if (!selectedCellId || !selectedPlacement) return;
    if (hasPendingJobForCell(selectedCellId)) return;
    const nextTier = getNextTier(selectedPlacement.tier);
    if (!nextTier) return;
    const buildingEconomy = ECONOMY[selectedPlacement.buildingId];
    if (!buildingEconomy) return;
    const tierEconomy = buildingEconomy.tiers[nextTier];
    const serverBuildingType = getServerBuildingType(selectedPlacement.buildingId);
    let serverPaid = false;
    if (token && serverBuildingType) {
      try {
        const response = await buildOrUpgrade(token, serverBuildingType);
        applyServerResources(response.resources as ServerResourceLike);
        serverPaid = true;
      } catch (error) {
        const message =
          error instanceof ApiRequestError
            ? ((error.details as { error?: string } | null)?.error || error.message)
            : "Upgrade failed";
        setBuildError(message);
        await syncResourcesFromServer().catch(() => null);
        return;
      }
    }
    if (!serverPaid) {
      const affordability = canAfford(resourceState.res, tierEconomy.cost, dayIndex);
      if (!affordability.ok) {
        setBuildError(affordability.reason || "Cannot upgrade");
        return;
      }
      setResourceState((prev) => ({
        ...prev,
        res: spend(prev.res, tierEconomy.cost, dayIndex)
      }));
    }
    setBuildError("");
    const job: BuildJob = {
      id: crypto.randomUUID(),
      cellId: selectedCellId,
      buildingId: selectedPlacement.buildingId,
      fromTier: selectedPlacement.tier,
      toTier: nextTier,
      type: "upgrade",
      startedAtMs: null,
      durationMs: Math.round(tierEconomy.upgradeTimeMs * getThreatModifiers(mechanicsState, tickNowMs).buildTimeMul),
      costPaid: true
    };
    setBuildQueue((prev) => enqueueJob(prev, job));
  };

  const completeActiveNow = () => {
    const now = nowMs();
    setTickNowMs(now);
    setBuildQueue((prev) => {
      if (!prev.active) return prev;
      const forced: BuildQueueState = {
        active: { ...prev.active, startedAtMs: now - prev.active.durationMs },
        queued: prev.queued
      };
      const result = tick(forced, now);
      if (result.completed.length > 0) {
        applyCompletedJobs(result.completed);
      }
      return result.state;
    });
  };

  const clearQueue = () => {
    setBuildQueue({ active: null, queued: [] });
  };

  const onBuildFabClick = () => {
    if (!selectedCellId) {
      setBuildError("Select a tile");
      return;
    }
    if (!selectedPlacement) {
      setIsBuildPickerOpen(true);
    }
  };

  const getActionCooldownKey = useCallback((_cellId: CellId, buildingId: BuildingId, actionId: string) => {
    return `${buildingId}:${actionId}`;
  }, []);

  const hasReadyAction = useCallback(
    (
      cellId: CellId,
      placement: Placement | null,
      res: ResourceState["res"],
      mech: MechanicsState,
      currentDayIndex: number,
      currentNowMs: number
    ): boolean => {
      if (!placement) return false;
      const buildingDef = BUILDINGS_BY_ID[placement.buildingId];
      if (!buildingDef || buildingDef.actionsEn.length === 0) return false;
      const mods = getThreatModifiers(mech, currentNowMs);
      return buildingDef.actionsEn.some((action) => {
        const actionKey = getActionCooldownKey(cellId, placement.buildingId, action.id);
        const serverCharge = token ? getServerCharges(actionKey, currentNowMs, serverActionStates) : null;
        const chargeInfo = serverCharge ?? { ...getCharges(actionKey, currentNowMs, mech), cooldownRemainingMs: 0 };
        if (chargeInfo.charges <= 0 || chargeInfo.cooldownRemainingMs > 0) return false;
        const cost = action.cost
          ? {
              ...action.cost,
              cash: action.cost.cash != null ? action.cost.cash * mods.actionCashCostMul : undefined
            }
          : {};
        const affordability = canAfford(res, cost as TierCost & { yield?: number; faith?: number }, currentDayIndex);
        return affordability.ok;
      });
    },
    [getActionCooldownKey, serverActionStates, token]
  );

  const runBuildingAction = useCallback(async (actionId: string, mode: "one" | "all") => {
    if (!selectedCellId || !selectedPlacement) return;
    const serverActionKey = getServerActionKey(selectedPlacement.buildingId, actionId);
    if (token && serverActionKey) {
      try {
        const res = await performAction(token, serverActionKey, { mode, cellId: selectedCellId });
        if (res.resources) {
          setResourceState((prev) => ({
            ...prev,
            res: {
              cash: res.resources.cash,
              yield: res.resources.yield,
              alpha: res.resources.alpha,
              faith: res.resources.faith,
              tickets: res.resources.tickets,
              mon: res.resources.mon
            },
            lastTickMs: res.serverNowMs || prev.lastTickMs
          }));
        }
        if (res.actionState) {
          setServerActionStates((prev) => ({
            ...prev,
            [serverActionKey]: {
              charges: res.actionState!.charges,
              chargeCap: res.actionState!.chargeCap,
              cooldownMs: res.actionState!.cooldownMs ?? res.actionState!.remainingMs,
              regenMsPerCharge: res.actionState!.nextRegenMs,
              lastActionMs: res.serverNowMs,
              dailyCount: res.actionState!.dailyCount,
              dailyCap: res.actionState!.dailyCap,
              receivedAtMs: Date.now(),
              cooldownEndMs: res.actionState!.cooldownEndMs ?? (Date.now() + (res.actionState!.remainingMs || 0))
            }
          }));
        }
        if (!res.ok) {
          setActionMessage("Action blocked by server");
          return;
        }
        setActionMessage("Action complete");
      } catch (error) {
        if (error instanceof ApiRequestError) {
          const details = error.details as {
            code?: string;
            state?: { charges?: number; chargeCap?: number; remainingMs?: number; nextRegenMs?: number; dailyCount?: number; dailyCap?: number };
            resources?: { cash: number; yield: number; alpha: number; faith: number; tickets: number; mon: number };
            serverNowMs?: number;
          } | undefined;
          if (details?.state && serverActionKey) {
            const st = details.state!;
            setServerActionStates((prev) => ({
              ...prev,
              [serverActionKey]: {
                charges: st.charges ?? 0,
                chargeCap: st.chargeCap ?? 1,
                cooldownMs: (st as Record<string, unknown>).cooldownMs as number ?? st.remainingMs ?? 0,
                regenMsPerCharge: st.nextRegenMs ?? prev[serverActionKey]?.regenMsPerCharge ?? 0,
                lastActionMs: details.serverNowMs ?? Date.now(),
                dailyCount: st.dailyCount ?? 0,
                dailyCap: st.dailyCap ?? 0,
                receivedAtMs: Date.now(),
                cooldownEndMs: (st as Record<string, unknown>).cooldownEndMs as number ?? (st.remainingMs ? Date.now() + st.remainingMs : 0)
              }
            }));
          }
          if (details?.resources) {
            setResourceState((prev) => ({
              ...prev,
              res: {
                cash: details.resources!.cash,
                yield: details.resources!.yield,
                alpha: details.resources!.alpha,
                faith: details.resources!.faith,
                tickets: details.resources!.tickets,
                mon: details.resources!.mon
              },
              lastTickMs: details.serverNowMs || prev.lastTickMs
            }));
          }
          if (details?.code === "COOLDOWN" && details?.state?.remainingMs != null) {
            setActionMessage(`Cooldown: ${formatMs(details.state.remainingMs)}`);
          } else if (details?.code === "NO_CHARGES") {
            setActionMessage("No charges");
          } else if (details?.code === "DAILY_CAP") {
            setActionMessage("Daily cap reached");
          } else {
            setActionMessage(details?.code || "Server action failed");
          }
        } else {
          setActionMessage("Server action failed");
        }
      } finally {
        void syncResourcesFromServer();
      }
      return;
    }
    const actionNowMs = tickNowMs;
    const currentDayIndex = getDayIndex(resourceState, actionNowMs);
    const result = tryUseAction({
      nowMs: actionNowMs,
      dayIndex: currentDayIndex,
      startedAtMs: resourceState.startedAtMs,
      cellId: selectedCellId,
      buildingId: selectedPlacement.buildingId,
      actionId,
      mode,
      tier: selectedPlacement.tier as 1 | 2 | 3 | 4,
      res: resourceState.res,
      mech: mechanicsState
    });
    if (!result.ok) {
      setActionMessage(result.reasonEn || "Action blocked by cooldown");
      if (result.reasonEn === "Impostors jammed the action") {
        setJamPulse(true);
        const timer = window.setTimeout(() => setJamPulse(false), 420);
        shineTimerRef.current.push(timer);
      }
      return;
    }

    const nextResourceState = {
      ...resourceState,
      res: result.newRes
    };
    setResourceState(nextResourceState);
    setMechanicsState(result.newMech);
    setActionMessage(result.toastEn || "Action complete");
    void syncResourcesFromServer();
    if (selectedCenter) {
      spawnFx("confettiPop", selectedCenter.x, selectedCenter.y);
    }
  }, [
    mechanicsState,
    resourceState,
    selectedCellId,
    selectedPlacement,
    selectedCenter,
    token,
    syncResourcesFromServer,
    spawnFx,
    tickNowMs
  ]);

  const selectedCellNextTier = selectedPlacement ? getNextTier(selectedPlacement.tier) : null;
  const nextTierEconomy =
    selectedPlacement && selectedCellNextTier
      ? ECONOMY[selectedPlacement.buildingId]?.tiers[selectedCellNextTier] ?? null
      : null;

  const debugVisual = buildingVisuals[debugBuildingId];
  const selectedCellHasPendingJob = selectedCellId ? hasPendingJobForCell(selectedCellId) : false;
  const queueItems = buildQueue.active ? [buildQueue.active, ...buildQueue.queued] : [...buildQueue.queued];
  const pendingBuildEconomy = pendingBuildId ? ECONOMY[pendingBuildId]?.tiers[1] ?? null : null;
  const selectedActiveJob = selectedCellId && buildQueue.active?.cellId === selectedCellId ? buildQueue.active : null;
  const showCellDebug = devMode && debugVisible;

  return (
    <div ref={rootRef} className="base-screen-root">
      <div className="bubbles-layer base-screen-bubbles-top" aria-hidden="true">
        <div className="bubble b1" />
        <div className="bubble b2" />
        <div className="bubble b3" />
        <div className="bubble b4" />
        <div className="bubble b5" />
        <div className="bubble b6" />
        <div className="bubble b7" />
        <div className="bubble b8" />
        <div className="bubble-cluster c1">
          <div className="bubble mini" />
          <div className="bubble mini" />
          <div className="bubble mini" />
        </div>
        <div className="bubble-cluster c2">
          <div className="bubble mini" />
          <div className="bubble mini" />
        </div>
        <div className="bubble-cluster c3">
          <div className="bubble mini" />
          <div className="bubble mini" />
          <div className="bubble mini" />
          <div className="bubble mini" />
        </div>
      </div>
      <div className="bs-top-hud">
        <div className="hud-pills">
          <div className={["hud-pill", "hud-pill--resource", "bs-res-pill", hudPulse.cash ? "pulse" : ""].join(" ")}>
            <img className="bs-res-ico" src="/assets/ui/r_cash.svg" alt="Cash" />
            <div className="bs-res-text">
              <div className="hud-pill-label bs-res-label">Cash</div>
              <div className="hud-pill-value bs-res-value">{Math.floor(resourceState.res.cash)}</div>
            </div>
          </div>
          <div className={["hud-pill", "hud-pill--resource", "bs-res-pill", hudPulse.yield ? "pulse" : ""].join(" ")}>
            <img className="bs-res-ico" src="/assets/ui/r_Yield.svg" alt="Yield" />
            <div className="bs-res-text">
              <div className="hud-pill-label bs-res-label">Yield</div>
              <div className="hud-pill-value bs-res-value">{resourceState.res.yield.toFixed(1)}</div>
            </div>
          </div>
          <div className={["hud-pill", "hud-pill--resource", "bs-res-pill", hudPulse.alpha ? "pulse" : ""].join(" ")}>
            <img className="bs-res-ico" src="/assets/ui/r_alpha.svg" alt="Alpha" />
            <div className="bs-res-text">
              <div className="hud-pill-label bs-res-label">Alpha</div>
              <div className="hud-pill-value bs-res-value">{resourceState.res.alpha.toFixed(1)}</div>
            </div>
          </div>
          <div className="hud-pill hud-pill--resource bs-res-pill">
            <img className="bs-res-ico" src="/assets/ui/r_mon.svg" alt="MON" />
            <div className="bs-res-text">
              <div className="hud-pill-label bs-res-label">MON</div>
              <div className="hud-pill-value bs-res-value">{resourceState.res.mon.toFixed(2)}</div>
            </div>
          </div>
          <div className="hud-pill hud-pill--resource bs-res-pill">
            <img className="bs-res-ico" src="/assets/ui/r_faith.svg" alt="Faith" />
            <div className="bs-res-text">
              <div className="hud-pill-label bs-res-label">Faith</div>
              <div className="hud-pill-value bs-res-value">{Math.floor(resourceState.res.faith)}</div>
            </div>
          </div>
          <div className="hud-pill hud-pill--resource bs-res-pill">
            <img className="bs-res-ico" src="/assets/ui/r_tickets.svg" alt="Tickets" />
            <div className="bs-res-text">
              <div className="hud-pill-label bs-res-label">Tickets</div>
              <div className="hud-pill-value bs-res-value">{Math.floor(resourceState.res.tickets)}</div>
            </div>
          </div>
          <div className="hud-pill"><div className="hud-pill-label">Day</div><div className="hud-pill-value">{dayIndex}</div></div>
          <div
            className={["bs-top-res-item", "bs-charges", hudGlobalCharges === 0 ? "zero" : "", chargesFlash ? "flash" : ""].join(" ")}
            title={`1 charge per hour, max 6. Next: ${hudNextChargeText}`}
          >
            <span className="bs-charges-main">CHARGES: {hudGlobalCharges}/6</span>
            <span className="bs-charges-next">Next: {hudNextChargeText}</span>
            <span className="bs-charges-tip">1 charge per hour, max 6</span>
          </div>
        </div>
        <div className="bs-threatbars">
          {THREAT_ORDER.map((threatId) => {
            const active = mechanicsState.debuffs.find((item) => item.id === threatId);
            const remainingMs = active ? Math.max(0, active.expiresAtMs - tickNowMs) : 0;
            const activatedAt = activatedAtRef.current[threatId];
            const inferredTotal = active && activatedAt > 0 ? active.expiresAtMs - activatedAt : 0;
            const totalMs = Math.max(THREAT_FALLBACK_MS[threatId], inferredTotal || 0);
            const progress = active ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
            return (
              <div
                key={threatId}
                className={[
                  "bs-threatbar",
                  active ? "active" : "",
                  threatPulse[threatId] ? "pulse" : ""
                ].join(" ")}
              >
                <div className="bs-threatbar-top">
                  <span>{THREAT_SHORT_LABEL[threatId]}</span>
                  <span>{active ? formatMs(remainingMs) : "--:--"}</span>
                </div>
                <div className="bs-threatbar-track">
                  <div className="bs-threatbar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="hud-actions">
          <button className="base-screen-back hud-btn" onClick={onToggleSound}>
            {soundEnabled ? "Sound: ON" : "Sound: OFF"}
          </button>
          <button className="base-screen-back hud-btn" onClick={onTrenches}>Trenches</button>
          <button className="base-screen-back hud-btn" onClick={onBack}>Menu</button>
        </div>
      </div>

      <div
        className="base-screen-stage"
        onPointerDownCapture={onPanPointerDown}
        onPointerMoveCapture={onPanPointerMove}
        onPointerUpCapture={onPanPointerUp}
        onPointerCancelCapture={onPanPointerUp}
        onClick={() => {
          if (suppressTapRef.current) return;
          setSelectedCellId(null);
        }}
      >
        <div className="base-screen-map-layer">
          <img
            src="/assets/ui/base-map.avif"
            alt="Base map"
            draggable={false}
            style={{
              left: drawRect.left,
              top: drawRect.top,
              width: drawRect.width,
              height: drawRect.height
            }}
          />
        </div>
        <div
          className="base-screen-pan-capture"
          style={{
            left: drawRect.left,
            top: drawRect.top,
            width: drawRect.width,
            height: drawRect.height
          }}
        />

        <svg
          className="base-screen-grid-layer"
          viewBox={`0 0 ${BASE_MAP_WIDTH} ${BASE_MAP_HEIGHT}`}
          preserveAspectRatio="none"
          style={{
            left: drawRect.left,
            top: drawRect.top,
            width: drawRect.width,
            height: drawRect.height
          }}
        >
          {cells.map((cell) => {
            const points = getPointsWithOffset(cell);
            const center = getCenter(points);
            const isSelected = cell.id === selectedCellId;
            const isHovered = cell.id === hoveredCellId;
            return (
              <g key={cell.id} className="base-screen-cell-group">
                <polygon
                  points={pointsToPolygon(points)}
                  className={[
                    "base-screen-cell",
                    isSelected ? "selected cell-selected-live" : "",
                    isHovered ? "hovered" : "",
                    selectedBounceCellId === cell.id ? "cell-select-bounce" : ""
                  ].join(" ")}
                  style={showCellDebug || isSelected ? undefined : { fill: "transparent", stroke: "transparent" }}
                  onMouseEnter={() => {
                    setHoveredCellId(cell.id);
                    setSelectedCellId((prev) => prev ?? cell.id);
                  }}
                  onMouseLeave={() => setHoveredCellId((prev) => (prev === cell.id ? null : prev))}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (suppressTapRef.current) return;
                    setSelectedCellId(cell.id);
                    const stagePoint = toStageCoords(event.clientX, event.clientY);
                    if (stagePoint) {
                      spawnFx("tapBurst", stagePoint.x, stagePoint.y);
                    }
                  }}
                />
                {showCellDebug && (
                  <text x={center.x + 8} y={center.y - 8} className="base-screen-cell-label">
                    {cell.id}
                  </text>
                )}
                {isSelected && showCellDebug && (
                  <circle
                    cx={center.x}
                    cy={center.y}
                    r={9}
                    className={["base-screen-center-handle", activeTarget.kind === "center" ? "active" : ""].join(" ")}
                    onClick={(event) => {
                      event.stopPropagation();
                      setActiveTarget({ kind: "center" });
                    }}
                    onPointerDown={(event) => onCenterPointerDown(event, cell)}
                  />
                )}
                {isSelected && showCellDebug &&
                  points.map((point, pointIndex) => (
                    <rect
                      key={`${cell.id}-handle-${pointIndex}`}
                      x={point.x - 5}
                      y={point.y - 5}
                      width={10}
                      height={10}
                      className={[
                        "base-screen-cell-handle",
                        activeTarget.kind === "point" && activeTarget.index === pointIndex ? "active" : ""
                      ].join(" ")}
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveTarget({ kind: "point", index: pointIndex as 0 | 1 | 2 | 3 });
                      }}
                    />
                  ))}
              </g>
            );
          })}
        </svg>

        <div className="base-screen-building-layer">
          {BASE_CELL_IDS.map((cellId) => {
            const placement = placements[cellId];
            const activeJobOnCell = activeJob?.cellId === cellId ? activeJob : null;
            const showConstruction = !placement && activeJobOnCell?.type === "build";
            if (!placement && !showConstruction) return null;
            const cell = cellById[cellId];
            if (!cell) return null;
            const points = getPointsWithOffset(cell);
            const center = getCenter(points);
            const visualBuildingId = (placement?.buildingId ?? activeJobOnCell?.buildingId ?? pendingBuildId) as BuildingId;
            const visual = buildingVisuals[visualBuildingId] ?? { offsetX: 0, offsetY: 0, scale: 1 };
            const buildingDef = placement ? BUILDINGS_BY_ID[placement.buildingId] : BUILDINGS_BY_ID[visualBuildingId];
            const sizePx = BUILDING_BASE_SIZE_MAP_UNITS * mapScaleX * visual.scale;
            const xPx = drawRect.left + (center.x + visual.offsetX) * mapScaleX;
            const yPx = drawRect.top + (center.y + visual.offsetY) * mapScaleY;
            const isSelectedCell = cellId === selectedCellId;
            const activeProgress = activeJobOnCell ? getProgress(activeJobOnCell, tickNowMs) : 0;
            const remaining = activeJobOnCell ? getRemainingMs(activeJobOnCell, tickNowMs) : 0;
            const isActionReady = hasReadyAction(cellId, placement, resourceState.res, mechanicsState, dayIndex, tickNowMs);
            const hasImpactPulse = (impactPulseUntilByCell[cellId] ?? 0) > tickNowMs;

            return (
              <div
                key={`placed-${cellId}`}
                className={[
                  "base-screen-building-sprite",
                  isSelectedCell ? "selected" : "",
                  isActionReady ? "rr-action-ready" : "",
                  hasImpactPulse ? "rr-impact-pulse" : ""
                ].join(" ")}
                onClick={(event) => {
                  event.stopPropagation();
                  if (suppressTapRef.current) return;
                  setSelectedCellId(cellId);
                  if (placement) {
                    spawnFx("glowRing", center.x, center.y);
                  }
                }}
                style={{
                  left: xPx,
                  top: yPx,
                  width: sizePx,
                  height: sizePx
                }}
              >
                <img
                  className={poppingCells[cellId] ? "building-pop" : ""}
                  src={
                    showConstruction
                      ? "/assets/Builds/construction.png"
                      : getBuildAssetUrl(buildingDef.folderName, placement.tier, buildingDef.assetBaseName)
                  }
                  alt={showConstruction ? `${buildingDef.name} construction` : `${buildingDef.name} t${placement.tier}`}
                />
                {activeJobOnCell && (
                  <div
                    style={{
                      position: "absolute",
                      left: "50%",
                      bottom: "100%",
                      transform: "translate(-50%, -6px)",
                      minWidth: 70,
                      padding: "2px 6px",
                      borderRadius: 6,
                      background: "rgba(8, 22, 31, 0.86)",
                      border: "1px solid rgba(157, 230, 248, 0.35)",
                      fontSize: 10,
                      color: "#eafdff",
                      textAlign: "center",
                      pointerEvents: "none"
                    }}
                  >
                    <div style={{ marginBottom: 2 }}>{formatMs(remaining)}</div>
                    <div
                      style={{
                        height: 4,
                        borderRadius: 3,
                        background: "rgba(255,255,255,0.2)",
                        overflow: "hidden"
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.round(activeProgress * 100)}%`,
                          height: "100%",
                          background: "linear-gradient(90deg, #66f6cb, #58b8ff)"
                        }}
                      />
                    </div>
                  </div>
                )}
                {devMode && debugVisible && isSelectedCell && (
                  <div
                    className="base-screen-building-anchor"
                    onPointerDown={(event) => onBuildingAnchorPointerDown(event, placement.buildingId, visual)}
                    onWheel={(event) => onBuildingAnchorWheel(event, placement.buildingId, visual.scale)}
                    title="Building anchor: drag moves building only. Wheel scales."
                  />
                )}
              </div>
            );
          })}
        </div>
        <div
          className="swarm-hit-float-layer"
          style={{
            left: drawRect.left,
            top: drawRect.top,
            width: drawRect.width,
            height: drawRect.height
          }}
        >
          {floatingCashHits.map((hit) => (
            <div
              key={hit.id}
              className={["swarm-hit-float", hit.positive ? "positive" : ""].join(" ")}
              style={{
                left: hit.x * mapScaleX,
                top: hit.y * mapScaleY
              }}
            >
              {hit.text}
            </div>
          ))}
        </div>
        <SwarmLayer
          drawRect={drawRect}
          mapScaleX={mapScaleX}
          mapScaleY={mapScaleY}
          swarms={swarmState.byDebuff}
          onWipe={(debuffId, x, y) => {
            const now = nowMs();
            let wipeResult: ReturnType<typeof applySwarmWipe> | null = null;
            setSwarmState((prev) => {
              wipeResult = applySwarmWipe(prev, debuffId, x, y, now);
              return wipeResult.state;
            });
            if (!wipeResult) return null;
            if (wipeResult.remaining === 0 && wipeResult.total > 0) {
              setMechanicsState((prev) => removeDebuff(prev, debuffId));
              setSwarmFinish({
                debuffId,
                cleaned: wipeResult.total,
                total: wipeResult.total,
                cashSaved: Math.round(wipeResult.total * 14),
                perfect: true
              });
              setResourceState((prev) => ({
                ...prev,
                res: {
                  ...prev.res,
                  tickets: prev.res.tickets + 1
                }
              }));
            }
            return { hits: wipeResult.hits, kills: wipeResult.kills };
          }}
        />
        <div
          className="map-toast-layer"
          style={{
            left: drawRect.left,
            top: drawRect.top,
            width: drawRect.width,
            height: drawRect.height
          }}
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={["map-toast", "mop-cursor", toast.kind === "kol" ? "kol" : "", toast.dismissing ? "dismissing" : ""].join(" ")}
              style={{
                left: toast.x * mapScaleX,
                top: toast.y * mapScaleY
              }}
              onClick={() => {
                if (toast.dismissing) return;
                dismissMapToast(toast.id, toast.debuff);
              }}
            >
              <div className="map-toast-avatar">{toast.kind === "kol" ? `K${((toast.id.charCodeAt(0) + toast.id.charCodeAt(1)) % 3) + 1}` : "@"}</div>
              <div className="map-toast-text">{toast.text}</div>
            </div>
          ))}
        </div>
        <div
          ref={stageWrapRef}
          className="base-fx-layer"
          style={{
            left: drawRect.left,
            top: drawRect.top,
            width: drawRect.width,
            height: drawRect.height
          }}
        >
          {fx.map((event) => {
            const left = event.x * mapScaleX;
            const top = event.y * mapScaleY;
            if (event.type === "glowRing") {
              return (
                <div key={event.id} className="fx fx-ring" style={{ left, top }} />
              );
            }
            if (event.type === "shineSweep") {
              return (
                <div
                  key={event.id}
                  className="fx fx-shinesweep"
                  style={{ left, top, width: event.meta?.w ?? 160, height: event.meta?.h ?? 56 }}
                />
              );
            }
            if (event.type === "dustPuff") {
              return (
                <div key={event.id} className="fx fx-dust" style={{ left, top }}>
                  {Array.from({ length: 6 }).map((_, idx) => (
                    <span
                      key={`${event.id}-dust-${idx}`}
                      className="fx-puff"
                      style={
                        {
                          "--fx-angle": `${idx * 60}deg`,
                          "--fx-dist": `${10 + (idx % 3) * 4}px`,
                          "--fx-delay": `${idx * 20}ms`
                        } as { [key: string]: string }
                      }
                    />
                  ))}
                </div>
              );
            }
            if (event.type === "confettiPop") {
              return (
                <div key={event.id} className="fx fx-confetti-pop" style={{ left, top }}>
                  {Array.from({ length: 22 }).map((_, idx) => (
                    <span
                      key={`${event.id}-confetti-${idx}`}
                      className="fx-confetti"
                      style={
                        {
                          "--fx-angle": `${(idx * 360) / 22}deg`,
                          "--fx-dist": `${26 + (idx % 5) * 8}px`,
                          "--fx-delay": `${(idx % 6) * 22}ms`
                        } as { [key: string]: string }
                      }
                    />
                  ))}
                </div>
              );
            }
            return (
              <div key={event.id} className="fx fx-tapburst" style={{ left, top }}>
                {Array.from({ length: 10 }).map((_, idx) => (
                  <span
                    key={`${event.id}-star-${idx}`}
                    className="fx-star"
                    style={
                      {
                        "--fx-angle": `${(idx * 360) / 10}deg`,
                        "--fx-dist": `${14 + (idx % 4) * 4}px`,
                        "--fx-delay": `${(idx % 4) * 18}ms`
                      } as { [key: string]: string }
                    }
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="base-queue-card">
        <div
          ref={queueTitleRef}
          className="base-build-title"
          onClick={() => {
            const rect = queueTitleRef.current?.getBoundingClientRect();
            if (!rect) return;
            const stagePoint = toStageCoords(rect.left + rect.width * 0.5, rect.top + rect.height * 0.5);
            if (!stagePoint) return;
            spawnFx("confettiPop", stagePoint.x, stagePoint.y);
            triggerShine(queueTitleRef.current);
          }}
        >
          Queue
        </div>
        <div className="base-build-cost">active {buildQueue.active ? "1" : "0"} | waiting {buildQueue.queued.length}/{BASE_QUEUE_LIMIT}</div>
        <div className="base-dock-queue-list">
          {queueItems.length === 0 && <div className="base-build-cost">No jobs</div>}
          {queueItems.map((job, index) => {
            const isActive = index === 0 && Boolean(buildQueue.active);
            const left = getRemainingMs(job, tickNowMs);
            return (
              <div key={job.id} className="base-build-cost">
                {isActive ? "ACTIVE" : `Q${index}`} | {job.type} {job.buildingId} {job.fromTier}{"->"}{job.toTier} | {formatMs(left)}
              </div>
            );
          })}
        </div>
      </div>

      {selectedCellId && (
        <div className="base-sidebar">
          {!selectedPlacement && (
            <>
              <div className="base-build-header-row">
                <div className="base-build-title">Build</div>
                <div className="base-build-cost">{selectedCellId}</div>
              </div>
              {!isHqBuilt && <div className="base-build-cost" style={{ color: "#ffd080" }}>Build HQ first</div>}
              <div className="base-sidebar-list">
                {isBuildPickerOpen &&
                  buildSidebarItems.map((building) => {
                    const isDisabledByHq = !isHqBuilt && building.id !== "command_pit_egg_council_hq";
                    return (
                      <button
                        key={building.id}
                        className={["base-sidebar-item", pendingBuildId === building.id ? "selected" : ""].join(" ")}
                        onClick={() => {
                          if (isDisabledByHq) {
                            setActionMessage("Build HQ first");
                            return;
                          }
                          placeBuildingOnSelectedCell(building.id);
                        }}
                        title={isDisabledByHq ? "Build HQ first" : `Select ${building.name}`}
                        aria-disabled={isDisabledByHq}
                        style={{ opacity: isDisabledByHq ? 0.46 : 1 }}
                      >
                        <img src={getBuildAssetUrl(building.folderName, 1, building.assetBaseName)} alt={building.name} />
                        <div className="base-sidebar-item-text">
                          <div className="base-sidebar-item-name">{building.name}</div>
                          <div className="base-build-cost">{building.tagEn ?? "General"}</div>
                          <div className="base-sidebar-item-cost">{formatCost(building.costsByTier[1])}</div>
                        </div>
                      </button>
                    );
                  })}
                {isBuildPickerOpen && buildSidebarItems.length === 0 && (
                  <div className="base-build-cost">All buildings placed</div>
                )}
              </div>
              <div className="base-build-selected-summary">
                <div className="base-build-selected-name">{BUILDINGS_BY_ID[pendingBuildId].name} <span className="base-build-selected-tag">{BUILDINGS_BY_ID[pendingBuildId].tagEn}</span></div>
                <div className="base-build-selected-desc">{BUILDINGS_BY_ID[pendingBuildId].descriptionEn} {BUILDINGS_BY_ID[pendingBuildId].passiveEn}</div>
                <div className="rr-chip-row">
                  {BUILDINGS_BY_ID[pendingBuildId].actionsEn.map((action) => (
                    <span key={action.id} className="rr-chip rr-chip--meta">{action.label}</span>
                  ))}
                </div>
              </div>
              <div className="base-build-actions base-sidebar-actions">
                <button
                  className="base-build-action base-sidebar-build-btn rr-shine-btn"
                  onClick={(event) => {
                    triggerShine(event.currentTarget);
                    void enqueueBuildForSelectedCell();
                  }}
                  disabled={
                    !pendingBuildId ||
                    buildSidebarItems.length === 0 ||
                    selectedCellHasPendingJob ||
                    (buildQueue.active !== null && buildQueue.queued.length >= BASE_QUEUE_LIMIT)
                  }
                >
                  Build — {formatCost(BUILDINGS_BY_ID[pendingBuildId].costsByTier[1])}
                </button>
              </div>
              {pendingBuildEconomy?.cost.mon && dayIndex < 2 && (
                <div className="base-build-cost" style={{ color: "#ffd080" }}>MON unlocks Day 2</div>
              )}
            </>
          )}

          {selectedPlacement && selectedBuildingDef && (
            <>
              <div className="base-build-header-row">
                <div className="base-build-title">{selectedBuildingDef.name}</div>
                <div className="base-build-cost">Tier {selectedPlacement.tier}</div>
              </div>
              <div className="base-build-selected-desc">{selectedBuildingDef.descriptionEn} {selectedBuildingDef.passiveEn}</div>
              <div className="base-actions-list">
                {selectedBuildingDef.actionsEn.map((action) => {
                  const actionKey = getActionCooldownKey(selectedCellId, selectedPlacement.buildingId, action.id);
                  const serverCharge = token ? getServerCharges(actionKey, tickNowMs, serverActionStates) : null;
                  const chargeInfo = serverCharge ?? { ...getCharges(actionKey, tickNowMs, mechanicsState), cooldownRemainingMs: 0 };
                  const cooldownActive = chargeInfo.cooldownRemainingMs > 0;
                  const mods = getThreatModifiers(mechanicsState, tickNowMs);
                  const cost = action.cost
                    ? {
                        ...action.cost,
                        cash: action.cost.cash != null ? action.cost.cash * mods.actionCashCostMul : undefined
                      }
                    : {};
                  const affordability = canAfford(resourceState.res, (cost ?? {}) as TierCost & { yield?: number; faith?: number }, dayIndex);
                  const hasCharges = chargeInfo.charges > 0;
                  const canUse = hasCharges && affordability.ok && !cooldownActive;
                  const disabledReason = cooldownActive
                    ? `Cooldown: ${formatMs(chargeInfo.cooldownRemainingMs)}`
                    : hasCharges && !affordability.ok ? affordability.reason : "";
                  const gainChips = toResourceChips(action.reward, "+");
                  const costChips = toResourceChips(cost as Partial<Record<UiResourceKey, number>>, "-");
                  const nextText = chargeInfo.charges < chargeInfo.cap ? formatMs(chargeInfo.nextChargeInMs) : "Ready";
                  const showCoveredChip = action.id === "claim_payout";
                  const showModeChip = action.id === "toggle_mode";
                  const microline = getActionMicroline(action.id);
                  return (
                    <div key={action.id} className="base-action-row">
                      <div className="base-action-meta"><strong>{action.label}</strong></div>
                      <div className="rr-chip-row">
                        {gainChips.map((chip) => (
                          <span key={`${action.id}-gain-${chip.key}`} className="rr-chip rr-chip--gain">{chip.text}</span>
                        ))}
                        {costChips.map((chip) => (
                          <span key={`${action.id}-cost-${chip.key}`} className="rr-chip rr-chip--cost">{chip.text}</span>
                        ))}
                      </div>
                      <div className="rr-chip-row">
                        <span className="rr-chip rr-chip--meta">Charges {chargeInfo.charges}/{chargeInfo.cap}</span>
                        <span className="rr-chip rr-chip--meta">{cooldownActive ? `CD ${formatMs(chargeInfo.cooldownRemainingMs)}` : `Next ${nextText}`}</span>
                        {showCoveredChip && (
                          <span className="rr-chip rr-chip--cond">{tickNowMs < mechanicsState.coverageUntilMs ? "IF Covered" : "IF Not Covered"}</span>
                        )}
                        {showModeChip && (
                          <span className="rr-chip rr-chip--cond">{`Mode: ${mechanicsState.yieldMode === "aggro" ? "Aggro" : "Safe"}`}</span>
                        )}
                      </div>
                      {disabledReason && <div className="base-action-cost">{disabledReason}</div>}
                      <button
                        className="base-build-action base-sidebar-build-btn rr-shine-btn"
                        onClick={(event) => {
                          triggerShine(event.currentTarget);
                          runBuildingAction(action.id, "one");
                        }}
                        disabled={!canUse}
                      >
                        {cooldownActive ? `CD ${formatMs(chargeInfo.cooldownRemainingMs)}` : "Claim"}
                      </button>
                      {disabledReason && <div className="base-build-cost">{disabledReason}</div>}
                    </div>
                  );
                })}
              </div>
              <div className="base-build-actions base-sidebar-actions">
                <button
                  className="base-build-action rr-shine-btn"
                  onClick={(event) => {
                    triggerShine(event.currentTarget);
                    void enqueueUpgradeForSelectedCell();
                  }}
                  disabled={!selectedCellNextTier || selectedCellHasPendingJob || (buildQueue.active !== null && buildQueue.queued.length >= BASE_QUEUE_LIMIT)}
                >
                  Upgrade
                </button>
                <button
                  className="base-build-action danger"
                  onClick={() => {
                    removeSelectedPlacement();
                  }}
                  disabled={selectedCellHasPendingJob}
                >
                  Remove
                </button>
              </div>
              <div className="base-build-cost">
                {nextTierEconomy ? `Next Tier: ${formatCost(nextTierEconomy.cost as TierCost)}` : "Already at Tier 4"}
              </div>
              {nextTierEconomy && (
                <div className="rr-chip-row">
                  {toResourceChips(nextTierEconomy.cost as Partial<Record<UiResourceKey, number>>, "-").map((chip) => (
                    <span key={`next-tier-${chip.key}`} className="rr-chip rr-chip--cost">{chip.text}</span>
                  ))}
                </div>
              )}
              {nextTierEconomy?.cost.mon && dayIndex < 2 && (
                <div className="base-build-cost">MON required after Day 2</div>
              )}
              {selectedActiveJob && <div className="base-build-cost">Active job: {formatMs(getRemainingMs(selectedActiveJob, tickNowMs))}</div>}
              {mechanicsState.boostCharges > 0 && <div className="base-build-cost">Boost charges: {mechanicsState.boostCharges}</div>}
              {uniqueRecentPerks.length > 0 && (
                <div className="base-build-cost">Perks:</div>
              )}
              {uniqueRecentPerks.length > 0 && (
                <div className="rr-chip-row">
                  {uniqueRecentPerks.map((perk) => (
                    <span key={`perk-chip-${perk}`} className="rr-chip rr-chip--meta">{perk}</span>
                  ))}
                </div>
              )}
            </>
          )}

          {buildError && <div className="base-build-cost" style={{ color: "#ffbdbd" }}>{buildError}</div>}
          {actionMessage && <div className="base-build-cost" style={{ color: "#d5fff0" }}>{actionMessage}</div>}

        </div>
      )}

      <button
        className="build-fab rr-shine-btn"
        onClick={(event) => {
          triggerShine(event.currentTarget);
          onBuildFabClick();
        }}
      >
        Build
      </button>
      {!selectedCellId && buildError && <div className="base-fab-hint">{buildError}</div>}
      <SwarmFinishOverlay
        open={Boolean(swarmFinish)}
        cleaned={swarmFinish?.cleaned ?? 0}
        total={swarmFinish?.total ?? 0}
        cashSaved={swarmFinish?.cashSaved ?? 0}
        bonusText={swarmFinish?.perfect ? "+1 Ticket" : undefined}
        onClose={() => setSwarmFinish(null)}
      />

      {devMode && debugVisible && (
        <aside className="base-screen-debug">
          <div className="base-screen-debug-actions base-screen-debug-actions-two">
            <button onClick={() => setDebugVisible(false)}>Close Debug</button>
            <button onClick={() => setDebugVisible(false)}>Hide</button>
          </div>
          <h3>Base Debug</h3>

          <label>
            Cell
            <select
              value={selectedCellId ?? ""}
              onChange={(event) => setSelectedCellId(event.target.value ? (event.target.value as CellId) : null)}
            >
              <option value="">none</option>
              {BASE_CELL_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>

          {selectedCell && (
            <>
              {selectedCell.points.map((point, index) => (
                <div className="base-screen-debug-row" key={`point-input-${index}`}>
                  <label>
                    x{index + 1}
                    <input
                      type="number"
                      value={Math.round(point.x)}
                      onChange={(event) => onPointChange(index, "x", Number(event.target.value))}
                    />
                  </label>
                  <label>
                    y{index + 1}
                    <input
                      type="number"
                      value={Math.round(point.y)}
                      onChange={(event) => onPointChange(index, "y", Number(event.target.value))}
                    />
                  </label>
                </div>
              ))}

              <div className="base-screen-debug-row">
                <label>
                  offsetX
                  <input
                    type="number"
                    value={Math.round(selectedCell.offsetX)}
                    onChange={(event) => onOffsetChange("offsetX", Number(event.target.value))}
                  />
                </label>
                <label>
                  offsetY
                  <input
                    type="number"
                    value={Math.round(selectedCell.offsetY)}
                    onChange={(event) => onOffsetChange("offsetY", Number(event.target.value))}
                  />
                </label>
              </div>
            </>
          )}

          {selectedCenter && (
            <div className="base-screen-debug-center">
              centerX: {Math.round(selectedCenter.x)} | centerY: {Math.round(selectedCenter.y)}
            </div>
          )}
          <div className="base-screen-debug-center">
            edit target: {activeTarget.kind === "center" ? "center (all 4 points)" : `point ${activeTarget.index + 1}`} |
            arrows: 1px, Shift+arrows: 10px
          </div>
          <div className="base-screen-debug-center">
            selected tile building:{" "}
            {selectedPlacement ? `${BUILDINGS_BY_ID[selectedPlacement.buildingId].name} (T${selectedPlacement.tier})` : "empty"}
          </div>
          <div className="base-screen-debug-center">
            building debug: drag cyan anchor (on building corner) moves building only; wheel/+/- scales (Shift = faster)
          </div>

          <div className="base-screen-debug-actions">
            <button onClick={onSaveCells}>Save Cells</button>
            <button onClick={onResetCells}>Reset Cells</button>
            <button onClick={onCopyCellsJson}>Copy Cells JSON</button>
          </div>

          <h3>Resources Dev</h3>
          <div className="base-screen-debug-actions">
            <button
              onClick={() =>
                setResourceState((prev) => {
                  return { ...prev, res: { ...prev.res, cash: prev.res.cash + 10000 } };
                })
              }
            >
              +10000 Cash
            </button>
            <button
              onClick={() =>
                setResourceState((prev) => {
                  return { ...prev, res: { ...prev.res, tickets: prev.res.tickets + 10000 } };
                })
              }
            >
              +10000 Tickets
            </button>
            <button
              onClick={() =>
                setResourceState((prev) => {
                  return { ...prev, res: { ...prev.res, mon: prev.res.mon + 10000 } };
                })
              }
            >
              +10000 MON
            </button>
            <button
              onClick={() =>
                setResourceState((prev) => {
                  return { ...prev, res: { ...prev.res, faith: prev.res.faith + 10000 } };
                })
              }
            >
              +10000 Faith
            </button>
            <button
              onClick={() => {
                const next = loadResourceState();
                next.res = { cash: 10_000, yield: 10_000, alpha: 10_000, tickets: 10_000, mon: 10_000, faith: 10_000 };
                next.startedAtMs = nowMs();
                next.lastTickMs = next.startedAtMs;
                setResourceState(next);
              }}
            >
              Reset resources
            </button>
          </div>

          <h3>Building Visual</h3>
          <label>
            Building
            <select value={debugBuildingId} onChange={(event) => setDebugBuildingId(event.target.value as BuildingId)}>
              {BUILDINGS.map((building) => (
                <option key={building.id} value={building.id}>
                  {building.name}
                </option>
              ))}
            </select>
          </label>
          <div className="base-screen-debug-row">
            <label>
              offsetX
              <input
                type="number"
                value={Math.round(debugVisual.offsetX)}
                onChange={(event) => setDebugBuildingVisual("offsetX", Number(event.target.value))}
              />
            </label>
            <label>
              offsetY
              <input
                type="number"
                value={Math.round(debugVisual.offsetY)}
                onChange={(event) => setDebugBuildingVisual("offsetY", Number(event.target.value))}
              />
            </label>
          </div>
          <label>
            scale
            <input
              type="number"
              step="0.01"
              min="0.1"
              value={debugVisual.scale}
              onChange={(event) => setDebugBuildingVisual("scale", Number(event.target.value))}
            />
          </label>
          <input
            type="range"
            min="0.2"
            max="3"
            step="0.01"
            value={debugVisual.scale}
            onChange={(event) => setDebugBuildingVisual("scale", Number(event.target.value))}
          />
          <div className="base-screen-debug-actions base-screen-debug-actions-three">
            <button onClick={() => setDebugBuildingVisual("scale", Number((debugVisual.scale - 0.1).toFixed(2)))}>-0.10</button>
            <button onClick={() => setDebugBuildingVisual("scale", Number((debugVisual.scale + 0.1).toFixed(2)))}>+0.10</button>
            <button onClick={() => setDebugBuildingVisual("scale", 1)}>Scale 1.0</button>
          </div>
          <div className="base-screen-debug-actions base-screen-debug-actions-two">
            <button onClick={onSaveBuildingVisuals}>Save Visuals</button>
            <button onClick={onResetBuildingVisuals}>Reset Visuals</button>
          </div>
        </aside>
      )}
    </div>
  );
}
