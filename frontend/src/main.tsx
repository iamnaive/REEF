import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { ResourceProvider } from "./resources";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ResourceProvider>
      <App />
    </ResourceProvider>
  </React.StrictMode>
);
