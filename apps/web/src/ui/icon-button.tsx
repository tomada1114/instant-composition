import { Slot } from "@radix-ui/react-slot";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "../lib/utils";

interface IconButtonProps extends ComponentProps<"button"> {
  /** Render the single child element (a link) with these classes instead of a `<button>`. */
  asChild?: boolean;
  /** `plain` drops the tile behind the glyph, for a control that sits in the drill's own chrome. */
  plain?: boolean;
}

/**
 * `icon-button`: a 44 square with a 20 glyph on a surface tile. The caller
 * gives it its accessible name.
 */
export function IconButton({
  asChild = false,
  plain = false,
  className,
  ...props
}: IconButtonProps): ReactElement {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="icon-button"
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-icon text-foreground active:bg-raised",
        plain ? "-ml-2.5" : "bg-card",
        className,
      )}
      {...props}
    />
  );
}
