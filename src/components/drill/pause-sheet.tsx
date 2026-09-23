import { useTranslations } from "next-intl";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Sheet } from "@/components/ui/sheet";

/** The drill's keys, listed only once the learner has used one (`keys` variant). */
function KeyLegend(): ReactElement {
  const t = useTranslations("Drill.card");
  const rows = [
    ["Space", t("flip")],
    ["→  J", t("said")],
    ["←  F", t("notSaid")],
    ["Esc  ?", t("pause")],
  ] as const;
  return (
    <dl
      aria-hidden
      className="hidden grid-cols-[5rem_1fr] gap-x-4 gap-y-2 border-t border-border pt-5 text-caption text-muted-foreground keys:grid"
    >
      {rows.map(([key, label]) => (
        <div key={key} className="contents">
          <dt className="font-mono text-mono-sm whitespace-pre text-foreground">
            {key}
          </dt>
          <dd>{label}</dd>
        </div>
      ))}
    </dl>
  );
}

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
        <p className="font-mono text-mono-sm text-muted-foreground">
          {t("hint", { position })}
        </p>
      </div>
      <KeyLegend />
      <div className="flex flex-col gap-2.5">
        <Button variant="secondary" className="w-full" onClick={onQuit}>
          {t("quit")}
        </Button>
        <Button className="w-full" data-autofocus onClick={onContinue}>
          {t("continue")}
          <Kbd>Esc</Kbd>
        </Button>
      </div>
    </Sheet>
  );
}
