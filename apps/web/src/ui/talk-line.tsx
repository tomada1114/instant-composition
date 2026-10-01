import type { ReactElement, ReactNode } from "react";

import { cn } from "../lib/utils";
import { Eyebrow } from "./eyebrow";

/**
 * `designing-ui`'s talk line: the speaker's eyebrow over what they said, with
 * no frame. Lines in a list are parted by a hairline; the current turn is
 * white and earlier ones drop to muted.
 */
export function TalkLine({
  speaker,
  current = false,
  className,
  children,
}: Readonly<{
  speaker: string;
  current?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}>): ReactElement {
  return (
    <li
      data-slot="talk-line"
      data-current={current ? "" : undefined}
      className={cn(
        "flex flex-col gap-1 border-border py-3 not-first:border-t",
        className,
      )}
    >
      <Eyebrow>{speaker}</Eyebrow>
      <p
        className={cn(
          "text-body break-words",
          current ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {children}
      </p>
    </li>
  );
}

/**
 * `designing-ui`'s waiting line: whoever speaks next, over a still 「…」 that a
 * screen reader skips. No spinner, no blink.
 */
export function WaitingLine({
  speaker,
  className,
}: Readonly<{ speaker: string; className?: string | undefined }>): ReactElement {
  return (
    <li
      data-slot="waiting-line"
      className={cn(
        "flex flex-col gap-1 border-border py-3 not-first:border-t",
        className,
      )}
    >
      <Eyebrow>{speaker}</Eyebrow>
      <p aria-hidden className="text-body text-muted-foreground">
        …
      </p>
    </li>
  );
}
