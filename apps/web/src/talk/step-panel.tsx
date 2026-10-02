import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { FieldStep } from "./field-step";
import { Primary } from "./step-parts";
import type { TalkStep } from "./talk-state";
import type { TalkActions } from "./use-talk";

/** The bottom panel: what this step asks for, and nothing pressable while a line is awaited. */
export function StepPanel({
  step,
  actions,
  paused,
}: Readonly<{
  step: TalkStep;
  actions: TalkActions;
  paused: boolean;
}>): ReactElement | null {
  const t = useTranslations("Talk");
  switch (step) {
    case "japanese":
    case "english":
      return <FieldStep step={step} actions={actions} paused={paused} />;
    case "model":
      return <Primary onPress={actions.hide}>{t("teacher.hide")}</Primary>;
    case "hidden":
      return (
        <div className="grid grid-cols-2 gap-2.5">
          <Button variant="secondary" onClick={actions.lookAgain}>
            {t("teacher.lookAgain")}
          </Button>
          <Button data-primary onClick={actions.said}>
            {t("teacher.said")}
            <Kbd>Enter</Kbd>
          </Button>
        </div>
      );
    case "replyFailed":
    case "turnFailed":
      return (
        <Button variant="secondary" className="w-full" onClick={actions.retry}>
          {t("reply.retry")}
        </Button>
      );
    case "ended":
      return <Primary onPress={actions.start}>{t("end.again")}</Primary>;
    default:
      return null;
  }
}
