import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { TUNING } from "../lib/tuning";
import type { HomeState, HomeView, RoundKind } from "../openapi";
import { Button } from "../ui/button";
import { ArrowGlyph, CheckGlyph } from "../ui/glyphs";
import { PrimaryButton as Primary } from "../ui/primary-button";

export type Go = (kind: RoundKind) => void;

function Deadline(): ReactElement {
  const t = useTranslations("Home");
  return (
    <p className="font-mono text-mono-sm text-muted-foreground">
      {t("deadline", { hour: TUNING.dayBoundaryHour })}
    </p>
  );
}

type Of<K extends HomeState["kind"]> = Extract<HomeState, { kind: K }>;

/** W3b: a portion stopped part way, resumed where it stopped. */
export function ProgressPanel({
  state,
  go,
}: Readonly<{ state: Of<"in-progress">; go: Go }>): ReactElement {
  const t = useTranslations("Home.progress");
  const share = state.target > 0 ? Math.min(1, state.progress / state.target) : 0;
  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <h2 className="text-label text-muted-foreground">
            {state.portion === "today" ? t("today") : t("yesterday")}
          </h2>
          <p className="font-display text-number-md">
            {t("count", { done: state.progress, target: state.target })}
          </p>
        </div>
        <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-foreground"
            style={{ width: `${String(share * 100)}%` }}
          />
        </div>
      </div>
      <Primary
        onPress={() => {
          go(state.resumeKind);
        }}
      >
        {t("resume")}
      </Primary>
    </>
  );
}

/** W3c: today is done; one more round, or yesterday while it can still be made up. */
export function DonePanel({
  state,
  view,
  go,
}: Readonly<{ state: Of<"done">; view: HomeView; go: Go }>): ReactElement {
  const t = useTranslations("Home.done");
  const more = t("more", { count: view.dailySize });
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-heading">
            <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <CheckGlyph className="size-4" />
            </span>
            {t("title")}
          </h2>
          <p className="font-mono text-mono-sm text-muted-foreground">
            {t("count", { rounds: view.todayRounds, cards: view.todayCards })}
          </p>
        </div>
        {view.todayLastRoundId === undefined ? null : (
          <Button asChild variant="text" className="-mr-3 -mt-2.5 gap-1">
            <Link to="/recap">
              {t("recap")}
              <ArrowGlyph className="size-4" />
            </Link>
          </Button>
        )}
      </div>
      {state.restoresTo === null ? (
        <Primary
          onPress={() => {
            go("extra");
          }}
        >
          {more}
        </Primary>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p>{t("restores", { days: state.restoresTo })}</p>
            <Deadline />
          </div>
          <Primary
            onPress={() => {
              go("yesterday");
            }}
          >
            {t("recover")}
          </Primary>
          <Button
            variant="secondary"
            onClick={() => {
              go("extra");
            }}
          >
            {more}
          </Button>
        </div>
      )}
    </>
  );
}

/** W3e: yesterday is open; both portions, or count again from today. */
export function RecoverPanel({
  view,
  go,
}: Readonly<{ view: HomeView; go: Go }>): ReactElement {
  const t = useTranslations("Home.recover");
  const size = view.preview?.size ?? 0;
  return (
    <>
      <div className="flex flex-col gap-2">
        <p>{t("hint")}</p>
        <p className="font-mono text-mono-sm text-muted-foreground">
          {t("size", {
            yesterday: size,
            today: size,
            minutes: view.preview?.minutes ?? 0,
          })}
        </p>
        <Deadline />
      </div>
      <div className="flex flex-col gap-1">
        <Primary
          onPress={() => {
            go("yesterday");
          }}
        >
          {t("start")}
        </Primary>
        <Button
          variant="text"
          onClick={() => {
            go("today");
          }}
        >
          {t("restart")}
        </Button>
      </div>
    </>
  );
}
