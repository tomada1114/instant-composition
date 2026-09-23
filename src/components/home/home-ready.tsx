import { useTranslations } from "next-intl";
import type { ReactElement } from "react";

import type { HomePreview, HomeView } from "../../core/views";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PrimaryButton as Primary } from "@/components/ui/primary-button";

import type { Go } from "./home-panels";

/** Review against new as one split bar, with the counts beside a swatch each. */
function Mix({ preview }: Readonly<{ preview: HomePreview }>): ReactElement {
  const t = useTranslations("Home.today");
  const total = Math.max(1, preview.reviewCount + preview.newCount);
  return (
    <div className="flex flex-col gap-2.5">
      <div aria-hidden className="flex h-1.5 gap-0.5">
        {preview.reviewCount > 0 ? (
          <span
            className="rounded-full bg-foreground"
            style={{ width: `${String((preview.reviewCount / total) * 100)}%` }}
          />
        ) : null}
        {preview.newCount > 0 ? (
          <span className="flex-1 rounded-full bg-muted-foreground" />
        ) : null}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-foreground" />
          {t("review", { count: preview.reviewCount })}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-muted-foreground" />
          {t("fresh", { count: preview.newCount })}
        </span>
        {preview.focusNames.length > 0 ? (
          <span>{t("focus", { names: preview.focusNames.join("・") })}</span>
        ) : null}
      </p>
    </div>
  );
}

/** W3a: today's size as the panel's figure, how it splits, and why it is short on a short day. */
export function ReadyPanel({
  view,
  go,
}: Readonly<{ view: HomeView; go: Go }>): ReactElement {
  const t = useTranslations("Home.today");
  const preview = view.preview;
  return (
    <>
      {preview === undefined ? null : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <Eyebrow aria-hidden>{t("eyebrow")}</Eyebrow>
            <p className="flex items-baseline justify-between">
              <span className="flex items-baseline gap-1.5">
                <span className="font-display text-number-md">{preview.size}</span>
                <span className="text-label text-muted-foreground">{t("unit")}</span>
              </span>
              <span className="font-mono text-mono-sm text-muted-foreground">
                {t("minutes", { minutes: preview.minutes })}
              </span>
            </p>
          </div>
          <Mix preview={preview} />
          {preview.shortage ? (
            <p className="text-caption text-muted-foreground">
              {t("shortage", { count: preview.size })}
            </p>
          ) : null}
        </div>
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
