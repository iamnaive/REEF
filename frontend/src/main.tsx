import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { ResourceProvider } from "./resources";
import { installStorageWriteGuardDev } from "./auth/storage";

/* ── iOS Safari viewport height fix ──
 * On mobile Safari the toolbar slides in/out, making CSS `100vh` unreliable.
 * We compute the real visible height and expose it as a CSS custom property
 * that the rest of the CSS uses via `var(--app-height, 100dvh)`.
 */
function setAppViewport() {
  const vv = window.visualViewport;
  const height = vv?.height ?? window.innerHeight;
  const width = vv?.width ?? window.innerWidth;
  document.documentElement.style.setProperty("--app-height", `${Math.round(height)}px`);
  document.documentElement.style.setProperty("--app-width", `${Math.round(width)}px`);
}
setAppViewport();
installStorageWriteGuardDev();
window.addEventListener("resize", setAppViewport);
window.addEventListener("orientationchange", () => setTimeout(setAppViewport, 150));
window.visualViewport?.addEventListener("resize", setAppViewport);
window.visualViewport?.addEventListener("scroll", setAppViewport);

function isIosSafariBrowser(): boolean {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isWebKit = /WebKit/i.test(ua);
  const isNotAltBrowser = !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser/i.test(ua);
  return isIOS && isWebKit && isNotAltBrowser;
}

if (isIosSafariBrowser() && !window.matchMedia("(display-mode: standalone)").matches) {
  document.documentElement.classList.add("ios-safari-browser");
}

/* ── Mobile fullscreen on first interaction ──
 * On mobile browsers we request native fullscreen so the address bar,
 * tabs, and other browser chrome are hidden. This only works inside a
 * user-gesture callback, so we listen for the first touch/click.
 * In standalone (PWA / home-screen) mode this is unnecessary.
 */
function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function tryFullscreen(): void {
  if (!isMobile() || isStandalone()) return;
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
    msRequestFullscreen?: () => void;
  };
  const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (rfs) {
    rfs.call(el).catch(() => {/* browser denied — not critical */});
  }
}

if (isMobile() && !isStandalone() && !isIosSafariBrowser()) {
  const once = (e: Event) => {
    // Don't hijack gestures on scrollable top HUD bar
    const target = e.target as HTMLElement | null;
    if (target?.closest(".top-resource-bar")) return;
    tryFullscreen();
    document.removeEventListener("click", once);
    document.removeEventListener("touchend", once);
  };
  // Use click/touchend instead of pointerdown to not steal scroll gestures
  document.addEventListener("click", once, { passive: true });
  document.addEventListener("touchend", once, { passive: true });
}

function renderFatal(message: string) {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `<div style="padding:16px;color:#fff;background:#0b1020;font-family:Arial,sans-serif;white-space:pre-wrap;">${message}</div>`;
}

function isExtensionNoise(input: unknown): boolean {
  const text =
    typeof input === "string"
      ? input
      : ((input as { stack?: string; message?: string } | undefined)?.stack ||
        (input as { message?: string } | undefined)?.message ||
        String(input || ""));
  if (text.includes("chrome-extension://") || text.includes("moz-extension://")) return true;
  // Phaser WebGL can emit transient framebuffer resize errors on some setups.
  // They should not hard-crash the whole React UI layer.
  if (text.includes("Framebuffer status: Incomplete Attachment")) return true;
  // Can happen during rapid React teardown/remount in dev; avoid replacing the whole app with fatal screen.
  if (text.includes("Failed to execute 'removeChild' on 'Node'")) return true;
  if (text.includes("NotFoundError: Failed to execute 'removeChild' on 'Node'")) return true;
  return false;
}

window.addEventListener("error", (event) => {
  const err = event?.error || event?.message || "Unknown runtime error";
  if (isExtensionNoise(err)) return;
  const message = (err as { stack?: string; message?: string })?.stack || String(err);
  renderFatal(`Runtime error:\n${message}`);
});

window.addEventListener("unhandledrejection", (event) => {
  if (isExtensionNoise(event.reason)) return;
  const reason = (event.reason as { stack?: string; message?: string } | undefined);
  const message = reason?.stack || reason?.message || String(event.reason || "Unknown promise rejection");
  renderFatal(`Unhandled promise rejection:\n${message}`);
});

try {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ResourceProvider>
        <App />
      </ResourceProvider>
    </React.StrictMode>
  );
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Service worker registration failure is non-fatal.
      });
    });
  }
} catch (error) {
  const message = (error as { stack?: string; message?: string })?.stack || (error as Error)?.message || "Unknown startup error";
  renderFatal(`Startup error:\n${message}`);
}
