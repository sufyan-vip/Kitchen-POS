import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "app/app";

// Load the web manifest asynchronously after the page is interactive
// (kept as a module script so the production Content-Security-Policy can
// stay strict: script-src 'self').
function loadManifest(): void {
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = "/manifest.webmanifest";
  document.head.appendChild(link);
}
type IdleRequest = (callback: () => void, options?: { timeout: number }) => number;
const requestIdle = (window as unknown as { requestIdleCallback?: IdleRequest }).requestIdleCallback;
const scheduleManifestLoad = (): void => {
  if (requestIdle) { requestIdle(loadManifest, { timeout: 2000 }); } else { setTimeout(loadManifest, 100); }
};
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", scheduleManifestLoad);
} else {
  scheduleManifestLoad();
}

// Polyfills for modern web APIs used by Tooltips/Modals
if (!("popover" in HTMLElement.prototype)) {
  void import("@oddbird/popover-polyfill/fn").then(({ apply }) => {
    (apply as () => void)();
  });
}

if (!("interestTargetElement" in HTMLButtonElement.prototype)) {
  void import("interestfor");
}

if (!("anchorName" in document.documentElement.style)) {
  void import("@oddbird/css-anchor-positioning");
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error(
    "Root element not found. Ensure there is a <div id='root'> in your index.html.",
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
