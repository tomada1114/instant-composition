import type { ComponentProps, ReactElement } from "react";

import { cn } from "../lib/utils";

/** The small tracked mono label above a figure or a block: the instrument's legend. */
export function Eyebrow({ className, ...props }: ComponentProps<"span">): ReactElement {
  return (
    <span
      className={cn(
        "font-mono text-eyebrow text-muted-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}
