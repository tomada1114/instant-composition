import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import type { ReactElement } from "react";
import { VOCAB_QUERY } from "../lib/queries";
import { Button } from "../ui/button";
import { VocabMix } from "../vocab/vocab-mix";
import { Tile } from "./home-tile";
/** The vocabulary tile waits independently so its failures never block home. */
export function VocabTile(): ReactElement {
  const t = useTranslations("Vocab");
  const home = useTranslations("Home.tiles");
  const hub = useQuery({ ...VOCAB_QUERY, refetchOnMount: "always" });
  const view = hub.isFetchedAfterMount ? hub.data : undefined;
  const ready =
    view !== undefined && !view.empty && view.today.due + view.today.new > 0;
  return (
    <Tile
      title={t("title")}
      foot={
        view === undefined || view.empty ? null : ready ? (
          <Button asChild variant="secondary" className="w-full">
            <Link to="/vocab/study" search={{ kind: "today" }}>
              {t("homeStart")}
            </Link>
          </Button>
        ) : (
          <Button asChild variant="text">
            <Link to="/vocab">{t("open")}</Link>
          </Button>
        )
      }
    >
      {hub.isError ? (
        <p className="text-muted-foreground">{home("failed")}</p>
      ) : view === undefined ? null : view.empty ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : ready ? (
        <>
          <p className="font-display text-figure-sm">
            {t("size", {
              count: view.today.due + view.today.new,
              minutes: view.today.minutes,
            })}
          </p>
          <VocabMix today={view.today} />
        </>
      ) : (
        <>
          <p>{t("done")}</p>
          <p className="text-count text-muted-foreground">
            {t("tomorrow", { count: view.tomorrow })}
          </p>
        </>
      )}
    </Tile>
  );
}
