// The browser entry `index.html` loads: the fonts, the stylesheet, and the
// app mounted on `#root`. Kept to wiring, since only a browser runs it; what
// it mounts is tested through `App`.
import "@fontsource-variable/inter-tight";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/space-grotesk";
import "./globals.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root to mount the app on.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
