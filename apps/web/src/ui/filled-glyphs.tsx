import type { ReactElement, ReactNode } from "react";

import { cn } from "../lib/utils";

// The filled set `designing-ui`'s lock names, on the outline set's 20 grid:
// solid shapes in the current text color, for the streak, the combo, a weak
// point and a milestone. Decorative, like the outlines.

type GlyphProps = Readonly<{ className?: string }>;

function FilledGlyph({
  className,
  children,
}: Readonly<{ className?: string | undefined; children: ReactNode }>): ReactElement {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
      data-glyph="filled"
      className={cn("size-5 shrink-0", className)}
    >
      {children}
    </svg>
  );
}

export function FlameGlyph({ className }: GlyphProps): ReactElement {
  return (
    <FilledGlyph className={className}>
      <path d="M10 2.5c.6 2.6 2.3 3.9 3.6 5.4 1.3 1.5 1.9 2.9 1.9 4.6a5.5 5.5 0 01-11 0c0-1.9.9-3.4 2.1-4.5.2 1.3.8 2.2 1.8 2.7C8.2 8 8.6 5 10 2.5z" />
    </FilledGlyph>
  );
}

export function BoltGlyph({ className }: GlyphProps): ReactElement {
  return (
    <FilledGlyph className={className}>
      <path d="M11.75 2.5L4.5 11.25H9l-.75 6.25 7.25-8.75H11z" />
    </FilledGlyph>
  );
}

export function TargetGlyph({ className }: GlyphProps): ReactElement {
  return (
    <FilledGlyph className={className}>
      <path
        fillRule="evenodd"
        stroke="none"
        d="M10 2.5a7.5 7.5 0 110 15 7.5 7.5 0 010-15zM10 5a5 5 0 100 10 5 5 0 000-10zM10 7.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z"
      />
    </FilledGlyph>
  );
}

export function StarGlyph({ className }: GlyphProps): ReactElement {
  return (
    <FilledGlyph className={className}>
      <path d="M10 3l2.17 4.61 5.06.64-3.71 3.49.95 5.01L10 14.3l-4.47 2.45.95-5.01-3.71-3.49 5.06-.64z" />
    </FilledGlyph>
  );
}
