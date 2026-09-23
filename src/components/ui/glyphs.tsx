import type { ReactElement } from "react";

// Glyphs drawn inline, 20 square, in the current text color. Decorative: the
// control or line each sits in carries the words.

export function CloseGlyph(): ReactElement {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none">
      <path
        d="M5 5l10 10M15 5L5 15"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function NoticeGlyph(): ReactElement {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-5 shrink-0" fill="none">
      <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 5.5v5.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="10" cy="14" r="1" fill="currentColor" />
    </svg>
  );
}

/** ♪, struck through when `off` so the state never rests on color. */
export function NoteGlyph({ off }: Readonly<{ off: boolean }>): ReactElement {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none">
      <path
        d="M8 15V4.5l8-1.5V13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="15" r="2" fill="currentColor" />
      <circle cx="14" cy="13" r="2" fill="currentColor" />
      {off ? (
        <path
          d="M3 3l14 14"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

export function CheckGlyph(): ReactElement {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none">
      <path
        d="M4.5 10.5l3.5 3.5 7.5-8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
