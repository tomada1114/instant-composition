import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "../lib/utils";

// Copied from the shadcn/ui registry (`new-york` style), then restyled to
// `designing-ui`'s button recipe. Against the registry copy: `Slot` comes from
// `@radix-ui/react-slot` rather than the `radix-ui` umbrella, `cn` from this
// repository's `apps/web/src/lib/utils.ts`, the props are an `interface`
// with an explicit return type, and the variants are the recipe's four —
// `primary` (the one `action` fill a screen may carry), `good` (○),
// `secondary` and `text`. The registry's `size` prop is gone: each variant has
// one height. The three filled variants stand on a 4px lip (`shadow-lip`,
// coloured per variant) and reserve its height below themselves; pressed, the
// face drops onto it. Focus is the global outline from
// `apps/web/src/globals.css`, so no ring is set here. `relative` is what a
// `Kbd` hint at the button's end is pinned against.
const LIP =
  "mb-1 h-13 text-action shadow-lip transition-[translate,box-shadow] duration-60 active:translate-y-1 active:shadow-none disabled:bg-raised disabled:text-disabled disabled:shadow-none";

const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2.5 rounded-control px-6 whitespace-nowrap disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: `${LIP} bg-action text-on-action shadow-action-lip hover:bg-action-hover`,
        good: `${LIP} bg-good text-on-good shadow-good-lip hover:bg-good-hover`,
        secondary: `${LIP} border-2 border-input bg-card text-foreground shadow-input hover:bg-raised`,
        text: "h-11 px-3 text-body text-muted-foreground hover:text-foreground active:text-foreground disabled:text-disabled",
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
