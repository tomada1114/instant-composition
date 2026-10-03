import type { ReactElement } from "react";
import { useTranslations } from "use-intl";
import type { VocabCard } from "../openapi";
import { Button } from "../ui/button";
import { Eyebrow } from "../ui/eyebrow";
import { TalkGlyph } from "../ui/glyphs";

/** Personal origin is plain text; only an active back offers deletion, away from grades. */
export function VocabCardHeading({
  card,
  removable,
  onDelete,
}: Readonly<{
  card: VocabCard;
  removable: boolean;
  onDelete: () => void;
}>): ReactElement {
  const t = useTranslations("Vocab");
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Eyebrow className="flex flex-wrap items-center gap-2">
        {t(`categories.${card.category}`)}
        {card.personal ? (
          <span className="flex items-center gap-1">
            <TalkGlyph className="size-4" />
            {t("fromTalk")}
          </span>
        ) : null}
      </Eyebrow>
      {card.personal && removable ? (
        <Button variant="text" onClick={onDelete}>
          {t("delete.go")}
        </Button>
      ) : null}
    </div>
  );
}
