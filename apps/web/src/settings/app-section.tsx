import { useId, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { LOGOUT_URL } from "../lib/endpoints";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";
import { GradeKeysRow } from "./grade-keys-row";
import { TimeZoneRow } from "./time-zone-row";
import type { SettingsState } from "./use-settings";

/** The app's own rows: the sound, the drill's grade keys and the time zone. */
export function AppRows({
  state,
  onZoneFailedChange,
}: Readonly<{
  state: SettingsState;
  onZoneFailedChange: (failed: boolean) => void;
}>): ReactElement {
  const t = useTranslations("Settings");
  const soundId = useId();
  return (
    <>
      <div className="flex min-h-16 items-center justify-between gap-4">
        <h3 id={soundId}>{t("sound.title")}</h3>
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
    </>
  );
}

/** The account's one row: signing out, a top-level form post. */
export function SignOutRow(): ReactElement {
  const t = useTranslations("Settings.signOut");
  return (
    <form method="post" action={LOGOUT_URL} className="flex min-h-16 items-center">
      <Button type="submit" variant="secondary">
        {t("action")}
      </Button>
    </form>
  );
}
