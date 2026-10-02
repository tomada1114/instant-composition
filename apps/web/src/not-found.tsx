import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { usePrimaryKey } from "./lib/use-primary-key";
import { Button } from "./ui/button";
import { Kbd } from "./ui/kbd";

/**
 * A path this client has no screen for: the `empty-state` panel, centred in
 * the window, with home as its one way out. No navigation: it is not a hub
 * screen, and it reads nothing, so it cannot know who is signed in.
 */
export function NotFound(): ReactElement {
  const t = useTranslations("NotFound");
  usePrimaryKey();

  return (
    <main className="mx-auto flex min-h-dvh max-w-dialog flex-col justify-center px-4 py-8">
      <section className="flex flex-col gap-5 rounded-card bg-card p-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-heading">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>
        <Button asChild variant="secondary">
          <Link to="/" data-primary>
            {t("homeLink")}
            <Kbd>Space</Kbd>
          </Link>
        </Button>
      </section>
    </main>
  );
}
