import { Inter_Tight, JetBrains_Mono, Space_Grotesk } from "next/font/google";

/**
 * The three web fonts: Inter Tight for English answers, Space Grotesk for the
 * big figures, JetBrains Mono for the small tracked labels and counters.
 *
 * @remarks
 * Japanese is left to the system's own fonts, which already cover it. Each
 * family is exposed as a CSS variable rather than applied to the document,
 * because `--font-latin`, `--font-display` and `--font-mono` in
 * `src/app/globals.css` read them and Japanese text keeps the system stack.
 * Every layout that renders `<html>` puts `fontVariables` on it. `next build`
 * downloads the fonts, so a build needs network access.
 */
const interTight = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter-tight",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const fontVariables = [
  interTight.variable,
  spaceGrotesk.variable,
  jetbrainsMono.variable,
].join(" ");
