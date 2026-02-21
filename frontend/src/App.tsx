import { useCallback, useEffect, useRef, useState } from "react";
import { PhaserGame } from "./game/PhaserGame";
import { eventBus } from "./game/eventBus";
import { BaseScreen } from "./ui/BaseScreen";
import {
  HEROES,
  HeroType,
  MatchResult,
  MatchPreview,
  MatchResolution,
  RewardPayload,
  WEATHER,
  WeatherType,
  ARTIFACTS,
  ArtifactDef,
  InventoryState,
  BaseState,
  DailyChestState,
  DAILY_CHEST_TIERS,
  LeaderboardEntry
} from "@shared/types";
import {
  claimOnboarding,
  fetchNonce,
  login,
  getState,
  fetchLeaderboard,
  fetchShop,
  buyArtifact,
  fetchInventory,
  equipArtifact,
  openChest,
  prepareMatch,
  resolveMatch,
  claimDailyChest,
  fetchBase,
  fetchPoolStats
} from "./api";
import { useResources } from "./resources";
import { fadeOutMenuLoop, playMenuLoop, playSfx, playRandomKnock, preloadSfx, setSfxEnabled } from "./game/sounds";
import { closeWalletModal, getWalletProvider } from "./walletProvider";
import {
  STORAGE_ADDRESS,
  assertNoForbiddenStorageKeysDev,
  clearStoredAuth,
  readStoredAddress,
  readStoredToken,
  writeStoredAuth
} from "./auth/storage";

type Screen =
  | "menu"
  | "onboarding"
  | "pre"
  | "loading"
  | "battle"
  | "base";

const DEMO_DAILY_MATCH_CAP = 5;
const MONAD_CHAIN_HEX = (import.meta.env.VITE_MONAD_CHAIN_ID_HEX || "0x8f").toLowerCase();
const MONAD_CHAIN_NAME = import.meta.env.VITE_MONAD_CHAIN_NAME || "Monad Mainnet";
const MONAD_RPC_URL = import.meta.env.VITE_MONAD_RPC_URL || "";
const REOWN_PROJECT_ID = import.meta.env.VITE_REOWN_PROJECT_ID || "";

type DemoDailyState = {
  dayKey: string;
  matchesPlayed: number;
  resetAt: string;
};

export default function App() {
  const gameRef = useRef<PhaserGame | null>(null);
  const [screen, setScreen] = useState<Screen>("menu");
  const [showMatchups, setShowMatchups] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [token, setToken] = useState<string | null>(
    readStoredToken()
  );
  const [addressStored, setAddressStored] = useState<string | null>(
    readStoredAddress()
  );
  const hadWalletRef = useRef<boolean>(Boolean(readStoredAddress()));
  const [heroes, setHeroes] = useState<HeroType[]>([]);
  const [selectedHero, setSelectedHero] = useState<HeroType>("Shark");
  const [selectedLineup, setSelectedLineup] = useState<HeroType[]>(HEROES);
  const [activeLineupIndex, setActiveLineupIndex] = useState(0);
  const [preview, setPreview] = useState<MatchPreview | null>(null);
  const [resolution, setResolution] = useState<MatchResolution | null>(null);
  const [rewards, setRewards] = useState<RewardPayload | null>(null);
  const [displayRewards, setDisplayRewards] = useState({
    coins: 0,
    pearls: 0,
    shards: 0
  });
  const [isCountingRewards, setIsCountingRewards] = useState(false);
  const [rewardFlyouts, setRewardFlyouts] = useState<{ type: string; amount: number; id: number }[]>([]);
  const [hudPopups, setHudPopups] = useState<{ type: string; amount: number; id: number }[]>([]);
  const flyoutIdRef = useRef(0);
  const { resources, setResources, addResources } = useResources();
  const [winStreak, setWinStreak] = useState(0);
  const [matchesLeft, setMatchesLeft] = useState(0);
  const [resetAt, setResetAt] = useState<string>("");
  const [resetTimer, setResetTimer] = useState<string>("");
  const [hasOnboarded, setHasOnboarded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [showWalletGate, setShowWalletGate] = useState(false);
  const [showStarterReveal, setShowStarterReveal] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [freezeFlow, setFreezeFlow] = useState(false);
  const devMode = import.meta.env.DEV;
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showRewardsModal, setShowRewardsModal] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [shopItems, setShopItems] = useState<ArtifactDef[]>([]);
  const [shopLoading, setShopLoading] = useState(false);
  const [shopError, setShopError] = useState<string | null>(null);
  const [inventory, setInventory] = useState<InventoryState | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [dailyChest, setDailyChest] = useState<DailyChestState | null>(null);
  const [showDailyChest, setShowDailyChest] = useState(false);
  const [dailyChestClaimed, setDailyChestClaimed] = useState(false);
  const [dailyChestRewards, setDailyChestRewards] = useState<RewardPayload | null>(null);
  const [phaserReady, setPhaserReady] = useState(false);
  const [assetsReady, setAssetsReady] = useState(false);
  const [bgLoadProgress, setBgLoadProgress] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardTotal, setLeaderboardTotal] = useState(0);
  const [leaderboardMyEntry, setLeaderboardMyEntry] = useState<LeaderboardEntry | null>(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [totalMonPool, setTotalMonPool] = useState("0");
  const [baseState, setBaseState] = useState<BaseState | null>(null);
  const [demoDailyState, setDemoDailyState] = useState<DemoDailyState>(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = `${now.getMonth() + 1}`.padStart(2, "0");
    const day = `${now.getDate()}`.padStart(2, "0");
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    return { dayKey: `${year}-${month}-${day}`, matchesPlayed: 0, resetAt: next.toISOString() };
  });

  const getLocalDayKey = (date: Date) => {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const getNextLocalMidnightIso = (date: Date) => {
    const next = new Date(date);
    next.setHours(24, 0, 0, 0);
    return next.toISOString();
  };

  const readDemoDailyState = useCallback((atMs = Date.now()): DemoDailyState => {
    const now = new Date(atMs);
    const todayKey = getLocalDayKey(now);
    const defaultState: DemoDailyState = {
      dayKey: todayKey,
      matchesPlayed: 0,
      resetAt: getNextLocalMidnightIso(now)
    };
    if (demoDailyState.dayKey !== todayKey) {
      return defaultState;
    }
    return {
      dayKey: todayKey,
      matchesPlayed: Math.max(0, Math.floor(Number(demoDailyState.matchesPlayed) || 0)),
      resetAt: demoDailyState.resetAt || defaultState.resetAt
    };
  }, [demoDailyState]);

  const writeDemoDailyState = useCallback((state: DemoDailyState) => {
    setDemoDailyState(state);
  }, []);

  const getDemoMatchesLeft = useCallback((atMs = Date.now()) => {
    const state = readDemoDailyState(atMs);
    return Math.max(0, DEMO_DAILY_MATCH_CAP - state.matchesPlayed);
  }, [readDemoDailyState]);

  const consumeDemoMatch = useCallback((atMs = Date.now()) => {
    const state = readDemoDailyState(atMs);
    const leftBefore = Math.max(0, DEMO_DAILY_MATCH_CAP - state.matchesPlayed);
    if (leftBefore <= 0) {
      return { ok: false as const, matchesLeft: 0, resetAt: state.resetAt };
    }
    const nextState: DemoDailyState = {
      ...state,
      matchesPlayed: state.matchesPlayed + 1
    };
    writeDemoDailyState(nextState);
    return {
      ok: true as const,
      matchesLeft: Math.max(0, DEMO_DAILY_MATCH_CAP - nextState.matchesPlayed),
      resetAt: nextState.resetAt
    };
  }, [readDemoDailyState, writeDemoDailyState]);

  useEffect(() => {
    if (!gameRef.current) {
      gameRef.current = new PhaserGame("game-root");
    }
  }, []);

  useEffect(() => {
    const onReady = () => setPhaserReady(true);
    const onAssetsReady = () => {
      setAssetsReady(true);
      setBgLoadProgress(1);
    };
    const onBgProgress = (value: number) => setBgLoadProgress(value);

    eventBus.on("phaser:ready", onReady);
    eventBus.on("phaser:assets-ready", onAssetsReady);
    eventBus.on("phaser:bg-progress", onBgProgress);
    return () => {
      eventBus.off("phaser:ready", onReady);
      eventBus.off("phaser:assets-ready", onAssetsReady);
      eventBus.off("phaser:bg-progress", onBgProgress);
    };
  }, []);

  useEffect(() => {
    if (!devMode) return;
    const params = new URLSearchParams(window.location.search);
    const devFreeze = params.get("freeze") === "1";
    const devScreen = params.get("screen");
    if (devFreeze) setFreezeFlow(true);
    if (devScreen === "menu" || devScreen === "pre" || devScreen === "battle" || devScreen === "base") {
      setScreen(devScreen);
    }
  }, [devMode]);

  useEffect(() => {
    const handler = () => {
      if (freezeFlow) return;
      if (isDemoMode) {
        setShowRewardsModal(false);
        setRewards(null);
        setResolution(null);
        setScreen("pre");
        return;
      }
      setShowRewardsModal(true);
    };
    eventBus.on("battle:complete", handler);
    return () => {
      eventBus.off("battle:complete", handler);
    };
  }, [freezeFlow, isDemoMode]);

  // Flyout animation: icons fly out of chest one by one, then +N appears on HUD
  useEffect(() => {
    if (showRewardsModal && !rewards) {
      setDisplayRewards({ coins: 0, pearls: 0, shards: 0 });
      setIsCountingRewards(false);
      setRewardFlyouts([]);
      setHudPopups([]);
    }
    if (!rewards || !showRewardsModal) return;

    setIsCountingRewards(true);
    setRewardFlyouts([]);
    setHudPopups([]);

    // Build list of reward entries to animate
    const entries: { type: string; amount: number }[] = [];
    if (rewards.coins > 0) entries.push({ type: "coins", amount: rewards.coins });
    if (rewards.pearls > 0) entries.push({ type: "pearls", amount: rewards.pearls });
    if (rewards.shards > 0) entries.push({ type: "shards", amount: rewards.shards });

    if (entries.length === 0) {
      setIsCountingRewards(false);
      return;
    }

    const delayPerItem = 600; // ms between each flyout
    const flyDuration = 800;  // ms for the fly animation

    entries.forEach((entry, idx) => {
      // Launch flyout icon
      setTimeout(() => {
        const id = ++flyoutIdRef.current;
        playSfx("rewardPop");
        setRewardFlyouts(prev => [...prev, { type: entry.type, amount: entry.amount, id }]);

        // After fly animation ends, remove flyout and show HUD popup
        setTimeout(() => {
          setRewardFlyouts(prev => prev.filter(f => f.id !== id));
          const hudId = ++flyoutIdRef.current;
          setHudPopups(prev => [...prev, { type: entry.type, amount: entry.amount, id: hudId }]);
          // Remove HUD popup after it fades
          setTimeout(() => {
            setHudPopups(prev => prev.filter(p => p.id !== hudId));
          }, 3000);
        }, flyDuration);
      }, idx * delayPerItem);
    });

    // Mark counting done after all animations finish
    setTimeout(() => {
      setIsCountingRewards(false);
    }, entries.length * delayPerItem + flyDuration + 200);

  }, [rewards, showRewardsModal]);

  const startDevBattle = useCallback(() => {
    const weather = WEATHER[0];
    const playerLineup = selectedLineup.length === 3 ? selectedLineup : HEROES;
    const opponentLineup = HEROES.map((hero, index) => ({
      id: `dev-${index}`,
      hero,
      upgrades: { piercingLevel: 0 }
    }));
    const rounds = playerLineup.map((hero, index) => ({
      playerHero: hero,
      opponentHero: opponentLineup[index]?.hero || "Shark",
      result: "win" as const
    }));
    const dummyResolution: MatchResolution = {
      matchId: "dev",
      result: "win",
      weather,
      playerLineup,
      opponentLineup,
      rounds,
      chestId: "dev",
      matchesLeft,
      resetAt
    };
    setWinStreak((prev) => Math.min(5, prev + 1));
    setPreview({
      matchId: "dev",
      weather,
      playerLineup,
      opponentLineup,
      matchesLeft,
      resetAt
    });
    setResolution(dummyResolution);
    gameRef.current?.startBattle({
      playerLineup,
      opponentLineup,
      rounds,
      result: "win",
      weatherKey: weather.backgroundKey
    });
  }, [selectedLineup, matchesLeft, resetAt]);

  useEffect(() => {
    if (!phaserReady) return;
    if (screen !== "battle") {
      gameRef.current?.showMenu();
    }
    if (screen === "battle" && !resolution) {
      startDevBattle();
    }
  }, [screen, phaserReady, resolution, startDevBattle]);

  // Also include "base" in the condition for showing menu bg
  // (handled by the className below)

  useEffect(() => {
    if (!phaserReady) return;
    if (screen === "battle" && resolution) {
      gameRef.current?.startBattle({
        playerLineup: resolution.playerLineup,
        opponentLineup: resolution.opponentLineup,
        rounds: resolution.rounds,
        result: resolution.result,
        weatherKey: resolution.weather.backgroundKey
      });
    }
  }, [screen, resolution, selectedHero, phaserReady]);

  useEffect(() => {
    setSfxEnabled(soundEnabled);
  }, [soundEnabled]);

  useEffect(() => {
    if (screen === "battle") {
      fadeOutMenuLoop(260);
      return;
    }
    if (soundEnabled) {
      playMenuLoop();
    } else {
      fadeOutMenuLoop(0);
    }
  }, [screen, soundEnabled]);

  const walletRequest = async (method: string, params?: unknown[]) => {
    const provider = await getWalletProvider({
      reownProjectId: REOWN_PROJECT_ID,
      chainIdHex: MONAD_CHAIN_HEX,
      chainName: MONAD_CHAIN_NAME,
      rpcUrl: MONAD_RPC_URL
    });
    return provider.request({ method, params });
  };

  const ensureMonadNetwork = async () => {
    const chainId = (await walletRequest("eth_chainId")) as string;
    if ((chainId || "").toLowerCase() === MONAD_CHAIN_HEX) return;
    try {
      await walletRequest("wallet_switchEthereumChain", [{ chainId: MONAD_CHAIN_HEX }]);
    } catch {
      if (!MONAD_RPC_URL) {
        throw new Error("Set VITE_MONAD_RPC_URL to add/switch Monad network automatically.");
      }
      await walletRequest("wallet_addEthereumChain", [{
        chainId: MONAD_CHAIN_HEX,
        chainName: MONAD_CHAIN_NAME,
        nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
        rpcUrls: [MONAD_RPC_URL]
      }]);
    }
  };

  const ensureAuth = async () => {
    return Boolean(token);
  };

  const clearAuth = () => {
    clearStoredAuth();
    setToken(null);
    setAddressStored(null);
    setBaseState(null);
    setScreen("menu");
    assertNoForbiddenStorageKeysDev("clear-auth");
  };

  useEffect(() => {
    const ethereum = (window as Window & {
      ethereum?: {
        on?: (event: string, handler: (...args: unknown[]) => void) => void;
        removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
      };
    }).ethereum;
    if (!ethereum?.on || !ethereum?.removeListener) return;

    const onAccountsChanged = (accountsRaw: unknown) => {
      const accounts = Array.isArray(accountsRaw) ? (accountsRaw as string[]) : [];
      const nextAddress = normalizeWalletAddress(accounts[0] || "");
      if (!nextAddress) {
        if (!hadWalletRef.current) {
          return;
        }
        clearAuth();
        return;
      }
      hadWalletRef.current = true;
      if (addressStored && addressStored.toLowerCase() !== nextAddress.toLowerCase()) {
        clearAuth();
      } else {
        setAddressStored(nextAddress);
      }
    };

    ethereum.on("accountsChanged", onAccountsChanged);
    return () => {
      ethereum.removeListener?.("accountsChanged", onAccountsChanged);
    };
  }, [addressStored]);

  const loadState = useCallback(async (authToken?: string) => {
    const activeToken = authToken || token;
    if (!activeToken) return null;
    try {
      const state = await getState(activeToken);
      const normalizedServerAddress = normalizeWalletAddress(state.address);
      if (normalizedServerAddress) {
        setAddressStored(normalizedServerAddress);
        hadWalletRef.current = true;
        if (readStoredAddress()?.toLowerCase() !== normalizedServerAddress.toLowerCase()) {
          localStorage.setItem(STORAGE_ADDRESS, normalizedServerAddress);
        }
      }
      const serverBase = await fetchBase(activeToken);
      setBaseState(serverBase);
      setHeroes(state.heroes);
      const baseLineup = (state.heroes.length > 0 ? state.heroes : HEROES).slice(0, 3);
      const restoredLineup =
        baseLineup.length === 3
          ? baseLineup
          : [...baseLineup, ...HEROES.filter((hero) => !baseLineup.includes(hero))].slice(0, 3);
      setSelectedLineup(restoredLineup);
      if (restoredLineup.length > 0) {
        setSelectedHero(restoredLineup[0]);
        setActiveLineupIndex(0);
      }
      setMatchesLeft(state.matchesLeft);
      setResetAt(state.resetAt);
      setHasOnboarded(state.hasOnboarded);
      setResources(state.resources);
      if (state.dailyChest) {
        setDailyChest(state.dailyChest);
        // Auto-show daily chest popup if not yet claimed today
        if (!state.dailyChest.claimedToday) {
          setShowDailyChest(true);
        }
      }
      assertNoForbiddenStorageKeysDev("load-state");
      return state;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        clearAuth();
      }
      throw err;
    }
  }, [token, setResources]);

  useEffect(() => {
    if (token) {
      loadState().catch(() => null);
    }
  }, [token, loadState]);

  const onPlay = async () => {
    playSfx("buttonClick");
    preloadSfx(); // preload all sounds on first interaction
    playMenuLoop();
    setLoading(true);
    setWalletBusy(true);
    setShowWalletGate(true);
    setWalletError(null);
    setErrorMsg(null);
    try {
      await ensureMonadNetwork();
      const accounts = (await walletRequest("eth_requestAccounts")) as string[];
      const address = normalizeWalletAddress(accounts?.[0]);
      if (!address) throw new Error("Wallet is not connected.");
      if (addressStored && addressStored.toLowerCase() !== address.toLowerCase()) {
        clearAuth();
      }

      const { message } = await fetchNonce(address);
      const signature = (await walletRequest("personal_sign", [message, address])) as string;
      const authRes = await login(address, signature);
      writeStoredAuth(authRes.token, authRes.address);
      setToken(authRes.token);
      setAddressStored(authRes.address);
      assertNoForbiddenStorageKeysDev("post-login");
      closeWalletModal();

      const state = await loadState(authRes.token);
      if (!state) throw new Error("Failed to load player state.");
      setScreen("base");
      setShowWalletGate(false);
    } catch (err) {
      const msg = (err as Error)?.message || "Failed to start. Please try again.";
      setWalletError(msg);
      setErrorMsg(msg);
    } finally {
      setWalletBusy(false);
      setLoading(false);
    }
  };

  const onClaimOnboarding = async () => {
    if (!token) return;
    setLoading(true);
    try {
      setShowStarterReveal(false);
      setShowConfetti(true);
      const res = await claimOnboarding(token);
      setRewards(res.rewards);
      addResources({
        coins: res.rewards.coins,
        pearls: res.rewards.pearls,
        shards: res.rewards.shards
      });
      setHasOnboarded(true);
      await loadState();
      setScreen("pre");
      setTimeout(() => setShowConfetti(false), 1600);
    } finally {
      setLoading(false);
    }
  };

  const onPrepareMatch = useCallback(async () => {
    if (isDemoMode) return;
    if (!token) return;
    const res = await prepareMatch(token, selectedLineup);
    setPreview(res);
    setMatchesLeft(res.matchesLeft);
    setResetAt(res.resetAt);
  }, [isDemoMode, token, selectedLineup]);

  useEffect(() => {
    if (screen === "pre" && !isDemoMode && token && selectedLineup.length === 3) {
      onPrepareMatch().catch(() => null);
    }
  }, [screen, isDemoMode, token, selectedLineup, onPrepareMatch]);

  const randomHero = useCallback((): HeroType => {
    return HEROES[Math.floor(Math.random() * HEROES.length)] || "Shark";
  }, []);

  const createDemoPreview = useCallback((lineup: HeroType[]): MatchPreview => {
    const weather = WEATHER[Math.floor(Math.random() * WEATHER.length)] || WEATHER[0];
    const opponentLineup = Array.from({ length: 3 }).map((_, index) => ({
      id: `demo-${index}`,
      hero: randomHero(),
      upgrades: { piercingLevel: 0 }
    }));
    return {
      matchId: "demo",
      weather,
      playerLineup: lineup,
      opponentLineup,
      matchesLeft: getDemoMatchesLeft(),
      resetAt: readDemoDailyState().resetAt
    };
  }, [getDemoMatchesLeft, randomHero, readDemoDailyState]);

  const startDemo = () => {
    playSfx("buttonClick");
    const playerLineup = selectedLineup.length === 3 ? selectedLineup : HEROES;
    const dailyState = readDemoDailyState();
    const left = Math.max(0, DEMO_DAILY_MATCH_CAP - dailyState.matchesPlayed);
    setIsDemoMode(true);
    setResolution(null);
    setRewards(null);
    setShowRewardsModal(false);
    setMatchesLeft(left);
    setResetAt(dailyState.resetAt);
    setPreview(createDemoPreview(playerLineup));
    setScreen("pre");
  };

  const onPlayDemo = () => {
    playSfx("buttonClick");
    preloadSfx();
    playMenuLoop();
    setScreen("base");
  };

  const onTrenches = () => {
    if (token) {
      playSfx("buttonClick");
      setIsDemoMode(false);
      setErrorMsg(null);
      setShowRewardsModal(false);
      setRewards(null);
      setResolution(null);
      setScreen("pre");
      return;
    }
    startDemo();
  };

  useEffect(() => {
    if (!isDemoMode) return;
    if (screen !== "pre") return;
    if (selectedLineup.length !== 3) return;
    setPreview((prev) => {
      if (!prev) return createDemoPreview(selectedLineup);
      return {
        ...prev,
        playerLineup: selectedLineup
      };
    });
  }, [isDemoMode, screen, selectedLineup, createDemoPreview]);

  useEffect(() => {
    if (!isDemoMode || screen !== "pre") return;
    const syncDemoDaily = () => {
      const dailyState = readDemoDailyState();
      setMatchesLeft(Math.max(0, DEMO_DAILY_MATCH_CAP - dailyState.matchesPlayed));
      setResetAt(dailyState.resetAt);
    };
    syncDemoDaily();
    const timer = window.setInterval(syncDemoDaily, 30_000);
    return () => window.clearInterval(timer);
  }, [isDemoMode, screen, readDemoDailyState]);

  /** Wait for background assets to finish loading (resolves immediately if already done) */
  const waitForAssets = useCallback((): Promise<void> => {
    if (assetsReady) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        eventBus.off("phaser:assets-ready", check);
        resolve();
      };
      eventBus.on("phaser:assets-ready", check);
    });
  }, [assetsReady]);

  const onStartMatch = async () => {
    if (!preview) return;
    if (matchesLeft <= 0) {
      setErrorMsg(`No matches left today. Reset in ${resetTimer || "00:00:00"}`);
      return;
    }
    playSfx("buttonClick");
    setErrorMsg(null);
    setRewards(null);
    setScreen("loading");
    setLoading(true);
    try {
      if (isDemoMode) {
        const consumed = consumeDemoMatch();
        if (!consumed.ok) {
          setMatchesLeft(0);
          setResetAt(consumed.resetAt);
          setErrorMsg(`No matches left today. Reset in ${resetTimer || "00:00:00"}`);
          setScreen("pre");
          return;
        }
        setMatchesLeft(consumed.matchesLeft);
        setResetAt(consumed.resetAt);
        const playerLineup = (selectedLineup.length === 3 ? selectedLineup : HEROES).slice(0, 3);
        const opponentLineup = preview.opponentLineup.slice(0, 3);
        const rounds: Array<{ playerHero: HeroType; opponentHero: HeroType; result: MatchResult }> = [];
        let playerIndex = 0;
        let opponentIndex = 0;
        while (playerIndex < playerLineup.length && opponentIndex < opponentLineup.length) {
          const playerHero = playerLineup[playerIndex];
          const opponentHero = opponentLineup[opponentIndex].hero;
          const win = Math.random() < 0.8;
          rounds.push({
            playerHero,
            opponentHero,
            result: win ? "win" : "lose"
          });
          if (win) {
            opponentIndex += 1;
          } else {
            playerIndex += 1;
          }
        }
        const result: MatchResult = opponentIndex >= opponentLineup.length ? "win" : "lose";
        const demoResolution: MatchResolution = {
          matchId: "demo",
          result,
          weather: preview.weather,
          playerLineup,
          opponentLineup,
          rounds,
          chestId: "demo",
          matchesLeft: consumed.matchesLeft,
          resetAt: consumed.resetAt
        };
        setResolution(demoResolution);
        if (result === "win") {
          setWinStreak((prev) => Math.min(5, prev + 1));
        } else {
          setWinStreak(0);
        }
        gameRef.current?.startBattle({
          playerLineup: demoResolution.playerLineup,
          opponentLineup: demoResolution.opponentLineup,
          rounds: demoResolution.rounds,
          result: demoResolution.result,
          weatherKey: demoResolution.weather.backgroundKey
        });
        setScreen("battle");
        return;
      }

      if (!token) {
        setScreen("menu");
        return;
      }
      // Resolve match + wait for assets in parallel
      const [res] = await Promise.all([
        resolveMatch(token, preview.matchId, crypto.randomUUID()),
        waitForAssets()
      ]);
      setResolution(res);
      setWinStreak((prev) => (res.result === "win" ? Math.min(5, prev + 1) : 0));
      setMatchesLeft(res.matchesLeft);
      setResetAt(res.resetAt);
      gameRef.current?.startBattle({
        playerLineup: res.playerLineup,
        opponentLineup: res.opponentLineup,
        rounds: res.rounds,
        result: res.result,
        weatherKey: res.weather.backgroundKey
      });
      setScreen("battle");
    } catch (err) {
      setErrorMsg("Match failed. Please try again.");
      setScreen("pre");
    } finally {
      setLoading(false);
    }
  };

  const onOpenChest = async () => {
    if (!token || !resolution) return;
    if (rewards) {
      playSfx("buttonClick");
      setShowRewardsModal(false);
      setScreen("pre");
      return;
    }
    playSfx("chestOpen");
    const idemKey = crypto.randomUUID();
    const res = await openChest(token, resolution.chestId, idemKey);
    setRewards(res.rewards);
    addResources({
      coins: res.rewards.coins,
      pearls: res.rewards.pearls,
      shards: res.rewards.shards
    });
  };

  const openLeaderboard = async () => {
    playSfx("modalOpen");
    setShowLeaderboard(true);
    setLeaderboardError(null);
    setLeaderboardLoading(true);
    try {
      const res = await fetchLeaderboard(token || undefined);
      setLeaderboard(res.entries);
      setLeaderboardTotal(res.totalPlayers);
      setLeaderboardMyEntry(res.myEntry);
    } catch {
      setLeaderboardError("Failed to load leaderboard");
    } finally {
      setLeaderboardLoading(false);
    }
  };

  const openShop = async () => {
    playSfx("modalOpen");
    setShowInventory(false);
    setShowLeaderboard(false);
    setShowMatchups(false);
    setShowShop(true);
    setShopError(null);
    setShopLoading(true);
    try {
      const res = await fetchShop();
      setShopItems(res.artifacts);
      if (token) {
        const inv = await fetchInventory(token);
        setInventory(inv);
      }
    } catch {
      setShopError("Failed to load shop");
    } finally {
      setShopLoading(false);
    }
  };

  const openInventory = async () => {
    playSfx("modalOpen");
    if (!token) {
      const ok = await ensureAuth();
      if (!ok) return;
    }
    setShowShop(false);
    setShowLeaderboard(false);
    setShowMatchups(false);
    setShowInventory(true);
    setInventoryError(null);
    setInventoryLoading(true);
    try {
      const res = await fetchInventory(token || "");
      setInventory(res);
    } catch {
      setInventoryError("Failed to load inventory");
    } finally {
      setInventoryLoading(false);
    }
  };

  const onClaimDailyChest = async () => {
    if (!token) return;
    playSfx("chestOpen");
    try {
      const res = await claimDailyChest(token);
      setDailyChestRewards(res.rewards);
      setDailyChestClaimed(true);
      setResources(res.resources);
      addResources({ coins: 0, pearls: 0, shards: 0 }); // trigger re-render
      setDailyChest({
        streakDay: res.streakDay,
        claimedToday: true,
        nextReward: DAILY_CHEST_TIERS[res.streakDay >= 7 ? 0 : res.streakDay] || DAILY_CHEST_TIERS[0]
      });
    } catch (err) {
      // Already claimed — just close
      setDailyChestClaimed(true);
    }
  };

  const closeDailyChest = () => {
    playSfx("modalClose");
    setShowDailyChest(false);
    setDailyChestRewards(null);
    setDailyChestClaimed(false);
  };

  const onBuyArtifact = async (artifactId: string) => {
    if (!token) {
      const ok = await ensureAuth();
      if (!ok) return;
    }
    setShopLoading(true);
    try {
      const res = await buyArtifact(token || "", artifactId);
      playSfx("buttonClick");
      setResources(res.resources);
      const updatedInventory = await fetchInventory(token || "");
      setInventory(updatedInventory);
    } catch {
      setShopError("Purchase failed");
    } finally {
      setShopLoading(false);
    }
  };

  const onEquipArtifact = async (artifactId: string) => {
    if (!token) return;
    playSfx("buttonClick");
    setInventoryLoading(true);
    try {
      const res = await equipArtifact(token, artifactId);
      setInventory(res);
    } catch {
      setInventoryError("Equip failed");
    } finally {
      setInventoryLoading(false);
    }
  };

  useEffect(() => {
    if (!resetAt) return;
    const updateTimer = () => {
      const now = Date.now();
      const target = new Date(resetAt).getTime();
      const diff = Math.max(0, target - now);
      const hrs = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setResetTimer(
        `${hrs.toString().padStart(2, "0")}:${mins
          .toString()
          .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
      );
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [resetAt]);

  useEffect(() => {
    let cancelled = false;
    const loadPool = async () => {
      try {
        const res = await fetchPoolStats();
        if (!cancelled) {
          setTotalMonPool(res.totalMon);
        }
      } catch {
        // Keep last known stats if request fails.
      }
    };
    void loadPool();
    const timer = window.setInterval(() => {
      void loadPool();
    }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const weatherLabel = preview
    ? `${preview.weather.name} (+${Math.round(preview.weather.bonus * 100)}%)`
    : "Unknown";

  const weatherBonusInfo = preview
    ? `Favored: ${preview.weather.favored} (+${Math.round(preview.weather.bonus * 100)}%)`
    : "Favored: —";

  const weatherImage = preview ? getWeatherImageUrl(preview.weather.id) : "";
  const favoredWeather = WEATHER.filter((weather) => weather.favored === selectedHero);
  const matchupWinRates = [
    "Shark > Whale: 68%",
    "Whale > Shrimp: 64%",
    "Shrimp > Shark: 66%"
  ];
  const shopArtifacts = (shopItems.length ? shopItems : ARTIFACTS).filter(
    (artifact) => artifact.hero === selectedHero
  );
  const inventoryItems = inventory
    ? inventory.items.filter((item) => item.hero === selectedHero)
    : [];
  const equippedSlots = inventory?.equipped?.[selectedHero] || {};
  const findArtifact = (artifactId?: string) =>
    (shopItems.length ? shopItems : ARTIFACTS).find((artifact) => artifact.id === artifactId);

  return (
    <div className={`app ${screen !== "battle" ? "show-menu-bg" : ""}`}>
      <div className="menu-bg" />
      <div id="game-root" className="game-root" />
      <div className="bubbles-layer" aria-hidden="true">
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
      <div className="ui-layer">
        <div className="ui-content">
        {showWalletGate && (
          <div className="modal-backdrop">
            <div className="modal">
              <h3>Wallet Checkpoint</h3>
              <div className="hint">Connect wallet and sign message to continue.</div>
              {walletBusy && <div>Waiting for signature...</div>}
              {walletError && <div className="error-text">{walletError}</div>}
              {!walletBusy && (
                <button className="primary" onClick={() => setShowWalletGate(false)}>
                  Close
                </button>
              )}
            </div>
          </div>
        )}
        {screen !== "base" && screen !== "menu" && (
        <div className="top-resource-bar">
          {!assetsReady && (
            <div className="bg-load-stripe" style={{ width: `${Math.round(bgLoadProgress * 100)}%` }} />
          )}
          {addressStored && (
            <div className="player-tag">
              <span className="player-tag-icon">🐟</span>
              <span className="player-tag-name">{addressStored.slice(0, 10)}…</span>
            </div>
          )}
          <div className="streak-icons" aria-label={`Win streak ${winStreak} of 5`}>
            {Array.from({ length: 5 }).map((_, index) => (
              <img
                key={`streak-${index}`}
                className={index < winStreak ? "streak-icon active" : "streak-icon"}
                src={index < winStreak ? "/assets/ui/FireOn.avif" : "/assets/ui/FireOff.avif"}
                alt={index < winStreak ? "Fire On" : "Fire Off"}
              />
            ))}
          </div>
          <div className="resource-actions">
            <button className="ghost-button" onClick={openLeaderboard}>
              Leaderboard
            </button>
            <button className="ghost-button" onClick={() => { playSfx("modalOpen"); setShowMatchups(true); }}>
              Matchups
            </button>
            <button className="ghost-button" disabled style={{ opacity: 0.4, cursor: "not-allowed" }}>
              Shop
            </button>
            <button className="ghost-button" disabled style={{ opacity: 0.4, cursor: "not-allowed" }}>
              Inventory
            </button>
            <button className="ghost-button" onClick={() => setScreen("base")}>
              Base
            </button>
            <button className="ghost-button" onClick={() => setSoundEnabled((prev) => !prev)}>
              {soundEnabled ? "Sound: ON" : "Sound: OFF"}
            </button>
          </div>
        </div>
        )}

        {screen === "base" && (
          <BaseScreen
            token={token}
            onBack={() => setScreen("menu")}
            onTrenches={onTrenches}
          />
        )}

        {screen === "menu" && (
          <div className="screen center menu-screen">
            <button className="primary big start-button" onClick={onPlay} disabled={loading}>
            </button>
            {errorMsg && <div className="hint error-text">{errorMsg}</div>}
          </div>
        )}

        {screen === "onboarding" && (
          <div className="screen center">
            <h2>Starter Chest</h2>
            <div className="chest-card">
              <div className="chest-icon" />
              <p>Claim your starter heroes: Shark, Whale, Shrimp.</p>
              <button
                className="primary"
                onClick={() => setShowStarterReveal(true)}
                disabled={loading}
              >
                Open Starter Chest
              </button>
            </div>
          </div>
        )}

        {screen === "pre" && (
          <div className="screen">
            <div className="panel prematch-panel">
              <div className="prematch-shell">
                <div className="prematch-left">
                  <div className="hero-showcase">
                    <img
                      src={`/assets/heroes/${selectedHero.toLowerCase()}/${selectedHero.toLowerCase()}_pose_base.avif`}
                      alt={`${selectedHero} base pose`}
                    />
                  </div>
                  <div className="lineup-section">
                    <div className="label">Lineup</div>
                    <div className="lineup-slots">
                      {selectedLineup.map((hero, index) => (
                        <button
                          key={`${hero}-${index}`}
                          className={index === activeLineupIndex ? "lineup-slot active" : "lineup-slot"}
                          onClick={() => {
                            setActiveLineupIndex(index);
                            setSelectedHero(hero);
                          }}
                          aria-label={`Lineup slot ${index + 1}: ${hero}`}
                        >
                          <img
                            src={`/assets/heroes/${hero.toLowerCase()}/${hero.toLowerCase()}_pose_base.avif`}
                            alt={hero}
                          />
                          <span className="slot-index">{index + 1}</span>
                        </button>
                      ))}
                    </div>
                    <div className="label">Slot {activeLineupIndex + 1}</div>
                    <div className="hero-picker icons">
                      {(["Shrimp", "Shark", "Whale"] as HeroType[]).map((hero) => (
                        <button
                          key={hero}
                          className={hero === selectedHero ? "hero-icon active" : "hero-icon"}
                          onClick={() => {
                            setSelectedLineup((prev) => {
                              const next = [...prev];
                              next[activeLineupIndex] = hero;
                              return next;
                            });
                            setSelectedHero(hero);
                          }}
                          aria-label={`Select ${hero}`}
                        >
                          <img
                            src={`/assets/heroes/${hero.toLowerCase()}/${hero.toLowerCase()}_pose_base.avif`}
                            alt={hero}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="prematch-card">
                  <div className="prematch-card-body">
                    <div className="weather-card large match-info-weather">
                      <div className="label">Weather</div>
                      <div className="weather-content">
                        <img src={weatherImage} alt="Weather" />
                        <div>
                          <div className="value">{weatherLabel}</div>
                          <div className="hint">{weatherBonusInfo}</div>
                        </div>
                      </div>
                    </div>
                    <div className="match-info-row">
                      <div className="matches-box compact match-info-matches">
                        <div className="label">Daily Matches</div>
                        <div className="value">{matchesLeft}</div>
                        {matchesLeft === 0 && (
                          <div className="hint">
                            Reset in {resetTimer}
                          </div>
                        )}
                      </div>
                      <div className="hero-bonus match-info-bonuses">
                        <div className="label">Weather Bonuses</div>
                        <div className="hint">
                          {selectedHero} bonus:
                        </div>
                        <ul>
                          {favoredWeather.map((weather) => (
                            <li key={weather.id}>
                              {weather.name} (+{Math.round(weather.bonus * 100)}%)
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <button
                      className="primary big center-button match-info-start match-start-button"
                      onClick={onStartMatch}
                      disabled={matchesLeft <= 0 || !preview}
                    >
                    </button>
                    {errorMsg && <div className="hint error-text">{errorMsg}</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {screen === "loading" && (
          <div className="screen center">
            <h2>Loading match...</h2>
            <div className="spinner" />
            {!assetsReady && (
              <div className="bg-load-bar-wrap">
                <div
                  className="bg-load-bar"
                  style={{ width: `${Math.round(bgLoadProgress * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {showRewardsModal && !rewards && (
          <div className="chest-float">
            <div className="chest-card">
              <button
                className="chest-button"
                onClick={onOpenChest}
                disabled={loading}
                aria-label="Open chest"
              >
                <div className="chest-icon reward interactive" />
              </button>
            </div>
          </div>
        )}
        {showRewardsModal && rewards && (
          <div className="chest-float">
            <div className="chest-card" style={{ position: 'relative' }}>
              <div className="chest-icon reward opened" />
              {/* Flyout icons that fly upward from the chest */}
              {rewardFlyouts.map(f => {
                const iconMap: Record<string, string> = {
                  coins: "/assets/ui/Coins.avif",
                  pearls: "/assets/ui/Pearls.avif",
                  shards: "/assets/ui/Shards.avif"
                };
                return (
                  <div key={f.id} className="reward-flyout">
                    <img src={iconMap[f.type] || ""} alt={f.type} className="reward-flyout-icon" />
                  </div>
                );
              })}
              {!isCountingRewards && (
                <button
                  className="chest-collect-button"
                  onClick={onOpenChest}
                >
                  <img src="/assets/ui/Collect.avif" alt="Collect" className="collect-icon" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {showMatchups && (
        <div className="modal-backdrop" onClick={() => { playSfx("modalClose"); setShowMatchups(false); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Matchups</h3>
            <ul>
              {matchupWinRates.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <button className="close-img-button" onClick={() => { playSfx("modalClose"); setShowMatchups(false); }}>
              <img src="/assets/ui/Close.avif" alt="Close" className="close-img-icon" />
            </button>
          </div>
        </div>
      )}

      {showLeaderboard && (
        <div className="modal-backdrop" onClick={() => { playSfx("modalClose"); setShowLeaderboard(false); }}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>🏆 Leaderboard</h3>
            {leaderboardLoading && <div>Loading...</div>}
            {leaderboardError && <div className="error-text">{leaderboardError}</div>}
            {!leaderboardLoading && !leaderboardError && (
              <>
                <div className="leaderboard-header">
                  <span className="lb-col rank">#</span>
                  <span className="lb-col address">Player</span>
                  <span className="lb-col points">Points</span>
                  <span className="lb-col wins">W/L</span>
                  <span className="lb-col streak">Best Streak</span>
                </div>
                <div className="leaderboard-list">
                  {leaderboard.map((entry) => {
                    const isMe = addressStored && entry.address === addressStored;
                    return (
                      <div key={entry.address} className={`leaderboard-row${isMe ? " my-row" : ""}`}>
                        <span className="lb-col rank">#{entry.rank}</span>
                        <span className="lb-col address">{entry.address.slice(0, 12)}…{isMe ? " (You)" : ""}</span>
                        <span className="lb-col points">{entry.points}</span>
                        <span className="lb-col wins">{entry.wins}/{entry.matches - entry.wins}</span>
                        <span className="lb-col streak">🔥 {entry.bestStreak}</span>
                      </div>
                    );
                  })}
                  {leaderboardMyEntry && (
                    <>
                      <div className="leaderboard-separator">⋯</div>
                      <div className="leaderboard-row my-row">
                        <span className="lb-col rank">#{leaderboardMyEntry.rank}</span>
                        <span className="lb-col address">{leaderboardMyEntry.address.slice(0, 12)}… (You)</span>
                        <span className="lb-col points">{leaderboardMyEntry.points}</span>
                        <span className="lb-col wins">{leaderboardMyEntry.wins}/{leaderboardMyEntry.matches - leaderboardMyEntry.wins}</span>
                        <span className="lb-col streak">🔥 {leaderboardMyEntry.bestStreak}</span>
                      </div>
                    </>
                  )}
                </div>
                <div className="leaderboard-footer">
                  Total participants: {leaderboardTotal}
                </div>
              </>
            )}
            <button className="close-img-button" onClick={() => { playSfx("modalClose"); setShowLeaderboard(false); }}>
              <img src="/assets/ui/Close.avif" alt="Close" className="close-img-icon" />
            </button>
          </div>
        </div>
      )}

      {showShop && (
        <div className="modal-backdrop" onClick={() => { playSfx("modalClose"); setShowShop(false); }}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>Shop</h3>
            <div className="hint">Artifacts are bound to the selected hero.</div>
            {shopLoading && <div>Loading...</div>}
            {shopError && <div className="error-text">{shopError}</div>}
            {!shopLoading && !shopError && (
              <div className="shop-grid">
                {shopArtifacts
                  .filter(
                    (artifact) =>
                      !(inventory?.items || []).some(
                        (item) => item.artifactId === artifact.id
                      )
                  )
                  .map((artifact) => (
                  <div key={artifact.id} className="shop-card">
                    <div className="shop-title">{artifact.name}</div>
                    <div className="shop-meta">
                      {artifact.slot} • Bonus vs {artifact.bonusAgainst}
                    </div>
                    <div className="shop-desc">{artifact.description}</div>
                    <div className="shop-footer">
                      <span>Cost: {artifact.cost.coins} Coins</span>
                      <button
                        className="primary small"
                        onClick={() => onBuyArtifact(artifact.id)}
                        disabled={
                          shopLoading ||
                          resources.coins < artifact.cost.coins
                        }
                      >
                        Buy
                      </button>
                    </div>
                  </div>
                ))}
                {shopArtifacts.filter(
                  (artifact) =>
                    !(inventory?.items || []).some(
                      (item) => item.artifactId === artifact.id
                    )
                ).length === 0 && <div>No artifacts for this hero.</div>}
              </div>
            )}
            <button className="primary" onClick={() => { playSfx("modalClose"); setShowShop(false); }}>
              Close
            </button>
          </div>
        </div>
      )}

      {showInventory && (
        <div className="modal-backdrop" onClick={() => { playSfx("modalClose"); setShowInventory(false); }}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>Inventory</h3>
            <div className="hint">Select a hero. Tap an item to equip it.</div>
            {inventoryLoading && <div>Loading...</div>}
            {inventoryError && <div className="error-text">{inventoryError}</div>}
            {!inventoryLoading && !inventoryError && (
              <div className="inventory-layout">
                <div className="inventory-top">
                  <div className="inventory-hero">
                    <button
                      className="ghost-button small"
                      onClick={() => {
                        const idx = HEROES.indexOf(selectedHero);
                        const next = (idx - 1 + HEROES.length) % HEROES.length;
                        setSelectedHero(HEROES[next]);
                      }}
                      aria-label="Previous hero"
                    >
                      ◀
                    </button>
                    <div className="inventory-hero-icon">
                      <img
                        loading="lazy"
                        src={`/assets/heroes/${selectedHero.toLowerCase()}/${selectedHero.toLowerCase()}_pose_base.avif`}
                        alt={selectedHero}
                      />
                    </div>
                    <button
                      className="ghost-button small"
                      onClick={() => {
                        const idx = HEROES.indexOf(selectedHero);
                        const next = (idx + 1) % HEROES.length;
                        setSelectedHero(HEROES[next]);
                      }}
                      aria-label="Next hero"
                    >
                      ▶
                    </button>
                  </div>
                  <div className="inventory-slots">
                    <div className={`slot-card ${equippedSlots.weapon ? "equipped" : ""}`}>
                      <div className="slot-title">Weapon</div>
                      <div className="slot-item">
                        {equippedSlots.weapon
                          ? findArtifact(equippedSlots.weapon)?.name || "Unknown"
                          : "Empty"}
                      </div>
                    </div>
                    <div className={`slot-card ${equippedSlots.armor ? "equipped" : ""}`}>
                      <div className="slot-title">Armor</div>
                      <div className="slot-item">
                        {equippedSlots.armor
                          ? findArtifact(equippedSlots.armor)?.name || "Unknown"
                          : "Empty"}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="inventory-items">
                  {(inventory?.items || []).map((item) => {
                    const artifact = findArtifact(item.artifactId);
                    const isEquipped =
                      (item.slot === "weapon" && equippedSlots.weapon === item.artifactId) ||
                      (item.slot === "armor" && equippedSlots.armor === item.artifactId);
                    const isForHero = item.hero === selectedHero;
                    return (
                      <button
                        key={item.id}
                        className={`inventory-item-card ${isForHero ? "" : "disabled"} ${isEquipped ? "equipped" : ""}`}
                        onClick={() => {
                          if (!isForHero || isEquipped) return;
                          onEquipArtifact(item.artifactId);
                        }}
                        disabled={!isForHero || isEquipped}
                      >
                        <div className="item-preview">
                          <img
                            loading="lazy"
                            src={`/assets/heroes/${item.hero.toLowerCase()}/${item.hero.toLowerCase()}_pose_base.avif`}
                            alt={item.hero}
                          />
                          <span className="item-slot">{item.slot}</span>
                        </div>
                        <div className="shop-title">{artifact?.name || item.artifactId}</div>
                        <div className="shop-meta">
                          {item.hero} • {item.slot}
                        </div>
                        <div className="shop-desc">{artifact?.description || ""}</div>
                        <div className="inventory-item-footer">
                          {isEquipped ? "Equipped" : "Tap to equip"}
                        </div>
                      </button>
                    );
                  })}
                  {(inventory?.items || []).length === 0 && (
                    <div>No artifacts owned yet.</div>
                  )}
                </div>
              </div>
            )}
            <button className="primary" onClick={() => { playSfx("modalClose"); setShowInventory(false); }}>
              Close
            </button>
          </div>
        </div>
      )}


      {showDailyChest && dailyChest && (
        <div className="modal-backdrop" onClick={closeDailyChest}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>🎁 Daily Chest</h3>
            {!dailyChestClaimed && !dailyChestRewards && (
              <>
                <div className="daily-chest-streak">
                  {DAILY_CHEST_TIERS.map((tier, idx) => (
                    <div
                      key={tier.day}
                      className={`daily-day ${idx + 1 < dailyChest.streakDay ? "past" : ""} ${idx + 1 === dailyChest.streakDay ? "current" : ""}`}
                    >
                      <div className="daily-day-num">Day {tier.day}</div>
                      <div className="daily-day-reward">
                        {tier.coins > 0 && <span>{tier.coins} 🪙</span>}
                        {tier.pearls > 0 && <span>{tier.pearls} 🫧</span>}
                        {tier.shards > 0 && <span>{tier.shards} 💎</span>}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="hint" style={{ textAlign: "center" }}>
                  Streak Day {dailyChest.streakDay} — Claim your free chest!
                </div>
                <button className="primary big" onClick={onClaimDailyChest}>
                  Open Chest
                </button>
              </>
            )}
            {dailyChestRewards && (
              <>
                <div className="daily-chest-result">
                  <div className="chest-icon reward" />
                  <div className="rewards">
                    {dailyChestRewards.coins > 0 && <div>🪙 {dailyChestRewards.coins} Coins</div>}
                    {dailyChestRewards.pearls > 0 && <div>🫧 {dailyChestRewards.pearls} Pearls</div>}
                    {dailyChestRewards.shards > 0 && <div>💎 {dailyChestRewards.shards} Shards</div>}
                  </div>
                </div>
                <div className="hint" style={{ textAlign: "center" }}>
                  Come back tomorrow for Day {dailyChest.streakDay >= 7 ? 1 : dailyChest.streakDay + 1}!
                </div>
                <button className="primary" onClick={closeDailyChest}>
                  Collect
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {showStarterReveal && (
        <div className="modal-backdrop" onClick={() => { playSfx("modalClose"); setShowStarterReveal(false); }}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>Starter Heroes</h3>
            <div className="starter-heroes">
              {["shark", "whale", "shrimp"].map((hero) => (
                <div key={hero} className="starter-hero">
                  <img loading="lazy" src={`/assets/heroes/${hero}/${hero}_pose_base.avif`} alt={hero} />
                  <div className="starter-name">{hero}</div>
                </div>
              ))}
            </div>
            <button className="primary" onClick={onClaimOnboarding} disabled={loading}>
              Claim Heroes
            </button>
          </div>
        </div>
      )}
      {showConfetti && (
        <div className="confetti-layer">
          {Array.from({ length: 24 }).map((_, index) => (
            <span key={index} className={`confetti confetti-${index % 6}`} />
          ))}
        </div>
      )}
        </div>
    </div>
  );
}

function getWeatherImageUrl(weatherId: WeatherType) {
  switch (weatherId) {
    case "SunlitShallows":
      return encodeURI("/assets/weather/SUNLIT SHALLOWS.avif");
    case "CoralBloom":
      return encodeURI("/assets/weather/CORAL BLOOM.avif");
    case "AbyssalGlow":
      return encodeURI("/assets/weather/ABYSSAL GLOW.avif");
    case "DeepWater":
      return encodeURI("/assets/weather/DEEP WATER.avif");
    case "CrimsonTide":
      return encodeURI("/assets/weather/Crimson Tide.avif");
    case "MoonTide":
      return encodeURI("/assets/weather/MOON TIDE.avif");
    default:
      return encodeURI("/assets/weather/SUNLIT SHALLOWS.avif");
  }
}

function normalizeWalletAddress(raw?: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  // WalletConnect may return CAIP-10, e.g. "eip155:1:0xabc..."
  const parts = trimmed.split(":");
  const candidate = parts[parts.length - 1] || trimmed;
  return candidate.trim();
}
