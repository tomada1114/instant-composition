import { useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { AnswerField } from "../ui/answer-field";
import { Button } from "../ui/button";
import { Eyebrow } from "../ui/eyebrow";
import { Kbd } from "../ui/kbd";
import { MutedLine, Primary, SpeakButton, SpeechLines } from "./step-parts";
import { hasJapanese } from "./talk-state";
import type { TalkActions } from "./use-talk";
import { useSpeechInput } from "./use-speech-input";

type StepProps<Sent> = Readonly<{ onSend: (text: Sent) => void; paused: boolean }>;

/** W3a: the Japanese, one thing and short; nothing is sent until the English goes with it. */
function JapaneseStep({ onSend, paused }: StepProps<string>): ReactElement {
  const t = useTranslations("Talk.step");
  const [text, setText] = useState("");
  const send = (value: string): void => {
    if (value.trim() !== "") onSend(value.trim());
  };
  const speech = useSpeechInput("ja-JP", text, setText, send, paused);
  const empty = text.trim() === "";
  return (
    <>
      <div className="flex flex-col gap-2">
        <AnswerField
          value={text}
          onChange={setText}
          onSend={() => {
            send(text);
          }}
          listening={speech.active}
          onEmptySpace={speech.supported ? speech.start : undefined}
          enterKeyHint="next"
          label={t("japanese")}
          placeholder={t("japaneseHint")}
        />
        <SpeechLines speech={speech} />
      </div>
      <div className={speech.supported ? "grid grid-cols-2 gap-2.5" : "contents"}>
        {speech.supported ? <SpeakButton speech={speech} empty={text === ""} /> : null}
        <Primary
          onPress={
            speech.active
              ? speech.finish
              : () => {
                  send(text);
                }
          }
          disabled={empty && !speech.active}
        >
          {t("send")}
        </Primary>
      </div>
    </>
  );
}

/**
 * W3b: the English, or 「わからない」. English holding a Japanese character is
 * not sent, typed or heard: the field stays, with one grey line under it.
 */
function EnglishStep({ onSend, paused }: StepProps<string | null>): ReactElement {
  const t = useTranslations("Talk.step");
  const [text, setText] = useState("");
  const [refused, setRefused] = useState(false);
  const send = (value: string): void => {
    if (value.trim() === "") return;
    if (hasJapanese(value)) {
      setRefused(true);
      return;
    }
    onSend(value.trim());
  };
  const speech = useSpeechInput("en-US", text, setText, send, paused);
  const empty = text.trim() === "";
  return (
    <>
      <div className="flex flex-col gap-2">
        <AnswerField
          value={text}
          onChange={setText}
          onSend={() => {
            send(text);
          }}
          listening={speech.active}
          onEmptySpace={speech.supported ? speech.start : undefined}
          enterKeyHint="send"
          label={t("english")}
          placeholder={t("englishHint")}
        />
        {refused && hasJapanese(text) ? <MutedLine>{t("notEnglish")}</MutedLine> : null}
        <SpeechLines speech={speech} />
      </div>
      <div
        className={
          speech.supported ? "grid grid-cols-3 gap-2.5" : "grid grid-cols-2 gap-2.5"
        }
      >
        <Button
          variant="secondary"
          onClick={() => {
            speech.stop();
            onSend(null);
          }}
        >
          {t("giveUp")}
        </Button>
        {speech.supported ? <SpeakButton speech={speech} empty={text === ""} /> : null}
        <Button
          data-primary
          disabled={empty && !speech.active}
          onClick={
            speech.active
              ? speech.finish
              : () => {
                  send(text);
                }
          }
        >
          {t("send")}
          <Kbd>Enter</Kbd>
        </Button>
      </div>
    </>
  );
}

/**
 * W3a or W3b under its step's eyebrow, the field taking focus as the step
 * begins. `paused` is W4 being open, which stops a voice session unsent.
 */
export function FieldStep({
  step,
  actions,
  paused,
}: Readonly<{
  step: "japanese" | "english";
  actions: TalkActions;
  paused: boolean;
}>): ReactElement {
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
        <JapaneseStep onSend={actions.japanese} paused={paused} />
      ) : (
        <EnglishStep onSend={actions.english} paused={paused} />
      )}
    </div>
  );
}
