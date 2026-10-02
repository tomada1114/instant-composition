// The few members of the Web Speech API's recognition object the talk uses.
// TypeScript's DOM lib carries the events but no `SpeechRecognition`
// interface, so they are declared here rather than through another package.

/** One alternative of one result: what was heard. */
interface RecognitionAlternative {
  readonly transcript: string;
}

/** The results so far, each a list of alternatives with the likeliest first. */
export interface RecognitionResultEvent {
  readonly results: ArrayLike<ArrayLike<RecognitionAlternative>>;
}

export interface RecognitionErrorEvent {
  readonly error: string;
}

export interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
}

type RecognitionConstructor = new () => Recognition;

interface SpeechWindow {
  readonly SpeechRecognition?: RecognitionConstructor;
  readonly webkitSpeechRecognition?: RecognitionConstructor;
}

// Chrome, Firefox and Edge on iOS expose the interface on WebKit, but a
// session there never starts: no permission prompt, an error at once.
const IOS_OTHER_BROWSER = /\b(?:CriOS|FxiOS|EdgiOS)\//u;

/**
 * The browser's recognition constructor, or `undefined` where it has none or
 * where it is an iOS browser other than Safari.
 */
export function recognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  if (IOS_OTHER_BROWSER.test(navigator.userAgent)) return undefined;
  const speech = window as unknown as SpeechWindow;
  return speech.SpeechRecognition ?? speech.webkitSpeechRecognition;
}

/**
 * Everything heard so far, interim results included, as one line. English
 * results are parted by one space, since a later one may not begin with one;
 * Japanese results join directly.
 */
export function heardText(event: RecognitionResultEvent, lang: string): string {
  const parts = Array.from(event.results, (result) => result[0]?.transcript ?? "");
  if (!lang.startsWith("en")) return parts.join("").trim();
  return parts.join(" ").replace(/\s+/gu, " ").trim();
}

/** Why a session could not listen, as the one muted line under the field names it. */
export type SpeechTrouble = "refused" | "missing" | "failed";

/**
 * The browser's error codes the learner is told about; `no-speech` and
 * `aborted` end a session quietly, and anything else is treated as
 * `no-speech`.
 */
export function troubleOf(error: string): SpeechTrouble | undefined {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "refused";
    case "audio-capture":
      return "missing";
    case "network":
      return "failed";
    default:
      return undefined;
  }
}

/** The field's text with what was heard appended: one space between in English, none in Japanese. */
export function appendHeard(before: string, heard: string, lang: string): string {
  if (before === "" || heard === "") return before + heard;
  const separator = lang.startsWith("en") && !/\s$/u.test(before) ? " " : "";
  return before + separator + heard;
}

// A touch-only device: its soft keyboard would cover the panel while the
// read-only field keeps focus, so a session takes the focus off the field.
const TOUCH_ONLY = "(pointer: coarse) and (hover: none)";

/** Closes the soft keyboard on a touch-only device by blurring the focused field. */
export function closeSoftKeyboard(): void {
  if (typeof matchMedia !== "function" || !matchMedia(TOUCH_ONLY).matches) return;
  const focused = document.activeElement;
  if (focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement) {
    focused.blur();
  }
}
