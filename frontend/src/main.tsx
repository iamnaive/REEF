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

window.addEventListener("error", (event) => {
  const message = event?.error?.stack || event?.message || "Unknown runtime error";
  renderFatal(`Runtime error:\n${message}`);
});

window.addEventListener("unhandledrejection", (event) => {
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
