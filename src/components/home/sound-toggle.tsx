import { useTranslations } from "next-intl";
import { useState, type ReactElement } from "react";

import { saveSettings } from "@/components/lib/api";
import { NoteGlyph } from "@/components/ui/glyphs";

/** ♪ at the top left: switches the sound effects, saved at once; a failed save goes back. */
export function SoundToggle({ initial }: Readonly<{ initial: boolean }>): ReactElement {
  const t = useTranslations("Home");
  const [on, setOn] = useState(initial);

  function toggle(): void {
    const next = !on;
    setOn(next);
    void saveSettings({ sound: next }).then((saved) => {
      if (!saved.ok) setOn(!next);
    });
  }

  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? t("soundOn") : t("soundOff")}
      onClick={toggle}
      className="flex size-11 items-center justify-center rounded-full text-foreground active:bg-raised"
    >
      <NoteGlyph off={!on} />
    </button>
  );
}
