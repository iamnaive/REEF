import { createAppKit } from "@reown/appkit";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";

type RequestArgs = { method: string; params?: unknown[] };

export type Eip1193Provider = {
  request: (args: RequestArgs) => Promise<unknown>;
};

type AppKitLike = {
  open: (options?: unknown) => Promise<unknown>;
  close?: () => void;
  getWalletProvider: () => unknown;
  getAccount?: () => { isConnected?: boolean } | undefined;
  subscribeAccount?: (cb: (state: { isConnected?: boolean }) => void) => () => void;
};

let appKit: AppKitLike | null = null;
let activeProvider: Eip1193Provider | null = null;
let wagmiAdapter: WagmiAdapter | null = null;

function getInjectedProvider(): Eip1193Provider | null {
  const ethereum = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
  return ethereum || null;
}

function buildMonadNetwork(options: {
  chainIdHex: string;
  chainName: string;
  rpcUrl?: string;
}) {
  const id = Number.parseInt(options.chainIdHex.replace(/^0x/i, ""), 16);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Invalid MONAD chain id.");
  }
  const rpc = options.rpcUrl || "https://rpc.monad.xyz";
  return {
    id,
    chainNamespace: "eip155" as const,
    caipNetworkId: `eip155:${id}`,
    name: options.chainName || "Monad Mainnet",
    nativeCurrency: {
      name: "Monad",
      symbol: "MON",
      decimals: 18
    },
    rpcUrls: {
      default: { http: [rpc] },
      public: { http: [rpc] }
    },
    blockExplorers: {
      default: { name: "Monad Explorer", url: "https://explorer.monad.xyz" }
    }
  };
}

async function waitForAppKitConnection(instance: AppKitLike, timeoutMs = 120000) {
  const current = instance.getAccount?.();
  if (current?.isConnected) return;

  await instance.open();

  await new Promise<void>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      off?.();
      reject(new Error("Wallet connection timeout."));
    }, timeoutMs);

    const off = instance.subscribeAccount?.((state) => {
      if (!state?.isConnected || done) return;
      done = true;
      clearTimeout(timer);
      off?.();
      resolve();
    });

    // Fallback for adapters that don't expose subscribeAccount.
    if (!off) {
      const poll = setInterval(() => {
        const next = instance.getAccount?.();
        if (!next?.isConnected || done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(poll);
        resolve();
      }, 300);
    }
  });
}

export async function getWalletProvider(options: {
  reownProjectId: string;
  chainIdHex: string;
  chainName: string;
  rpcUrl?: string;
}): Promise<Eip1193Provider> {
  if (activeProvider) return activeProvider;

  if (!options.reownProjectId) {
    const injected = getInjectedProvider();
    if (injected) {
      activeProvider = injected;
      return injected;
    }
    throw new Error("Set VITE_REOWN_PROJECT_ID to use Reown AppKit.");
  }

  if (!appKit) {
    const monadNetwork = buildMonadNetwork(options);
    wagmiAdapter = new WagmiAdapter({
      projectId: options.reownProjectId,
      networks: [monadNetwork]
    });
    appKit = createAppKit({
      projectId: options.reownProjectId,
      adapters: wagmiAdapter ? [wagmiAdapter] : [],
      networks: [monadNetwork],
      defaultNetwork: monadNetwork,
      defaultAccountTypes: {
        eip155: "eoa"
      },
      metadata: {
        name: "Sea Battle",
        description: "Sea Battle Wallet Login",
        url: window.location.origin,
        icons: [`${window.location.origin}/favicon.ico`]
      }
    }) as unknown as AppKitLike;
  }

  const wrappedProvider: Eip1193Provider = {
    request: async (args: RequestArgs) => {
      if (!appKit) throw new Error("Reown AppKit is not initialized.");
      await waitForAppKitConnection(appKit);
      const walletProvider = appKit.getWalletProvider() as Eip1193Provider | undefined;
      if (!walletProvider?.request) {
        throw new Error("Connected wallet provider is unavailable.");
      }
      return walletProvider.request(args);
    }
  };

  activeProvider = wrappedProvider;
  return wrappedProvider;
}

export function closeWalletModal() {
  appKit?.close?.();
}
