import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { ResourceProvider } from "./resources";

/* ── iOS Safari viewport height fix ──
 * On mobile Safari the toolbar slides in/out, making CSS `100vh` unreliable.
 * We compute the real visible height and expose it as a CSS custom property
 * that the rest of the CSS uses via `var(--app-height, 100dvh)`.
 */
function setAppHeight() {
  document.documentElement.style.setProperty("--app-height", `${window.innerHeight}px`);
}
setAppHeight();
window.addEventListener("resize", setAppHeight);
window.addEventListener("orientationchange", () => setTimeout(setAppHeight, 150));

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

if (isMobile() && !isStandalone()) {
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
  return text.includes("chrome-extension://") || text.includes("moz-extension://");
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
} catch (error) {
  const message = (error as { stack?: string; message?: string })?.stack || (error as Error)?.message || "Unknown startup error";
  renderFatal(`Startup error:\n${message}`);
}
