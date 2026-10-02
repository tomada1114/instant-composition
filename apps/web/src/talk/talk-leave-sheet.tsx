import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Sheet } from "../ui/sheet";

/**
 * W4, the leave sheet's recipe: what ending keeps — the turns so far, or
 * nothing — then 「終える」 and 「続ける」, which takes focus and Esc presses.
 */
export function TalkLeaveSheet({
  turns,
  onLeave,
  onStay,
}: Readonly<{ turns: number; onLeave: () => void; onStay: () => void }>): ReactElement {
  const t = useTranslations("Talk.leave");
  return (
    <Sheet titleId="talk-leave-title">
      <div className="flex flex-col gap-2">
        <h2 id="talk-leave-title" className="text-heading">
          {t("title")}
        </h2>
        <p className="font-mono text-mono-sm text-muted-foreground">
          {turns > 0 ? t("kept", { count: turns }) : t("lost")}
        </p>
      </div>
      <div className="flex flex-col gap-2.5">
        <Button variant="secondary" className="w-full" onClick={onLeave}>
          {t("end")}
        </Button>
        <Button className="w-full" data-autofocus onClick={onStay}>
          {t("stay")}
          <Kbd>Esc</Kbd>
        </Button>
      </div>
    </Sheet>
  );
}
