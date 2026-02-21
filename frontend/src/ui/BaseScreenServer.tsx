import { useCallback, useEffect, useMemo, useState } from "react";
import { BUILDINGS, type BaseState, type BuildingDef, type BuildingType, type PlayerBuilding, type ResourceTotals } from "@shared/types";
import { buildOrUpgrade, collectBaseResources, fetchBase } from "../api";
import { assertNoForbiddenStorageKeysDev } from "../auth/storage";

type BaseScreenServerProps = {
  token: string | null;
  resources: ResourceTotals;
  onResourcesUpdate: (next: ResourceTotals) => void;
  onBack: () => void;
  onTrenches: () => void;
};

function getBuilding(base: BaseState | null, type: BuildingType): PlayerBuilding | null {
  if (!base) return null;
  return base.buildings.find((item) => item.buildingType === type) ?? null;
}

function getStorageHours(base: BaseState | null): number {
  const vault = getBuilding(base, "storage_vault");
  return 4 + (vault?.level ?? 0) * 2;
}

function getReadyAmount(base: BaseState | null, def: BuildingDef, nowMs: number): number {
  if (def.produces === "buff") return 0;
  const building = getBuilding(base, def.id);
  if (!building || building.level <= 0) return 0;
  const prodPerHour = def.productionPerHour[building.level - 1] ?? 0;
  const capHours = getStorageHours(base);
  const lastCollectedMs = new Date(building.lastCollectedAt).getTime();
  const elapsedHours = Math.max(0, (nowMs - lastCollectedMs) / 3_600_000);
  const effectiveHours = Math.min(capHours, elapsedHours);
  return prodPerHour * effectiveHours;
}

export function BaseScreenServer({ token, resources, onResourcesUpdate, onBack, onTrenches }: BaseScreenServerProps) {
  const [base, setBase] = useState<BaseState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyType, setBusyType] = useState<BuildingType | "collect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  const syncBase = useCallback(async () => {
    if (!token) {
      setBase(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextBase = await fetchBase(token);
      setBase(nextBase);
      assertNoForbiddenStorageKeysDev("base-sync");
    } catch (err) {
      setError((err as Error)?.message || "Failed to load base state from server.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void syncBase();
  }, [syncBase]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const onBuildOrUpgrade = async (buildingType: BuildingType) => {
    if (!token) return;
    setBusyType(buildingType);
    setError(null);
    try {
      const res = await buildOrUpgrade(token, buildingType);
      onResourcesUpdate(res.resources);
      const nextBase = await fetchBase(token);
      setBase(nextBase);
      assertNoForbiddenStorageKeysDev("base-build-upgrade");
    } catch (err) {
      setError((err as Error)?.message || "Build/upgrade failed.");
    } finally {
      setBusyType(null);
    }
  };

  const onCollect = async () => {
    if (!token) return;
    setBusyType("collect");
    setError(null);
    try {
      const res = await collectBaseResources(token);
      onResourcesUpdate(res.resources);
      const nextBase = await fetchBase(token);
      setBase(nextBase);
      assertNoForbiddenStorageKeysDev("base-collect");
    } catch (err) {
      setError((err as Error)?.message || "Collect failed.");
    } finally {
      setBusyType(null);
    }
  };

  const slotsLeft = useMemo(() => {
    if (!base) return 0;
    return Math.max(0, base.maxSlots - base.buildings.length);
  }, [base]);

  return (
    <div className="base-screen-root">
      <div className="bs-top-hud">
        <div className="hud-pills">
          <div className="hud-pill"><div className="hud-pill-label">Coins</div><div className="hud-pill-value">{resources.coins}</div></div>
          <div className="hud-pill"><div className="hud-pill-label">Pearls</div><div className="hud-pill-value">{resources.pearls}</div></div>
          <div className="hud-pill"><div className="hud-pill-label">Shards</div><div className="hud-pill-value">{resources.shards}</div></div>
          {base && <div className="hud-pill"><div className="hud-pill-label">Slots</div><div className="hud-pill-value">{base.buildings.length}/{base.maxSlots}</div></div>}
        </div>
        <div className="hud-actions">
          <button className="base-screen-back hud-btn" onClick={onTrenches}>Trenches</button>
          <button className="base-screen-back hud-btn" onClick={onBack}>Menu</button>
        </div>
      </div>

      <div className="screen" style={{ paddingTop: 96, justifyContent: "flex-start" }}>
        <div className="panel" style={{ width: "min(1100px, 95%)" }}>
          <h2 style={{ marginTop: 0 }}>Base (Server Sync)</h2>
          <div className="hint">All base progress is loaded/saved via server API.</div>
          {loading && <div className="hint">Loading base...</div>}
          {error && <div className="error-text">{error}</div>}
          {!token && <div className="error-text">Wallet login required.</div>}
          {base && (
            <>
              <div className="collect-msg">
                Free slots: {slotsLeft}. Collect resources to bank Shards/Pearls from buildings.
              </div>
              <div className="base-grid" style={{ marginTop: 14 }}>
                {BUILDINGS.map((def) => {
                  const building = getBuilding(base, def.id);
                  const level = building?.level ?? 0;
                  const nextLevel = level + 1;
                  const maxed = level >= def.maxLevel;
                  const canBuild = level > 0 || slotsLeft > 0;
                  const nextCost = def.costs[nextLevel - 1];
                  const ready = getReadyAmount(base, def, nowMs);
                  const isBusy = busyType === def.id;
                  return (
                    <div key={def.id} className={`base-card ${level > 0 ? "built" : ""}`}>
                      <div className="base-card-header">
                        <div className="base-name">{def.name}</div>
                        <div className="base-level">Lv {level}</div>
                      </div>
                      <div className="base-desc">{def.description}</div>
                      {def.produces !== "buff" && (
                        <div className="base-accum">
                          Ready: {ready.toFixed(2)} {def.produces}
                        </div>
                      )}
                      <div className="base-footer">
                        <div className="base-cost">
                          {maxed || !nextCost ? "Max level" : `Next: ${nextCost.coins} coins, ${nextCost.pearls} pearls`}
                        </div>
                        <button
                          className="primary small"
                          disabled={isBusy || maxed || !canBuild || busyType === "collect"}
                          onClick={() => {
                            void onBuildOrUpgrade(def.id);
                          }}
                        >
                          {isBusy ? "Saving..." : level === 0 ? "Build" : "Upgrade"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                <button className="primary" disabled={busyType !== null} onClick={() => { void onCollect(); }}>
                  {busyType === "collect" ? "Collecting..." : "Collect All"}
                </button>
                <button className="ghost-button" disabled={loading || busyType !== null} onClick={() => { void syncBase(); }}>
                  Refresh from Server
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
