import { useId, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { LOGOUT_URL } from "../lib/endpoints";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";
import { GradeKeysRow } from "./grade-keys-row";
import { TimeZoneRow } from "./time-zone-row";
import type { SettingsState } from "./use-settings";

/**
 * The app's own rows between hairlines: the sound, the drill's grade keys,
 * the time zone and signing out.
 */
export function AppSection({
  state,
  onZoneFailedChange,
}: Readonly<{
  state: SettingsState;
  onZoneFailedChange: (failed: boolean) => void;
}>): ReactElement {
  const t = useTranslations("Settings");
  const soundId = useId();
  return (
    <div className="flex flex-col border-b border-border">
      <div className="flex min-h-16 items-center justify-between gap-4">
        <h2 id={soundId}>{t("sound.title")}</h2>
        <Toggle
          labelledBy={soundId}
          on={state.settings.sound}
          onChange={(sound) => {
            state.save({ sound });
          }}
        />
      </div>
      <GradeKeysRow state={state} />
      <TimeZoneRow onFailedChange={onZoneFailedChange} />
      <form
        method="post"
        action={LOGOUT_URL}
        className="flex min-h-16 items-center justify-between gap-4 border-t border-border"
      >
        <h2>{t("signOut.title")}</h2>
        <Button type="submit" variant="text" className="-mr-3 text-foreground">
          {t("signOut.action")}
        </Button>
      </form>
    </div>
  );
}
