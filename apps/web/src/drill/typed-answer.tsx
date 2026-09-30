import { useTranslations } from "use-intl";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";

import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";

/** `packages/contracts`' `MAX_ANSWER_TEXT`: the API refuses a longer text. */
export const MAX_TYPED_LENGTH = 300;

/**
 * A typed front's field and the button that turns it over, in the timer's
 * place and the flip's. Enter in the field submits, except while an input
 * method is still composing: that Enter confirms the conversion. Safari sends
 * it after `compositionend` with `isComposing` false, so the Enter that follows
 * a composition is skipped until its key comes up. The field keeps its text
 * while the drill is paused, and takes focus whenever the card is showing.
 */
export function TypedAnswer({
  hidden,
  onSubmit,
}: Readonly<{ hidden: boolean; onSubmit: (text: string) => void }>): ReactElement {
  const t = useTranslations("Drill.card");
  const [text, setText] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const composed = useRef(false);

  useEffect(() => {
    if (!hidden) field.current?.focus();
  }, [hidden]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Enter") return;
    const confirming = event.nativeEvent.isComposing || composed.current;
    composed.current = false;
    event.preventDefault();
    if (!confirming) onSubmit(text);
  }

  return (
    <>
      <div className={cn("flex items-end", hidden && "invisible")}>
        <input
          ref={field}
          type="text"
          lang="en"
          value={text}
          maxLength={MAX_TYPED_LENGTH}
          aria-label={t("typed")}
          placeholder={t("typed")}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={onKeyDown}
          onCompositionEnd={() => {
            composed.current = true;
          }}
          onKeyUp={() => {
            composed.current = false;
          }}
          className="w-full border-b border-border bg-transparent py-3 font-latin text-alt text-foreground placeholder:text-muted-foreground"
        />
      </div>
      <Button
        variant="secondary"
        className="w-full"
        onClick={() => {
          onSubmit(text);
        }}
      >
        {t("submit")}
        <Kbd>Enter</Kbd>
      </Button>
    </>
  );
}

/** What the learner typed, over the model answer on a typed card's back. */
export function TypedText({ text }: Readonly<{ text: string }>): ReactElement {
  const t = useTranslations("Drill.card");
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-label text-muted-foreground">{t("yours")}</p>
      <p lang="en" className="font-latin text-alt break-words text-foreground">
        {text}
      </p>
    </div>
  );
}
