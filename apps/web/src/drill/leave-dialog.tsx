import { useTranslations } from "use-intl";
import type { ReactElement } from "react";

import { Button } from "../ui/button";
import { TUNING } from "../lib/tuning";
import { Kbd } from "../ui/kbd";
import { Dialog } from "../ui/dialog";

/**
 * The pause dialog's recipe, asked when a tab or Back would leave a round
 * under way: leave, as "stop" does, or go on; focus waits on "continue",
 * which Escape also presses.
 */
export function LeaveDialog({
  position,
  onLeave,
  onStay,
}: Readonly<{
  position: number;
  onLeave: () => void;
  onStay: () => void;
}>): ReactElement {
  const t = useTranslations("Drill");
  return (
    <Dialog titleId="leave-title">
      <div className="flex flex-col gap-2">
        <h2 id="leave-title" className="text-heading">
          {t("leave.title")}
        </h2>
        <p className="font-latin text-count text-muted-foreground">
          {t("dialog.hint", { hour: TUNING.dayBoundaryHour, position })}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" className="w-full" onClick={onLeave}>
          {t("leave.go")}
        </Button>
        <Button className="w-full" data-autofocus onClick={onStay}>
          {t("dialog.continue")}
          <Kbd>Esc</Kbd>
        </Button>
      </div>
    </Dialog>
  );
}
