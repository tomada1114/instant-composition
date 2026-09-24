import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "../lib/utils";

// Copied from the shadcn/ui registry (`new-york` style), then restyled to
// `designing-ui`'s button recipe. Against the registry copy: `Slot` comes from
// `@radix-ui/react-slot` rather than the `radix-ui` umbrella, `cn` from this
// repository's `apps/web/src/lib/utils.ts`, the props are an `interface`
// with an explicit return type, and the variants are the recipe's three —
// `primary` (the one accent fill a screen may carry), `secondary` and `text`.
// The registry's `size` prop is gone: each variant has one height. Focus is
// the global white outline from `apps/web/src/globals.css`, so no ring is set here.
// `relative` is what a `Kbd` hint at the button's end is pinned against.
const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2.5 rounded-control px-6 whitespace-nowrap disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "h-15 bg-accent text-action text-accent-foreground active:bg-accent-pressed disabled:bg-raised disabled:text-disabled",
        secondary:
          "h-15 bg-raised text-action text-foreground active:bg-border disabled:text-disabled",
        text: "h-11 px-3 text-body text-muted-foreground active:text-foreground disabled:text-disabled",
      },
    },
    defaultVariants: {
      variant: "primary",
    },
  },
);

interface ButtonProps
  extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  /** Render the single child element with the button's classes instead of a `<button>`. */
  asChild?: boolean;
}

function Button({
  className,
  variant,
  asChild = false,
  ...props
}: ButtonProps): ReactElement {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
