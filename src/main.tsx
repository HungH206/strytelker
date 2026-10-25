import React from "react";
import ReactDOM from "react-dom/client";

// Load each experience with its own global stylesheet.
const legacy = new URLSearchParams(window.location.search).has("lumi");
const { default: App } = legacy
  ? await import("./LumiWorld")
  : await import("./App");
if (legacy) await import("./App.css");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
