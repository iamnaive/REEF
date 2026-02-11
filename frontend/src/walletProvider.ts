import { EthereumProvider } from "@walletconnect/ethereum-provider";

type RequestArgs = { method: string; params?: unknown[] };

export type Eip1193Provider = {
  request: (args: RequestArgs) => Promise<unknown>;
};

type WalletConnectLikeProvider = Eip1193Provider & {
  connect?: () => Promise<unknown>;
  disconnect?: () => Promise<unknown>;
};

let wcProvider: Eip1193Provider | null = null;
let wcInitPromise: Promise<Eip1193Provider> | null = null;
let wcConnected = false;
let activeProvider: Eip1193Provider | null = null;
let injectedProvider: Eip1193Provider | null = null;

type InjectedCandidate = Eip1193Provider & {
  isMetaMask?: boolean;
  isRabby?: boolean;
  isCoinbaseWallet?: boolean;
  isBraveWallet?: boolean;
  isTrust?: boolean;
  isTokenPocket?: boolean;
  isTronLink?: boolean;
  providers?: InjectedCandidate[];
};

function scoreInjectedProvider(p: InjectedCandidate): number {
  // Filter out non-EVM shims that often break request flow.
  if (p.isTronLink) return -100;
  let score = 0;
  if (p.isMetaMask) score += 10;
  if (p.isRabby) score += 10;
  if (p.isCoinbaseWallet) score += 9;
  if (p.isBraveWallet) score += 8;
  if (p.isTrust) score += 7;
  if (p.isTokenPocket) score += 6;
  return score;
}

function getInjectedProvider(): Eip1193Provider | null {
  const ethereum = (window as Window & { ethereum?: InjectedCandidate }).ethereum;
  if (!ethereum) return null;
  const list = Array.isArray(ethereum.providers) && ethereum.providers.length > 0
    ? ethereum.providers
    : [ethereum];
  const sorted = [...list].sort((a, b) => scoreInjectedProvider(b) - scoreInjectedProvider(a));
  const winner = sorted.find((p) => scoreInjectedProvider(p) >= 0) || null;
  return winner;
}

export async function getWalletProvider(options: {
  reownProjectId: string;
  chainIdHex: string;
  chainName: string;
  rpcUrl?: string;
}): Promise<Eip1193Provider> {
  if (activeProvider) return activeProvider;

  // If Reown is configured, always prefer opening Reown UI first.
  if (!options.reownProjectId) {
    injectedProvider = injectedProvider || getInjectedProvider();
    if (injectedProvider) {
      activeProvider = injectedProvider;
      return activeProvider;
    }
    throw new Error("Set VITE_REOWN_PROJECT_ID or install an injected EVM wallet.");
  }

  if (wcProvider) return wcProvider;

  if (!wcInitPromise) {
    const chainId = Number.parseInt(options.chainIdHex.replace(/^0x/i, ""), 16);
    if (!Number.isFinite(chainId) || chainId <= 0) {
      throw new Error("Invalid MONAD chain id.");
    }
    wcInitPromise = EthereumProvider.init({
      projectId: options.reownProjectId,
      chains: [chainId],
      optionalChains: [chainId],
      showQrModal: true,
      rpcMap: options.rpcUrl ? { [chainId]: options.rpcUrl } : undefined,
      metadata: {
        name: "Sea Battle",
        description: "Sea Battle Wallet Login",
        url: window.location.origin,
        icons: [`${window.location.origin}/favicon.ico`]
      }
    }) as unknown as Promise<Eip1193Provider>;
  }

  try {
    const rawProvider = (await wcInitPromise) as WalletConnectLikeProvider;
    const wrappedProvider: Eip1193Provider = {
      request: async (args: RequestArgs) => {
        // WalletConnect provider requires explicit connect() before request().
        if (!wcConnected && typeof rawProvider.connect === "function") {
          await rawProvider.connect();
          wcConnected = true;
        }
        return rawProvider.request(args);
      }
    };
    wcProvider = wrappedProvider;
    activeProvider = wrappedProvider;
    return wrappedProvider;
  } catch {
    // If Reown is configured, do not silently fallback to injected providers.
    // This guarantees the Reown UI flow (installed wallets list + connectors).
    wcInitPromise = null;
    wcProvider = null;
    wcConnected = false;
    activeProvider = null;
    throw new Error("Failed to initialize Reown provider. Check VITE_REOWN_PROJECT_ID and Reown allowed domains.");
  }
}
