import { Inter } from "next/font/google";

/**
 * Inter, the one web font: English answers and large numbers.
 *
 * @remarks
 * Japanese is left to the system's own fonts, which already cover it; this is
 * the only family fetched. It is exposed as `--font-inter` rather than applied
 * to the document, because `--font-latin` in `src/app/globals.css` reads it
 * and Japanese text keeps the system stack. Every layout that renders
 * `<html>` puts `inter.variable` on it. `next build` downloads the font, so a
 * build needs network access.
 */
export const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});
