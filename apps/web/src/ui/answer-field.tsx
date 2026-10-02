import { useRef, type KeyboardEvent, type ReactElement } from "react";

import { cn } from "../lib/utils";

/** The most characters a talk field takes; input stops there. */
export const ANSWER_FIELD_MAX = 300;

// Safari ends a composition before the keydown of the Enter that confirmed
// it, with `isComposing` already false; an Enter this soon after the end is
// taken to be that one.
const CONFIRMING_ENTER_MS = 100;

type AnswerFieldProps = Readonly<{
  value: string;
  onChange: (value: string) => void;
  /** Called on Enter, never on the Enter that confirms an input method's conversion. */
  onSend: () => void;
  /** The field's accessible name. */
  label: string;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}>;

/**
 * `designing-ui`'s `answer-field`: an underline and no border, growing from
 * one line, at most 300 characters. Enter sends instead of breaking the line.
 * Set at 16 (`text-alt`), since iOS Safari zooms the page into a smaller field.
 */
export function AnswerField({
  value,
  onChange,
  onSend,
  label,
  placeholder,
  disabled = false,
  className,
}: AnswerFieldProps): ReactElement {
  const composing = useRef(false);
  const endedAt = useRef(Number.NEGATIVE_INFINITY);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter") return;
    if (composing.current || event.nativeEvent.isComposing) return;
    if (event.timeStamp - endedAt.current < CONFIRMING_ENTER_MS) return;
    event.preventDefault();
    onSend();
  }

  return (
    <textarea
      data-slot="answer-field"
      aria-label={label}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      rows={1}
      maxLength={ANSWER_FIELD_MAX}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      autoComplete="off"
      onChange={(event) => {
        onChange(event.target.value);
      }}
      onKeyDown={onKeyDown}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        endedAt.current = event.timeStamp;
      }}
      className={cn(
        "field-sizing-content min-h-11 w-full resize-none rounded-none border-0 border-b border-border bg-transparent py-2 text-alt text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground disabled:text-muted-foreground",
        className,
      )}
    />
  );
}
