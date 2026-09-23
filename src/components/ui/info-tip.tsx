"use client";

import { useId, useState, type ReactElement } from "react";

import { InfoGlyph } from "./glyphs";

/**
 * A definition folded behind ⓘ: the heading stays one word, and the sentence
 * that explains it opens in place for whoever asks.
 */
export function InfoTip({
  label,
  text,
}: Readonly<{ label: string; text: string }>): ReactElement {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="-my-3 flex size-11 items-center justify-center text-muted-foreground active:text-foreground aria-expanded:text-foreground"
      >
        <InfoGlyph className="size-4" />
      </button>
      <span
        id={id}
        hidden={!open}
        className="basis-full text-caption text-muted-foreground"
      >
        {text}
      </span>
    </>
  );
}
