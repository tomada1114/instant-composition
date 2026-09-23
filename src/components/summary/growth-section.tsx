import { useTranslations } from "next-intl";
import { useId, useState, type ReactElement, type ReactNode } from "react";

import type { Growth, ReviewRow } from "../../core/growth";
import { Button } from "@/components/ui/button";

import type { Shown } from "./summary-parts";

const FOLDED = 3;

/** A list showing its first three rows, the rest opened in place by "see all". */
function Folded<T>({
  rows,
  render,
}: Readonly<{ rows: readonly T[]; render: (row: T) => ReactNode }>): ReactElement {
  const t = useTranslations("Summary");
  const [open, setOpen] = useState(false);
  const id = useId();
  const shown = open ? rows : rows.slice(0, FOLDED);
  return (
    <div className="flex flex-col">
      <ul id={id} className="flex flex-col border-t border-border">
        {shown.map((row, index) => (
          <li
            key={index}
            className="flex min-h-11 items-center gap-3 border-b border-border py-2"
          >
            {render(row)}
          </li>
        ))}
      </ul>
      {rows.length > FOLDED ? (
        <Button
          variant="text"
          className="-mr-3 self-end"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          {open ? t("collapse") : t("seeAll")}
        </Button>
      ) : null}
    </div>
  );
}

function Stat({
  value,
  label,
}: Readonly<{ value: number; label: string }>): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-display text-number-md text-accent">{value}</span>
      <span className="text-label">{label}</span>
    </div>
  );
}

/** What this round did better than the last time each card came up. */
export function GrowthSection({
  growth,
  shown,
}: Readonly<{ growth: Growth; shown: Shown }>): ReactElement {
  const t = useTranslations("Summary.growth");
  const id = useId();
  const grew = growth.faster + growth.fixed > 0;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="text-muted-foreground">
        {t("title")}
      </h2>
      {grew ? (
        <>
          <div className="flex gap-10">
            {growth.faster > 0 ? (
              <Stat value={shown("growth.faster", growth.faster)} label={t("faster")} />
            ) : null}
            {growth.fixed > 0 ? (
              <Stat value={shown("growth.fixed", growth.fixed)} label={t("fixed")} />
            ) : null}
          </div>
          <Folded
            rows={growth.rows}
            render={(row) => (
              <>
                <span className="flex-1 truncate">{row.ja}</span>
                <span className="shrink-0 font-mono text-mono-sm">
                  {row.kind === "faster"
                    ? t("delta", { seconds: row.deltaMs / 1000 })
                    : t("fixedRow")}
                </span>
              </>
            )}
          />
        </>
      ) : growth.compared > 0 ? (
        <p className="text-muted-foreground">
          {t("compared", { count: growth.compared })}
        </p>
      ) : null}
      {growth.firstTime > 0 ? (
        <p className="text-muted-foreground">
          {t("firstTime", { count: growth.firstTime })}
        </p>
      ) : null}
    </section>
  );
}

/** The misses, which come back for review; only their count and prompts, no rate. */
export function ReviewSection({
  rows,
  shown,
}: Readonly<{ rows: readonly ReviewRow[]; shown: Shown }>): ReactElement {
  const t = useTranslations("Summary.review");
  const id = useId();
  if (rows.length === 0) {
    return (
      <section>
        <p className="text-muted-foreground">{t("none")}</p>
      </section>
    );
  }
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={id} className="text-muted-foreground">
          {t("title")}
        </h2>
        <span className="font-display text-figure-sm">
          {shown("review", rows.length)}
        </span>
      </div>
      <Folded
        rows={rows}
        render={(row) => <span className="flex-1 truncate">{row.ja}</span>}
      />
    </section>
  );
}
