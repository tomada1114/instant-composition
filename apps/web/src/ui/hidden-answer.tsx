import type { ReactElement } from "react";

import { cn } from "../lib/utils";

/**
 * `designing-ui`'s hidden model answer: one hairline-thick bar per word where
 * the answer stood, each as wide as its word, so its shape stays as a cue
 * while its words do not. `label` is all a screen reader hears.
 */
export function HiddenAnswer({
  answer,
  label,
  className,
}: Readonly<{
  answer: string;
  label: string;
  className?: string | undefined;
}>): ReactElement {
  const words = answer.split(/\s+/u).filter((word) => word !== "");
  return (
    <p
      data-slot="hidden-answer"
      className={cn("flex flex-wrap items-center gap-x-2 gap-y-4 py-2", className)}
    >
      <span className="sr-only">{label}</span>
      {words.map((word, index) => (
        <span
          // Words repeat, and the list never reorders.
          key={index}
          aria-hidden
          data-slot="hidden-word"
          className="h-0.5 rounded-full bg-muted-foreground"
          style={{ width: `${String(word.length)}ch` }}
        />
      ))}
    </p>
  );
}
