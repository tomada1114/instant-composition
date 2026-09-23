"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useState, type ReactElement } from "react";

import type { SettingsPageView } from "../../core/views";
import { BackHeader } from "@/components/lib/back-header";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Toggle } from "@/components/ui/toggle";

import { useRouter } from "../../i18n/navigation";
import { FocusSection, SizeSection, TopicsSection } from "./settings-sections";
import { useSettings } from "./use-settings";

/** W12: measuring again is confirmed first; Esc and "cancel" close it. */
function RetestSheet({
  onCancel,
  onConfirm,
}: Readonly<{ onCancel: () => void; onConfirm: () => void }>): ReactElement {
  const t = useTranslations("Settings.retest");
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);
  return (
    <Sheet titleId="retest-title">
      <div className="flex flex-col gap-2">
        <h2 id="retest-title" className="text-heading">
          {t("title")}
        </h2>
        <p className="text-muted-foreground">{t("body")}</p>
      </div>
      <div className="flex flex-col gap-2.5">
        <Button variant="secondary" className="w-full" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button data-autofocus className="w-full" onClick={onConfirm}>
          {t("confirm")}
        </Button>
      </div>
    </Sheet>
  );
}

/** W11: every change saves as it is made and says in one line what it does. */
export function SettingsScreen({
  page,
}: Readonly<{ page: SettingsPageView }>): ReactElement {
  const t = useTranslations("Settings");
  const records = useTranslations("Records");
  const router = useRouter();
  const state = useSettings(page.settings);
  const [asking, setAsking] = useState(false);
  const soundId = useId();

  return (
    <main className="mx-auto box-content flex max-w-column flex-col gap-10 px-4 pt-4 pb-10">
      <BackHeader title={t("title")} back={t("back")} escape={!asking} />
      {state.failed ? (
        <p role="alert" className="rounded-tile bg-raised px-4 py-3">
          {t("saveFailed")}
        </p>
      ) : null}
      <TopicsSection topics={page.topics} state={state} />
      <FocusSection topics={page.topics} state={state} />
      <SizeSection state={state} />
      <section className="flex flex-col border-y border-border">
        <div className="flex min-h-16 items-center justify-between gap-4">
          <h2 id={soundId}>{t("sound.title")}</h2>
          <Toggle
            labelledBy={soundId}
            on={state.settings.sound}
            onChange={(sound) => {
              state.save({ sound });
            }}
          />
        </div>
        <div className="flex min-h-16 items-center justify-between gap-4 border-t border-border">
          <h2 className="flex items-baseline gap-3">
            {t("difficulty.title")}
            <span className="font-mono text-mono-sm text-muted-foreground">
              {page.toeic === null
                ? records("notMeasured")
                : records("toeic", { toeic: page.toeic })}
            </span>
          </h2>
          <Button
            variant="text"
            className="-mr-3 text-foreground"
            onClick={() => {
              setAsking(true);
            }}
          >
            {t("difficulty.retest")}
          </Button>
        </div>
      </section>
      {asking ? (
        <RetestSheet
          onCancel={() => {
            setAsking(false);
          }}
          onConfirm={() => {
            router.push("/drill?kind=placement");
          }}
        />
      ) : null}
    </main>
  );
}
