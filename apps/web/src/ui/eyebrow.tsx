import type { ComponentProps, ReactElement } from "react";

import { cn } from "../lib/utils";

/** The small uppercase Latin legend above a figure or a block. */
export function Eyebrow({ className, ...props }: ComponentProps<"span">): ReactElement {
  return (
    <span
      className={cn(
        "font-latin text-eyebrow text-muted-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}
