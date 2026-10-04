import { useId, useSyncExternalStore, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { LOGOUT_URL } from "../lib/endpoints";
import { signOut } from "../lib/api-call";
import { isTouchOnly, TOUCH_ONLY } from "../lib/touch";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";
import { GradeKeysRow } from "./grade-keys-row";
import { TimeZoneRow } from "./time-zone-row";
import type { SettingsState } from "./use-settings";

// A touch-only device: its software keyboard sends no key the grade keys
// could take, so the row would only wait forever.
function subscribeTouchOnly(onChange: () => void): () => void {
  if (typeof matchMedia !== "function") return () => undefined;
  const query = matchMedia(TOUCH_ONLY);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

/** The app's own rows: the sound, the drill's grade keys (not on a touch-only device) and the time zone. */
export function AppRows({
  state,
  onZoneFailedChange,
}: Readonly<{
  state: SettingsState;
  onZoneFailedChange: (failed: boolean) => void;
}>): ReactElement {
  const t = useTranslations("Settings");
  const soundId = useId();
  const touchOnly = useSyncExternalStore(subscribeTouchOnly, isTouchOnly);
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
      {touchOnly ? null : <GradeKeysRow state={state} />}
      <TimeZoneRow onFailedChange={onZoneFailedChange} />
    </>
  );
}

/** The account's one row: signing out, a top-level form post. */
export function SignOutRow(): ReactElement {
  const t = useTranslations("Settings.signOut");
  return (
    <form
      method="post"
      action={LOGOUT_URL}
      className="flex min-h-16 items-center"
      onSubmit={(event) => {
        event.preventDefault();
        void signOut(event.currentTarget);
      }}
    >
      <Button type="submit" variant="secondary">
        {t("action")}
      </Button>
    </form>
  );
}
