import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { ChartGlyph, GearGlyph, HomeGlyph } from "../ui/glyphs";
import { cn } from "./utils";

const TABS = [
  { to: "/", key: "home", Glyph: HomeGlyph },
  { to: "/records", key: "records", Glyph: ChartGlyph },
  { to: "/settings", key: "settings", Glyph: GearGlyph },
] as const;

/**
 * `designing-ui`'s tab bar: home, records and settings along the bottom edge
 * of the column, the current one in white with a white mark on the hairline.
 * The router marks the current link (`aria-current="page"`), matched exactly
 * so `/` is not current everywhere. Render it after the screen's `main`, so a
 * sheet opened inside `main` paints over it.
 */
export function TabBar(): ReactElement {
  const t = useTranslations("Nav");
  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 bg-background pb-(--column-inset)"
    >
      <ul className="mx-auto box-content grid max-w-column grid-cols-3 px-4">
        {TABS.map(({ to, key, Glyph }) => (
          <li key={key} className="h-(--tab-bar-height) border-t border-border">
            <Link
              to={to}
              activeOptions={{ exact: true }}
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
