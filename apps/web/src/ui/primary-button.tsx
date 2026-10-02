import type { ReactElement, ReactNode } from "react";

import { cn } from "../lib/utils";
import { Button } from "./button";
import { ArrowGlyph } from "./glyphs";
import { Kbd } from "./kbd";

/**
 * The one `action` button a screen carries, its label led on by an arrow.
 * `data-primary` is what `usePrimaryKey` presses on Space and Enter.
 */
export function PrimaryButton({
  onPress,
  className,
  children,
}: Readonly<{
  onPress: () => void;
  className?: string;
  children: ReactNode;
}>): ReactElement {
  return (
    <Button data-primary className={cn("w-full", className)} onClick={onPress}>
      {children}
      <ArrowGlyph className="size-4.5" />
      <Kbd>Space</Kbd>
    </Button>
  );
}
