export const STORAGE_TOKEN = "rr_token_v1";
export const STORAGE_ADDRESS = "rr_address_v1";

const ALLOWED_KEYS = new Set<string>([STORAGE_TOKEN, STORAGE_ADDRESS]);
const FORBIDDEN_PATTERN = /base|state|persist|reef|rr_base/i;
const FORBIDDEN_WRITE_PATTERN = /rr_|sea_|base|resource|mechanic|queue/i;
let writeGuardInstalled = false;

export function readStoredToken(): string | null {
  return localStorage.getItem(STORAGE_TOKEN);
}

export function readStoredAddress(): string | null {
  return localStorage.getItem(STORAGE_ADDRESS);
}

export function writeStoredAuth(token: string, address: string) {
  localStorage.setItem(STORAGE_TOKEN, token);
  localStorage.setItem(STORAGE_ADDRESS, address);
}

export function clearStoredAuth() {
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_ADDRESS);
}

export function assertNoForbiddenStorageKeysDev(context: string) {
  if (!import.meta.env.DEV) return;
  const offenders: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (ALLOWED_KEYS.has(key)) continue;
    if (FORBIDDEN_PATTERN.test(key) || key.startsWith("rr_") || key.startsWith("sea_")) {
      offenders.push(key);
    }
  }
  if (offenders.length > 0) {
    console.warn(`[storage-guard] ${context}: unexpected localStorage keys`, offenders, new Error().stack);
  }
}

export function installStorageWriteGuardDev() {
  if (!import.meta.env.DEV) return;
  if (writeGuardInstalled) return;
  writeGuardInstalled = true;
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function setItemGuarded(key: string, value: string) {
    if (!ALLOWED_KEYS.has(key) && FORBIDDEN_WRITE_PATTERN.test(key)) {
      console.warn("[storage-guard] write blocked-key pattern", { key, valuePreview: value?.slice(0, 120) }, new Error().stack);
    }
    return originalSetItem.call(this, key, value);
  };
}
