import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { cn } from "../lib/utils";
import { Eyebrow } from "../ui/eyebrow";
import { HiddenAnswer } from "../ui/hidden-answer";
import type { TalkTurn } from "./talk-state";

/**
 * The teacher's words in the drill's back-self layout — the learner's own
 * English (absent on a give-up), the model answer, the point — or, once
 * hidden (W3f), 「声に出して」 over the learner's Japanese as a cue, the
 * model answer's hidden lines and the point.
 */
export function TeacherLine({
  turn,
  hidden,
  current,
}: Readonly<{
  turn: TalkTurn;
  hidden: boolean;
  current: boolean;
}>): ReactElement | null {
  const t = useTranslations("Talk");
  const judgment = turn.judgment;
  if (judgment?.verdict !== "corrected") return null;
  return (
    <li
      data-slot="teacher-line"
      className={cn(
        "flex flex-col gap-3 border-border py-3 not-first:border-t",
        current ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <Eyebrow>{t("speaker.teacher")}</Eyebrow>
      {hidden ? (
        <>
          <Eyebrow className="text-foreground">{t("teacher.aloud")}</Eyebrow>
          <p className="text-point text-muted-foreground">{turn.japanese}</p>
          <HiddenAnswer answer={judgment.modelAnswer} label={t("teacher.hidden")} />
        </>
      ) : (
        <>
          {typeof turn.english === "string" ? (
            <p data-part="your-english" className="text-point text-muted-foreground">
              <span className="mr-2 text-label">{t("speaker.you")}</span>
              <span lang="en" className="font-latin">
                {turn.english}
              </span>
            </p>
          ) : null}
          <p lang="en" className="font-latin text-answer">
            {judgment.modelAnswer}
          </p>
        </>
      )}
      <p className="text-point text-muted-foreground">
        <span className={cn("mr-2 text-label", current && "text-foreground")}>
          {t("teacher.point")}
        </span>
        {judgment.point}
      </p>
    </li>
  );
}
