import { Link } from "@tanstack/react-router";
import { FocusStrip } from "../lib/frame";
import { IconButton } from "../ui/icon-button";
import { CloseGlyph } from "../ui/glyphs";
import type { ReactElement } from "react";
import { useTranslations } from "use-intl";
import { Button } from "../ui/button";

/** Waiting for data or acknowledgement never becomes a chunk-completion screen. */
export function VocabWaiting({
  failed,
  pending,
  onRetry,
}: Readonly<{ failed: boolean; pending?: number; onRetry: () => void }>): ReactElement {
  const drill = useTranslations("Drill");
  const vocab = useTranslations("Vocab");
  const nav = useTranslations("Nav");
  return (
    <>
      <FocusStrip
        close={
          <IconButton plain asChild>
            <Link to="/vocab" aria-label={nav("close")}>
              <CloseGlyph />
            </Link>
          </IconButton>
        }
      />
      {failed ? (
        <div className="flex flex-col gap-4">
          <p>
            {pending === undefined
              ? vocab("loadFailed")
              : drill("save.unsaved", { count: pending })}
          </p>
          <Button variant="secondary" onClick={onRetry}>
            {pending === undefined ? vocab("retryLoad") : drill("save.resend")}
          </Button>
        </div>
      ) : null}
    </>
  );
}
