import { useTranslations } from "next-intl";
import { useRef, useState, type ReactElement } from "react";

import { saveSettings } from "@/components/lib/api";
import { NoteGlyph } from "@/components/ui/glyphs";

/**
 * ♪ at the top left: switches the sound effects, saved at once. Only the
 * latest save's answer moves the switch, and a failure puts back what was
 * last saved, so answers arriving out of order cannot strand it.
 */
export function SoundToggle({ initial }: Readonly<{ initial: boolean }>): ReactElement {
  const t = useTranslations("Home");
  const [on, setOn] = useState(initial);
  const saved = useRef(initial);
  const latest = useRef(0);

  function toggle(): void {
    const next = !on;
    const request = ++latest.current;
    setOn(next);
    void saveSettings({ sound: next }).then((result) => {
      if (result.ok) saved.current = next;
      if (request === latest.current) setOn(result.ok ? next : saved.current);
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
