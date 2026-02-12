import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { ResourceProvider } from "./resources";

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
