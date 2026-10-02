// The browser entry `index.html` loads: the fonts, the stylesheet, and the
// app mounted on `#root`. Kept to wiring, since only a browser runs it; what
// it mounts is tested through `App`.
import "@fontsource-variable/fredoka";
import "@fontsource-variable/nunito";
// Only the two weights the type scale sets; each is split into unicode-range
// subsets, so a page fetches just the ones its characters need.
import "@fontsource/m-plus-rounded-1c/500.css";
import "@fontsource/m-plus-rounded-1c/800.css";
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
