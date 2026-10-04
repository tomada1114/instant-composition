import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { Button } from "../ui/button";
import {
  CardStackGlyph,
  ChartGlyph,
  GearGlyph,
  HomeGlyph,
  TalkGlyph,
} from "../ui/glyphs";

const SECTIONS = [
  { to: "/", key: "home", Glyph: HomeGlyph },
  { to: "/vocab", key: "vocab", Glyph: CardStackGlyph },
  { to: "/talk", key: "talk", Glyph: TalkGlyph },
  { to: "/records", key: "records", Glyph: ChartGlyph },
  { to: "/settings", key: "settings", Glyph: GearGlyph },
] as const;

/**
 * `designing-ui`'s sidebar and top bar, as one `nav`: a sticky bar 56 tall
 * across the top below `pc`, the five sections' names shown from 768; from
 * `pc` a sidebar 240 wide fixed at the left, the brand above the sections.
 * The router marks the current section (`aria-current="page"`), matched on
 * the exact path so `/` is not current everywhere, and ignoring the query so
 * `/?utm_source=x` still is; the current pill wears the ink border. Without
 * `sections` it is the same bar with the brand alone, for a visitor who can
 * open none of them yet — a `header`, since it then links nowhere.
 */
export function ShellNav({
  sections = true,
}: Readonly<{ sections?: boolean }>): ReactElement {
  const t = useTranslations("Nav");
  const Bar = sections ? "nav" : "header";
  return (
    <Bar
      aria-label={sections ? t("label") : undefined}
      className="sticky top-0 z-10 flex h-14 items-center justify-between gap-1 border-b-2 border-border bg-card px-4 sm:px-6 pc:fixed pc:inset-y-0 pc:left-0 pc:h-auto pc:w-60 pc:flex-col pc:items-stretch pc:justify-start pc:gap-8 pc:border-r-2 pc:border-b-0 pc:px-4 pc:py-6"
    >
      <p className="min-w-0 font-display text-figure-sm pc:px-2">{t("brand")}</p>
      {sections ? (
        <ul className="flex shrink-0 gap-1 pc:flex-col">
          {SECTIONS.map(({ to, key, Glyph }) => (
            <li key={key}>
              <Link
                to={to}
                aria-label={t(key)}
                activeOptions={{ exact: true, includeSearch: false }}
                data-slot="nav-item"
                className="flex h-11 min-w-11 items-center justify-center gap-3 rounded-full border-2 border-transparent px-2 text-action text-muted-foreground hover:bg-raised data-[status=active]:border-foreground data-[status=active]:text-foreground pc:justify-start pc:px-4"
              >
                <Glyph />
                <span aria-hidden className="hidden min-[48rem]:inline">
                  {t(key)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </Bar>
  );
}

/**
 * The first focusable element of a shell page: hidden until it takes focus,
 * then a `secondary` button at 16, 16 that moves focus to `main`.
 */
export function SkipLink(): ReactElement {
  const t = useTranslations("Nav");
  return (
    <Button
      asChild
      variant="secondary"
      className="fixed top-4 left-4 z-30 not-focus:sr-only"
    >
      <a
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        {t("skip")}
      </a>
    </Button>
  );
}
