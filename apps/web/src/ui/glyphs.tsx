import type { ReactElement, ReactNode } from "react";

import { cn } from "../lib/utils";

// Glyphs drawn inline on a 20 grid, in the current text color, 1.75 strokes
// with round ends. Decorative: the control or line each sits in carries the
// words.

function Glyph({
  className,
  children,
}: Readonly<{ className?: string | undefined; children: ReactNode }>): ReactElement {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-5 shrink-0", className)}
    >
      {children}
    </svg>
  );
}

type GlyphProps = Readonly<{ className?: string }>;

export function CloseGlyph({ className }: GlyphProps): ReactElement {
  return (
    <Glyph className={className}>
      <path d="M5 5l10 10M15 5L5 15" />
    </Glyph>
  );
}

export function NoticeGlyph({ className }: GlyphProps): ReactElement {
  return (
    <Glyph className={className}>
      <circle cx="10" cy="10" r="7.5" strokeWidth="1.5" />
      <path d="M10 6.5v4" />
      <circle cx="10" cy="13.5" r="0.4" fill="currentColor" />
    </Glyph>
  );
}

/** A speaker, struck through when `off` so the state never rests on color. */
export function SpeakerGlyph({
  off,
  className,
}: Readonly<{ off: boolean; className?: string }>): ReactElement {
  return (
    <Glyph className={className}>
      <path d="M3.5 8v4h3l4 3V5l-4 3h-3z" />
      {off ? (
        <path d="M13.5 8l4 4M17.5 8l-4 4" />
      ) : (
        <path d="M13.5 7.5a3.5 3.5 0 010 5M15.75 5.25a6.5 6.5 0 010 9.5" />
      )}
    </Glyph>
  );
}

export function ChartGlyph({ className }: GlyphProps): ReactElement {
  return (
    <Glyph className={className}>
      <path d="M4.5 16V10M10 16V4M15.5 16v-4" strokeWidth="2" />
    </Glyph>
  );
}

export function GearGlyph({ className }: GlyphProps): ReactElement {
  return (
    <Glyph className={className}>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.75v2M10 15.25v2M2.75 10h2M15.25 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M4.9 15.1l1.4-1.4M13.7 6.3l1.4-1.4" />
    </Glyph>
  );
}

export function PauseGlyph({ className }: GlyphProps): ReactElement {
  return (
    <Glyph className={className}>
      <path d="M7 5v10M13 5v10" strokeWidth="2" />
    </Glyph>
  );
}

export function ArrowGlyph({ className }: GlyphProps): ReactElement {
  return (
    <Glyph className={className}>
      <path d="M4 10h11.5M11 5.5l4.5 4.5-4.5 4.5" strokeWidth="2" />
    </Glyph>
  );
}

export function BackGlyph({ className }: GlyphProps): ReactElement {
  return (
    <Glyph className={className}>
      <path d="M16 10H4.5M9 5.5L4.5 10 9 14.5" strokeWidth="2" />
    </Glyph>
  );
}

/** A chevron pointing down; turn it with a rotate class for a closed disclosure. */
export function ChevronGlyph({ className }: GlyphProps): ReactElement {
  return (
    <Glyph className={className}>
      <path d="M6 8l4 4 4-4" />
    </Glyph>
  );
}

export function CheckGlyph({ className }: GlyphProps): ReactElement {
  return (
    <Glyph className={className}>
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </Glyph>
  );
}

export function InfoGlyph({ className }: GlyphProps): ReactElement {
  return (
    <Glyph className={className}>
      <circle cx="10" cy="10" r="7.5" strokeWidth="1.5" />
      <path d="M10 9v4.5" />
      <circle cx="10" cy="6.5" r="0.4" fill="currentColor" />
    </Glyph>
  );
}

/** ○ — the said-it grade, drawn rather than typed so its weight matches ✕. */
export function RingGlyph({ className }: GlyphProps): ReactElement {
  return (
    <Glyph className={className}>
      <circle cx="10" cy="10" r="5.75" strokeWidth="2.25" />
    </Glyph>
  );
}

/** A loop: the card comes back for review. */
export function ReturnGlyph({ className }: GlyphProps): ReactElement {
  return (
    <Glyph className={className}>
      <path d="M15.5 9.5A5.5 5.5 0 105 13" />
      <path d="M15.75 5.5v4h-4" />
    </Glyph>
  );
}
