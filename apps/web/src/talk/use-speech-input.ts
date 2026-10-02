import { useEffect, useMemo, useRef, useState } from "react";

import { TUNING } from "../lib/tuning";
import { ANSWER_FIELD_MAX } from "../ui/answer-field";
import {
  appendHeard,
  heardText,
  recognitionConstructor,
  troubleOf,
  type Recognition,
  type SpeechTrouble,
} from "./speech-recognition";

interface Session {
  readonly recognition: Recognition;
  /** The field as it was at the press, which Esc puts back. */
  readonly before: string;
  value: string;
  heard: boolean;
  silence: ReturnType<typeof setTimeout> | undefined;
  noInput: ReturnType<typeof setTimeout> | undefined;
}

export interface SpeechInput {
  /** Whether this browser has speech recognition at all; without it there is no 「話す」. */
  readonly supported: boolean;
  /** From the press until the session ends: the field takes no typing. */
  readonly active: boolean;
  /** From the browser's `start` event: 「話す」 reads 「聞いています」. */
  readonly listening: boolean;
  readonly trouble: SpeechTrouble | undefined;
  /** What the polite region says: listening, or a cancel. */
  readonly notice: "listening" | "cancelled" | undefined;
  readonly start: () => void;
  /** Ends the session and sends what the field holds. */
  readonly finish: () => void;
  /** Ends the session and puts the field back. */
  readonly cancel: () => void;
  /** Ends the session and leaves what was heard in the field, unsent. */
  readonly stop: () => void;
}

interface Latest {
  lang: string;
  text: string;
  setText: (text: string) => void;
  onSend: (text: string) => void;
}

/**
 * One recognition session per press, in the step's language: interim text
 * fills the field, and 2 s with nothing new heard sends it as 「送る」 does.
 * While a session runs, Space and Enter send at once and Esc cancels, caught
 * before the talk's own Esc can open W4. `paused` (W4 open) stops it unsent.
 */
export function useSpeechInput(
  lang: string,
  text: string,
  setText: (text: string) => void,
  onSend: (text: string) => void,
  paused: boolean,
): SpeechInput {
  const latest = useRef<Latest>({ lang, text, setText, onSend });
  const session = useRef<Session | null>(null);
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [trouble, setTrouble] = useState<SpeechTrouble | undefined>();
  const [cancelled, setCancelled] = useState(false);
  const [supported] = useState(() => recognitionConstructor() !== undefined);

  useEffect(() => {
    latest.current = { lang, text, setText, onSend };
  });

  const control = useMemo(() => {
    function end(current: Session): void {
      clearTimeout(current.silence);
      clearTimeout(current.noInput);
      if (session.current !== current) return;
      session.current = null;
      const { recognition } = current;
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      setActive(false);
      setListening(false);
    }
    function send(current: Session): void {
      end(current);
      if (current.value.trim() !== "") latest.current.onSend(current.value);
    }
    function heard(current: Session, words: string): void {
      if (words === "") return;
      current.heard = true;
      clearTimeout(current.noInput);
      clearTimeout(current.silence);
      const value = appendHeard(current.before, words, latest.current.lang);
      current.value = value.slice(0, ANSWER_FIELD_MAX);
      latest.current.setText(current.value);
      if (value.length >= ANSWER_FIELD_MAX) {
        send(current);
        return;
      }
      current.silence = setTimeout(() => {
        send(current);
      }, TUNING.speechSilenceMs);
    }
    function start(): void {
      const Constructor = recognitionConstructor();
      if (session.current !== null || Constructor === undefined) return;
      const recognition = new Constructor();
      const before = latest.current.text;
      const current: Session = {
        recognition,
        before,
        value: before,
        heard: false,
        silence: undefined,
        noInput: undefined,
      };
      recognition.lang = latest.current.lang;
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.onstart = () => {
        setListening(true);
        current.noInput = setTimeout(() => {
          if (!current.heard) end(current);
        }, TUNING.speechNoInputMs);
      };
      recognition.onresult = (event) => {
        heard(current, heardText(event));
      };
      recognition.onerror = (event) => {
        const kind = troubleOf(event.error);
        if (kind !== undefined) setTrouble(kind);
        if (kind !== undefined || !current.heard) end(current);
      };
      recognition.onend = () => {
        if (current.heard) send(current);
        else end(current);
      };
      session.current = current;
      setTrouble(undefined);
      setCancelled(false);
      setActive(true);
      recognition.start();
    }
    function finish(): void {
      if (session.current !== null) send(session.current);
    }
    function cancel(): void {
      const current = session.current;
      if (current === null) return;
      end(current);
      latest.current.setText(current.before);
      setCancelled(true);
    }
    function stop(): void {
      if (session.current !== null) end(session.current);
    }
    return { start, finish, cancel, stop };
  }, []);

  useEffect(() => {
    if (paused) control.stop();
  }, [paused, control]);

  useEffect(() => control.stop, [control]);

  useEffect(() => {
    if (!active) return undefined;
    function onKey(event: KeyboardEvent): void {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.isComposing || event.key === "Process") return;
      if (event.key !== " " && event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") control.cancel();
      else control.finish();
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [active, control]);

  const notice = listening ? "listening" : cancelled ? "cancelled" : undefined;
  return { supported, active, listening, trouble, notice, ...control };
}
