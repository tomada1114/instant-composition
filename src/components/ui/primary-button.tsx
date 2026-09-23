import type { ReactElement, ReactNode } from "react";

import { Button } from "./button";
import { Chip } from "./chip";

/**
 * The one accent button a screen carries. `data-primary` is what
 * `usePrimaryKey` presses on Space and Enter.
 */
export function PrimaryButton({
  onPress,
  children,
}: Readonly<{ onPress: () => void; children: ReactNode }>): ReactElement {
  return (
    <Button data-primary className="w-full" onClick={onPress}>
      {children}
      <Chip variant="kbd" className="border-current text-current">
        Space
      </Chip>
    </Button>
  );
}
