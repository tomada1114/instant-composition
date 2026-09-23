import type { Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

/**
 * The app is dark only, so the browser's own controls and toolbar match the
 * canvas — `--canvas` in `src/app/globals.css`. Declared here rather than in
 * the locale layout so the root-level not-found boundary carries it too.
 */
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0a0a0b",
};

/**
 * The root layout Next.js requires, with the global stylesheet but no shell.
 *
 * @remarks
 * `<html>` and `<body>` belong to `src/app/[locale]/layout.tsx`, which is the
 * first layout that knows the document's language. Next.js still requires a
 * layout at the root of the App Router tree, so this one passes its children
 * through untouched rather than rendering a second, language-less document
 * shell around them. Importing the stylesheet here makes it available to the
 * root-level not-found boundary too.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactNode {
  return children;
}
