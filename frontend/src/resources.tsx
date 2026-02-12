import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ResourceTotals } from "@shared/types";

const STORAGE_KEY = "sea_battle_resources";

function safeStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage write failures in restricted mobile browsers/webviews.
  }
}

type ResourceContextValue = {
  resources: ResourceTotals;
  setResources: (value: ResourceTotals) => void;
  addResources: (delta: ResourceTotals) => void;
};

const ResourceContext = createContext<ResourceContextValue | null>(null);

export function ResourceProvider({ children }: { children: React.ReactNode }) {
  const [resources, setResourcesState] = useState<ResourceTotals>(() => {
    const raw = safeStorageGet(STORAGE_KEY);
    if (!raw) return { coins: 0, pearls: 0, shards: 0 };
    try {
      return JSON.parse(raw) as ResourceTotals;
    } catch {
      return { coins: 0, pearls: 0, shards: 0 };
    }
  });

  const setResources = useCallback((value: ResourceTotals) => {
    setResourcesState(value);
  }, []);

  const addResources = useCallback((delta: ResourceTotals) => {
    setResourcesState((prev) => ({
      coins: prev.coins + delta.coins,
      pearls: prev.pearls + delta.pearls,
      shards: prev.shards + delta.shards
    }));
  }, []);

  useEffect(() => {
    safeStorageSet(STORAGE_KEY, JSON.stringify(resources));
  }, [resources]);

  const value = useMemo(
    () => ({ resources, setResources, addResources }),
    [resources, setResources, addResources]
  );

  return <ResourceContext.Provider value={value}>{children}</ResourceContext.Provider>;
}

export function useResources() {
  const ctx = useContext(ResourceContext);
  if (!ctx) {
    throw new Error("ResourceProvider is missing");
  }
  return ctx;
}
