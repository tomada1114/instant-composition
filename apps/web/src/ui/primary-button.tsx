import type { ReactElement, ReactNode } from "react";

import { Button } from "./button";
import { ArrowGlyph } from "./glyphs";
import { Kbd } from "./kbd";

/**
 * The one accent button a screen carries, its label led on by an arrow.
 * `data-primary` is what `usePrimaryKey` presses on Space and Enter.
 */
export function PrimaryButton({
  onPress,
  children,
}: Readonly<{ onPress: () => void; children: ReactNode }>): ReactElement {
  return (
    <Button data-primary className="w-full" onClick={onPress}>
      {children}
      <ArrowGlyph className="size-4.5" />
      <Kbd>Space</Kbd>
    </Button>
  );
}
