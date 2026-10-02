import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useTranslations } from "use-intl";

import { AnswerField } from "../ui/answer-field";
import { Button } from "../ui/button";
import { Eyebrow } from "../ui/eyebrow";
import { ArrowGlyph, NoticeGlyph } from "../ui/glyphs";
import { Kbd } from "../ui/kbd";
import { hasJapanese, type TalkStep } from "./talk-state";
import type { TalkActions } from "./use-talk";

/** The one `action` button of a step, which Enter presses from outside a field. */
function Primary({
  onPress,
  disabled = false,
  children,
}: Readonly<{
  onPress: () => void;
  disabled?: boolean;
  children: ReactNode;
}>): ReactElement {
  return (
    <Button data-primary className="w-full" disabled={disabled} onClick={onPress}>
      {children}
      <ArrowGlyph className="size-4.5" />
      <Kbd>Enter</Kbd>
    </Button>
  );
}

/** W3a: the Japanese, one thing and short; nothing is sent until the English goes with it. */
function JapaneseStep({
  onSend,
}: Readonly<{ onSend: (text: string) => void }>): ReactElement {
  const t = useTranslations("Talk.step");
  const [text, setText] = useState("");
  const empty = text.trim() === "";
  const send = (): void => {
    if (!empty) onSend(text.trim());
  };
  return (
    <>
      <AnswerField
        value={text}
        onChange={setText}
        onSend={send}
        label={t("japanese")}
        placeholder={t("japaneseHint")}
      />
      <Primary onPress={send} disabled={empty}>
        {t("send")}
      </Primary>
    </>
  );
}

/**
 * W3b: the English, or 「わからない」. English holding a Japanese character is
 * not sent: the field stays, with one grey line under it.
 */
function EnglishStep({
  onSend,
}: Readonly<{ onSend: (text: string | null) => void }>): ReactElement {
  const t = useTranslations("Talk.step");
  const [text, setText] = useState("");
  const [refused, setRefused] = useState(false);
  const empty = text.trim() === "";
  const send = (): void => {
    if (empty) return;
    if (hasJapanese(text)) {
      setRefused(true);
      return;
    }
    onSend(text.trim());
  };
  return (
    <>
      <div className="flex flex-col gap-2">
        <AnswerField
          value={text}
          onChange={setText}
          onSend={send}
          label={t("english")}
          placeholder={t("englishHint")}
        />
        {refused && hasJapanese(text) ? (
          <p className="flex items-center gap-2 text-label text-muted-foreground">
            <NoticeGlyph className="size-4" />
            {t("notEnglish")}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Button
          variant="secondary"
          onClick={() => {
            onSend(null);
          }}
        >
          {t("giveUp")}
        </Button>
        <Button data-primary disabled={empty} onClick={send}>
          {t("send")}
          <Kbd>Enter</Kbd>
        </Button>
      </div>
    </>
  );
}

/** W3a or W3b under its step's eyebrow, the field taking focus as the step begins. */
function FieldStep({
  step,
  actions,
}: Readonly<{ step: "japanese" | "english"; actions: TalkActions }>): ReactElement {
  const t = useTranslations("Talk.step");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector("textarea")?.focus();
  }, [step]);
  return (
    <div ref={box} className="flex flex-col gap-3">
      <h2>
        <Eyebrow>{step === "japanese" ? t("japanese") : t("english")}</Eyebrow>
      </h2>
      {step === "japanese" ? (
        <JapaneseStep onSend={actions.japanese} />
      ) : (
        <EnglishStep onSend={actions.english} />
      )}
    </div>
  );
}

/** The bottom panel: what this step asks for, and nothing pressable while a line is awaited. */
export function StepPanel({
  step,
  actions,
}: Readonly<{ step: TalkStep; actions: TalkActions }>): ReactElement | null {
  const t = useTranslations("Talk");
  switch (step) {
    case "japanese":
    case "english":
      return <FieldStep step={step} actions={actions} />;
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
