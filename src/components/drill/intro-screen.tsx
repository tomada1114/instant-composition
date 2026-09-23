import { useTranslations } from "next-intl";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";

/** W2: how grading works and which keys do what, once, before the placement round. */
export function IntroScreen({
  first,
  count,
  onStart,
}: Readonly<{ first: boolean; count: number; onStart: () => void }>): ReactElement {
  const t = useTranslations("Drill.intro");
  const card = useTranslations("Drill.card");
  return (
    <main className="mx-auto box-content flex min-h-dvh max-w-column flex-col px-4 py-8">
      <div className="flex flex-1 flex-col justify-center gap-8">
        <div className="flex flex-col gap-2">
          <h1>{first ? t("titleFirst", { count }) : t("titleAgain", { count })}</h1>
          <p className="text-muted-foreground">{t("order")}</p>
          <p className="text-muted-foreground">{t("portion", { count })}</p>
        </div>
        <ol className="flex list-decimal flex-col gap-3 pl-5">
          <li>
            {t("say")}
            <span className="block text-muted-foreground">{t("sayNote")}</span>
          </li>
          <li>{t("flip")}</li>
          <li>{t("grade")}</li>
        </ol>
        <p
          aria-hidden
          className="hidden flex-wrap items-center gap-x-4 gap-y-2 text-caption text-muted-foreground pointer-fine:flex"
        >
          <span className="inline-flex items-center gap-2">
            <Chip variant="kbd">Space</Chip>
            {card("flip")}
          </span>
          <span className="inline-flex items-center gap-2">
            <Chip variant="kbd">→ J</Chip>
            {card("said")}
          </span>
          <span className="inline-flex items-center gap-2">
            <Chip variant="kbd">← F</Chip>
            {card("notSaid")}
          </span>
        </p>
      </div>
      <Button className="w-full" onClick={onStart}>
        {t("start")}
        <Chip variant="kbd" className="border-current text-current">
          Space
        </Chip>
      </Button>
    </main>
  );
}
