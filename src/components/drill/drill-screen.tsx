"use client";

import { useEffect, useState, type ReactElement } from "react";

import type { RoundKind } from "../../core/types";
import type { RoundPayload } from "../../core/views";
import { requestRound, roundKindFrom, type ApiError } from "./api";
import { DrillError } from "./drill-error";
import { DrillSession } from "./drill-session";

type Loaded =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly error: ApiError }
  | { readonly status: "ready"; readonly round: RoundPayload };

/**
 * The `/drill` page's client side: it asks the server for the round `?kind=`
 * names — a
 * repeated ask resumes the same open round — and loads every card of it up
 * front, so nothing waits between cards.
 */
export function DrillScreen({
  first,
  sound,
  dailySize,
}: Readonly<{ first: boolean; sound: boolean; dailySize: number }>): ReactElement {
  const [kind, setKind] = useState<RoundKind>(() =>
    roundKindFrom(window.location.search),
  );
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
        // The page stays; only the round changes, so the address follows it.
        window.history.pushState(null, "", `?kind=${next}`);
        setKind(next);
        setAttempt((count) => count + 1);
      }}
    />
  );
}
