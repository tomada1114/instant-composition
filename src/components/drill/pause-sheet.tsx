import { useTranslations } from "next-intl";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Sheet } from "@/components/ui/sheet";

/** W8: stop here or go on; focus waits on "continue", which Escape also presses. */
export function PauseSheet({
  position,
  onQuit,
  onContinue,
}: Readonly<{
  position: number;
  onQuit: () => void;
  onContinue: () => void;
}>): ReactElement {
  const t = useTranslations("Drill.sheet");
  return (
    <Sheet titleId="pause-title">
      <div className="flex flex-col gap-2">
        <h2 id="pause-title" className="text-heading">
          {t("title")}
        </h2>
        <p className="text-muted-foreground">{t("hint", { position })}</p>
      </div>
      <div className="flex flex-col gap-3">
        <Button variant="secondary" className="w-full" onClick={onQuit}>
          {t("quit")}
        </Button>
        <Button className="w-full" data-autofocus onClick={onContinue}>
          {t("continue")}
          <Chip variant="kbd" className="border-current text-current">
            Esc
          </Chip>
        </Button>
      </div>
    </Sheet>
  );
}
