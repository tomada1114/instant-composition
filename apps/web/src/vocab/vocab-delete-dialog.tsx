import type { ReactElement } from "react";
import { useTranslations } from "use-intl";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";

/** V4 keeps its safe action focused, including while deletion is pending. */
export function VocabDeleteDialog({
  pending,
  onDelete,
  onKeep,
}: Readonly<{
  pending: boolean;
  onDelete: () => void;
  onKeep: () => void;
}>): ReactElement {
  const t = useTranslations("Vocab.delete");
  return (
    <Dialog titleId="vocab-delete-title">
      <div className="flex flex-col gap-2">
        <h2 id="vocab-delete-title" className="text-heading">
          {t("title")}
        </h2>
        <p className="text-caption text-muted-foreground">{t("caption")}</p>
      </div>
      <div className="grid grid-cols-2 gap-3" aria-busy={pending}>
        <Button
          variant="secondary"
          aria-disabled={pending || undefined}
          onClick={onDelete}
        >
          {t("confirm")}
        </Button>
        <Button data-autofocus aria-disabled={pending || undefined} onClick={onKeep}>
          {t("keep")}
        </Button>
      </div>
    </Dialog>
  );
}
