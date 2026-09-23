import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/components/lib/utils";

// `designing-ui`'s chip recipe: 28 tall, 12 across, a pill. `kbd` is a key
// hint for a pointer device only, and hidden from assistive technology — the
// control it sits in already carries the name.
const chipVariants = cva(
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 whitespace-nowrap",
  {
    variants: {
      variant: {
        review: "bg-raised text-label text-review",
        speed: "border-[1.5px] border-accent text-label text-accent",
        again: "bg-raised text-label text-muted-foreground",
        kbd: "hidden border border-border font-mono text-mono-sm text-muted-foreground pointer-fine:inline-flex",
      },
    },
  },
);

interface ChipProps
  extends ComponentProps<"span">, Required<VariantProps<typeof chipVariants>> {}

function Chip({ className, variant, ...props }: ChipProps): ReactElement {
  return (
    <span
      data-slot="chip"
      aria-hidden={variant === "kbd" ? true : undefined}
      className={cn(chipVariants({ variant, className }))}
      {...props}
    />
  );
}

export { Chip };
