import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { ChartGlyph, GearGlyph, HomeGlyph, TalkGlyph } from "../ui/glyphs";
import { cn } from "./utils";

const TABS = [
  { to: "/", key: "home", Glyph: HomeGlyph },
  { to: "/talk", key: "talk", Glyph: TalkGlyph },
  { to: "/records", key: "records", Glyph: ChartGlyph },
  { to: "/settings", key: "settings", Glyph: GearGlyph },
] as const;

/**
 * `designing-ui`'s tab bar: home, talk, records and settings along the bottom edge
 * of the column, the current one in white with a white mark on the hairline.
 * The router marks the current link (`aria-current="page"`), matched on the
 * exact path so `/` is not current everywhere, and ignoring the query so
 * `/?utm_source=x` still is. Render it after the screen's `main`, so a
 * sheet opened inside `main` paints over it.
 */
export function TabBar(): ReactElement {
  const t = useTranslations("Nav");
  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 bg-background pb-[max(var(--column-inset),env(safe-area-inset-bottom))]"
    >
      <ul className="mx-auto box-content grid max-w-column grid-cols-4 px-4">
        {TABS.map(({ to, key, Glyph }) => (
          <li key={key} className="h-(--tab-bar-height) border-t border-border">
            <Link
              to={to}
              activeOptions={{ exact: true, includeSearch: false }}
              data-slot="tab"
              className="relative flex h-full flex-col items-center justify-center gap-1 text-caption text-muted-foreground data-[status=active]:text-foreground"
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden
                    className={cn(
                      "absolute -top-px h-0.5 w-6 rounded-full bg-foreground",
                      !isActive && "hidden",
                    )}
                  />
                  <Glyph />
                  {t(key)}
                </>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
