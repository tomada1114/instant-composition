import { useTranslations } from "use-intl";
import { useRef, useState, type ReactElement } from "react";

import { updateSettings } from "../lib/endpoints";
import { SpeakerGlyph } from "../ui/glyphs";
import { IconButton } from "../ui/icon-button";

/**
 * The speaker at the top: switches the sound effects, saved at once. Only the
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
    void updateSettings({ sound: next }).then((result) => {
      if (result.ok) saved.current = next;
      if (request === latest.current) setOn(result.ok ? next : saved.current);
    });
  }

  return (
    <IconButton
      type="button"
      aria-pressed={on}
      aria-label={on ? t("soundOn") : t("soundOff")}
      onClick={toggle}
    >
      <SpeakerGlyph off={!on} />
    </IconButton>
  );
}
