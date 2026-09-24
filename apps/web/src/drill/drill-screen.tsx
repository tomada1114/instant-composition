import { useEffect, useState, type ReactElement } from "react";

import type { ApiError } from "../lib/endpoints";
import type { RoundKind, RoundPayload } from "../openapi";
import { DrillError } from "./drill-error";
import { DrillSession } from "./drill-session";
import { requestRound } from "./rounds";

type Loaded =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly error: ApiError }
  | { readonly status: "ready"; readonly round: RoundPayload };

/**
 * The `/drill` route's screen: it asks the API for a round of `kind` — a
 * repeated ask resumes the same open round — and loads every card of it up
 * front, so nothing waits between cards. "One more" and "to today" start the
 * next round here, and `onKind` keeps the address in step with it.
 */
export function DrillScreen({
  kind: initialKind,
  first,
  sound,
  dailySize,
  available,
  onKind,
}: Readonly<{
  kind: RoundKind;
  first: boolean;
  sound: boolean;
  dailySize: number;
  available: number | undefined;
  onKind: (kind: RoundKind) => void;
}>): ReactElement {
  const [kind, setKind] = useState(initialKind);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded & { readonly attempt?: number }>({
    status: "loading",
  });

  useEffect(() => {
    let current = true;
    void requestRound(kind).then((result) => {
      if (!current) return;
      setLoaded(
        result.ok
          ? { status: "ready", round: result.value, attempt }
          : { status: "failed", error: result.error, attempt },
      );
    });
    return () => {
      current = false;
    };
  }, [kind, attempt]);

  if (loaded.status === "loading" || loaded.attempt !== attempt) {
    return <main className="mx-auto box-content flex min-h-dvh max-w-column px-4" />;
  }
  if (loaded.status === "failed") {
    return (
      <DrillError
        error={loaded.error}
        available={available}
        onReload={() => {
          setAttempt((count) => count + 1);
        }}
      />
    );
  }
  return (
    <DrillSession
      key={loaded.round.id}
      round={loaded.round}
      first={first}
      sound={sound}
      dailySize={dailySize}
      onNext={(next) => {
        onKind(next);
        setKind(next);
        setAttempt((count) => count + 1);
      }}
    />
  );
}
