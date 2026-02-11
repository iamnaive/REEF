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

function getInjectedProvider(): Eip1193Provider | null {
  const ethereum = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
  return ethereum || null;
}

export async function getWalletProvider(options: {
  reownProjectId: string;
  chainIdHex: string;
  chainName: string;
  rpcUrl?: string;
}): Promise<Eip1193Provider> {
  // Prefer Reown (WalletConnect) when projectId is provided to avoid
  // extension-specific injected provider issues (e.g., TronLink/EVM shims).
  const preferReown = Boolean(options.reownProjectId);

  if (!preferReown) {
    const injected = getInjectedProvider();
    if (injected) return injected;
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
    return wrappedProvider;
  } catch {
    // Fallback to injected provider only if WC init failed.
    wcInitPromise = null;
    wcProvider = null;
    wcConnected = false;
    const injected = getInjectedProvider();
    if (injected) return injected;
    throw new Error("Failed to initialize Reown provider.");
  }
}
