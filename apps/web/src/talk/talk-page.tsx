import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { TabBar } from "../lib/tab-bar";
import { useEscapeHome } from "../lib/use-escape-home";
import { Eyebrow } from "../ui/eyebrow";

/**
 * The `/talk` route's stand-in until the talk screen lands: the tab's name on
 * the canvas and the tab bar, so the 会話 tab never leads to a missing page.
 */
export function TalkPage(): ReactElement {
  const t = useTranslations("Nav");
  useEscapeHome();
  return (
    <>
      <main className="mx-auto box-content flex min-h-[calc(var(--column-height)-var(--tab-bar-space))] max-w-column flex-col px-4 pt-8 pb-(--tab-bar-space)">
        <h1>
          <Eyebrow>{t("talk")}</Eyebrow>
        </h1>
      </main>
      <TabBar />
    </>
  );
}
