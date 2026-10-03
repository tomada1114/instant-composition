import { useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { cn } from "../lib/utils";

/** The page's sections, in order; each is also its element's `id` and its `#` link. */
export const SECTIONS = ["cards", "vocab", "level", "app", "account"] as const;
export type Section = (typeof SECTIONS)[number];

// A section is current once its top has passed this far down the viewport:
// below the sticky top bar under `pc`, near the top from it.
const CURRENT_LINE_PX = 120;

function sectionOf(hash: string): Section | undefined {
  return SECTIONS.find((section) => `#${section}` === hash);
}

/** The section in view: the last whose top has passed the line, or the last at the page's foot. */
function sectionInView(): Section {
  const root = document.documentElement;
  if (window.innerHeight + window.scrollY >= root.scrollHeight - 2) return "account";
  let current: Section = "cards";
  for (const section of SECTIONS) {
    const top = document.getElementById(section)?.getBoundingClientRect().top;
    if (top !== undefined && top <= CURRENT_LINE_PX) current = section;
  }
  return current;
}

/**
 * The section the page is at: the address's `#section` when it opens —
 * scrolled to, since the page renders after its read — then whichever the
 * scrolling brings into view. A pressed link holds until the reader scrolls
 * by hand again, so a short last section can still be the current one.
 */
export function useCurrentSection(): readonly [Section, (section: Section) => void] {
  const [current, setCurrent] = useState<Section>(
    () => sectionOf(window.location.hash) ?? "cards",
  );
  const chosen = useRef(false);
  useEffect(() => {
    const addressed = sectionOf(window.location.hash);
    if (addressed !== undefined) {
      chosen.current = true;
      document.getElementById(addressed)?.scrollIntoView();
    }
    function onScroll(): void {
      if (!chosen.current) setCurrent(sectionInView());
    }
    function onHand(): void {
      chosen.current = false;
    }
    const hand = ["wheel", "touchmove", "keydown"] as const;
    window.addEventListener("scroll", onScroll, { passive: true });
    for (const type of hand) window.addEventListener(type, onHand, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      for (const type of hand) window.removeEventListener(type, onHand);
    };
  }, []);
  return [
    current,
    (section) => {
      chosen.current = true;
      setCurrent(section);
    },
  ];
}

/**
 * `section-list`: a link to each section, the one in view current. 200 wide
 * and sticky beside the rows from `pc`; a row of pills under the heading
 * below it.
 */
export function SectionList({
  current,
  onChoose,
}: Readonly<{ current: Section; onChoose: (section: Section) => void }>): ReactElement {
  const t = useTranslations("Settings");
  const names: Readonly<Record<Section, string>> = {
    cards: t("sections.cards"),
    vocab: t("sections.vocab"),
    level: t("difficulty.title"),
    app: t("sections.app"),
    account: t("signOut.title"),
  };
  return (
    <nav
      aria-label={t("sections.label")}
      className="pc:sticky pc:top-8 pc:w-50 pc:shrink-0"
    >
      <ul className="flex flex-wrap gap-1 pc:flex-col">
        {SECTIONS.map((section) => (
          <li key={section}>
            <a
              href={`#${section}`}
              aria-current={section === current ? "true" : undefined}
              onClick={() => {
                onChoose(section);
              }}
              className={cn(
                "flex h-11 items-center rounded-full border-2 px-4 text-action no-underline",
                section === current
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-raised",
              )}
            >
              {names[section]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
