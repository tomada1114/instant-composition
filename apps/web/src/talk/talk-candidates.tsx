import type { ReactElement } from "react";
import { useTranslations } from "use-intl";
import { Button } from "../ui/button";
import { NoticeGlyph } from "../ui/glyphs";
import { SelectCard } from "../ui/select-card";
import type { TalkCards } from "./use-talk-cards";

/** W3h's secondary picker, inside the conversation after the end marker. */
export function TalkCandidates({
  cards,
}: Readonly<{ cards: TalkCards }>): ReactElement | null {
  const t = useTranslations("Talk.cards");
  const vocab = useTranslations("Vocab.categories");
  if (
    cards.status === "idle" ||
    (cards.status === "ready" && cards.candidates.length === 0)
  )
    return null;
  return (
    <li className="list-none">
      <section
        aria-labelledby="talk-cards-title"
        className="flex flex-col gap-4 rounded-panel border-2 border-border bg-card p-5"
      >
        <h2 id="talk-cards-title" className="text-heading">
          {t("title")}
        </h2>
        {cards.status === "waiting" ? (
          <p aria-hidden className="text-muted-foreground">
            …
          </p>
        ) : cards.status === "failed" ? (
          <>
            <p role="status" className="flex items-center gap-2 text-muted-foreground">
              <NoticeGlyph />
              {t("failed")}
            </p>
            <Button variant="secondary" onClick={cards.retry}>
              {t("retry")}
            </Button>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 min-[640px]:grid-cols-2">
              {cards.candidates.map((candidate) => (
                <SelectCard
                  key={candidate.index}
                  compact
                  latin
                  title={candidate.headword}
                  detail={`${vocab(candidate.category)} · ${candidate.meaning}`}
                  selected={candidate.added || cards.selected.includes(candidate.index)}
                  locked={candidate.added || cards.adding}
                  status={
                    candidate.added
                      ? t("added")
                      : candidate.inLearning
                        ? t("learning")
                        : undefined
                  }
                  onToggle={() => {
                    cards.toggle(candidate.index);
                  }}
                />
              ))}
            </div>
            {cards.addFailed ? (
              <p
                role="status"
                className="flex items-center gap-2 text-muted-foreground"
              >
                <NoticeGlyph />
                {t("addFailed")}
              </p>
            ) : null}
            <Button
              variant="secondary"
              disabled={cards.selected.length === 0 || cards.adding}
              onClick={cards.add}
            >
              {t("add")}
            </Button>
          </>
        )}
      </section>
    </li>
  );
}
