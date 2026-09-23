import { useTranslations } from "next-intl";
import type { ReactElement, ReactNode } from "react";

import type { HomeState } from "../../core/home-state";
import type { RoundKind } from "../../core/types";
import { TUNING } from "../../core/tuning";
import type { HomeView } from "../../core/views";
import { Button } from "@/components/ui/button";
import { PrimaryButton as Primary } from "@/components/ui/primary-button";

import { Link } from "../../i18n/navigation";

type Go = (kind: RoundKind) => void;

function Block({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  return <section className="flex flex-col gap-2">{children}</section>;
}

function Deadline(): ReactElement {
  const t = useTranslations("Home");
  return (
    <p className="text-caption text-muted-foreground">
      {t("deadline", { hour: TUNING.dayBoundaryHour })}
    </p>
  );
}

/** W3a: today's size, how it splits, and why it is short on a short day. */
export function ReadyPanel({
  view,
  go,
}: Readonly<{ view: HomeView; go: Go }>): ReactElement {
  const t = useTranslations("Home.today");
  const preview = view.preview;
  return (
    <>
      {preview === undefined ? null : (
        <Block>
          <h2>{t("title")}</h2>
          <p>
            {preview.shortage
              ? t("sizeShort", {
                  count: preview.size,
                  minutes: preview.minutes,
                  setting: preview.setting,
                })
              : t("size", { count: preview.size, minutes: preview.minutes })}
          </p>
          {preview.shortage ? (
            <p className="text-muted-foreground">
              {t("shortage", { count: preview.size })}
            </p>
          ) : null}
          <p className="text-muted-foreground">
            {preview.focusNames.length > 0
              ? t("mixFocus", {
                  review: preview.reviewCount,
                  fresh: preview.newCount,
                  focus: preview.focusNames.join("・"),
                })
              : t("mix", { review: preview.reviewCount, fresh: preview.newCount })}
          </p>
        </Block>
      )}
      <Primary
        onPress={() => {
          go("today");
        }}
      >
        {t("start")}
      </Primary>
    </>
  );
}

type Of<K extends HomeState["kind"]> = Extract<HomeState, { kind: K }>;

/** W3b: a portion stopped part way, resumed where it stopped. */
export function ProgressPanel({
  state,
  go,
}: Readonly<{ state: Of<"in-progress">; go: Go }>): ReactElement {
  const t = useTranslations("Home.progress");
  return (
    <>
      <Block>
        <h2>{state.portion === "today" ? t("today") : t("yesterday")}</h2>
        <p>{t("count", { done: state.progress, target: state.target })}</p>
      </Block>
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
      <Block>
        <h2>{t("title")}</h2>
        <p>{t("count", { rounds: view.todayRounds, cards: view.todayCards })}</p>
        <Link
          href="/recap"
          className="self-start py-2 text-muted-foreground underline underline-offset-4"
        >
          {t("recap")}
        </Link>
      </Block>
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
          <p>{t("restores", { days: state.restoresTo })}</p>
          <Deadline />
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
      <Block>
        <p className="text-muted-foreground">{t("hint")}</p>
        <p>
          {t("size", {
            yesterday: size,
            today: size,
            minutes: view.preview?.minutes ?? 0,
          })}
        </p>
        <Deadline />
      </Block>
      <div className="flex flex-col gap-3">
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
