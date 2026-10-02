import type { ReactElement, ReactNode } from "react";
import { useTranslations } from "use-intl";

import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { ArrowGlyph, MicGlyph, NoticeGlyph } from "../ui/glyphs";
import { Kbd } from "../ui/kbd";
import type { SpeechTrouble } from "./speech-recognition";
import type { SpeechInput } from "./use-speech-input";

/** The one `action` button of a step, which Enter presses from outside a field. */
export function Primary({
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

/**
 * 「話す」: a `secondary` button with the mic glyph that starts a session, and
 * while one listens reads 「聞いています」 in its pressed look and sends. Its
 * Space hint shows while Space is what presses it: an empty field, or a
 * session.
 */
export function SpeakButton({
  speech,
  empty,
}: Readonly<{ speech: SpeechInput; empty: boolean }>): ReactElement {
  const t = useTranslations("Talk.step");
  return (
    <Button
      variant="secondary"
      data-listening={speech.listening ? "" : undefined}
      className={cn(
        "w-full",
        speech.listening && "translate-y-1 bg-raised shadow-none hover:bg-raised",
      )}
      onClick={speech.active ? speech.finish : speech.start}
    >
      <MicGlyph className="size-4.5" />
      {speech.listening ? t("listening") : t("speak")}
      {empty || speech.active ? <Kbd>Space</Kbd> : null}
    </Button>
  );
}

const TROUBLE = {
  refused: "micRefused",
  missing: "micMissing",
  failed: "speechFailed",
} as const satisfies Record<SpeechTrouble, string>;

/** One muted line with the notice glyph under the field: never red, typing still works. */
export function MutedLine({
  children,
  status = false,
}: Readonly<{ children: ReactNode; status?: boolean }>): ReactElement {
  return (
    <p
      role={status ? "status" : undefined}
      className="flex items-center gap-2 text-label text-muted-foreground"
    >
      <NoticeGlyph className="size-4" />
      {children}
    </p>
  );
}

/** The voice input's error line, and what the polite region says as a session listens or is cancelled. */
export function SpeechLines({
  speech,
}: Readonly<{ speech: SpeechInput }>): ReactElement | null {
  const t = useTranslations("Talk.step");
  if (!speech.supported) return null;
  return (
    <>
      {speech.trouble === undefined ? null : (
        <MutedLine status>{t(TROUBLE[speech.trouble])}</MutedLine>
      )}
      <p role="status" data-part="speech-notice" className="sr-only">
        {speech.notice === undefined ? "" : t(speech.notice)}
      </p>
    </>
  );
}
