import { useEffect, useRef, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { playMotion } from "../drill/motion";
import { cn } from "../lib/utils";
import { Eyebrow } from "../ui/eyebrow";
import { NoticeGlyph, RingGlyph } from "../ui/glyphs";
import { TalkLine, WaitingLine } from "../ui/talk-line";
import { TeacherLine } from "./teacher-line";
import type { Talk, TalkTurn } from "./talk-state";

/** The learner's turn: their Japanese, muted, over their English, which a ○ lights. */
function YourLine({
  turn,
  current,
  lit,
}: Readonly<{ turn: TalkTurn; current: boolean; lit: boolean }>): ReactElement {
  const t = useTranslations("Talk.speaker");
  const fine = turn.judgment?.verdict === "fine";
  return (
    <TalkLine speaker={t("you")} current={current}>
      <span className="block text-muted-foreground">{turn.japanese}</span>
      {typeof turn.english === "string" ? (
        <span
          lang="en"
          data-part="your-english"
          className={cn(
            "flex items-center gap-2 font-latin transition-colors duration-160",
            lit && "text-accent",
          )}
        >
          {turn.english}
          {fine ? <RingGlyph className="size-4" /> : null}
        </span>
      ) : null}
    </TalkLine>
  );
}

/** W3g's row: the reply that did not arrive, said in grey with a glyph, never red. */
function MissingReply(): ReactElement {
  const t = useTranslations("Talk");
  return (
    <TalkLine speaker={t("speaker.partner")}>
      <span className="flex items-center gap-2">
        <NoticeGlyph className="size-4" />
        {t("reply.failed")}
      </span>
    </TalkLine>
  );
}

function TurnLines({
  turn,
  talk,
  current,
}: Readonly<{ turn: TalkTurn; talk: Talk; current: boolean }>): ReactElement {
  const t = useTranslations("Talk.speaker");
  const step = current ? talk.step : undefined;
  return (
    <>
      <TalkLine speaker={t("partner")} current={current}>
        <span lang="en" className="font-latin">
          {turn.partnerLine}
        </span>
      </TalkLine>
      {turn.japanese === undefined ? null : (
        <YourLine turn={turn} current={current} lit={step === "fine"} />
      )}
      {step === "teacher" ? <WaitingLine speaker={t("teacher")} /> : null}
      <TeacherLine turn={turn} hidden={step === "hidden"} current={current} />
      {step === "fine" || step === "partner" ? (
        <WaitingLine speaker={t("partner")} />
      ) : null}
      {step === "replyFailed" || step === "turnFailed" ? <MissingReply /> : null}
    </>
  );
}

/**
 * W3's conversation: the scene, then every turn in order, the current one in
 * white and earlier ones muted. It alone scrolls, carried to its bottom edge
 * when a line appears, and each new line fades in.
 */
export function Conversation({ talk }: Readonly<{ talk: Talk }>): ReactElement {
  const t = useTranslations("Talk");
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const count = useRef(0);
  const ended = talk.step === "ended";
  const last = talk.turns.at(-1);
  const closing = ended && last?.reply?.closing === true ? last.reply.line : undefined;

  useEffect(() => {
    const lines = list.current?.children.length ?? 0;
    if (lines > count.current)
      playMotion(list.current?.lastElementChild ?? null, "fade");
    count.current = lines;
    const element = scroller.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [talk]);

  return (
    <div ref={scroller} className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
      <section className="flex flex-col gap-1 border-b border-border pb-3">
        <Eyebrow>{t("speaker.scene")}</Eyebrow>
        <p className="text-point text-muted-foreground">{talk.scene.description}</p>
      </section>
      <ol ref={list}>
        {talk.turns.map((turn) => (
          <TurnLines
            key={turn.n}
            turn={turn}
            talk={talk}
            current={turn === last && closing === undefined}
          />
        ))}
        {closing === undefined ? null : (
          <TalkLine speaker={t("speaker.partner")} current>
            <span lang="en" className="font-latin">
              {closing}
            </span>
          </TalkLine>
        )}
        {ended ? (
          <li className="flex items-center gap-3 py-3">
            <span aria-hidden className="h-px flex-1 bg-border" />
            <Eyebrow>{t("end.mark")}</Eyebrow>
            <span aria-hidden className="h-px flex-1 bg-border" />
          </li>
        ) : null}
      </ol>
    </div>
  );
}
