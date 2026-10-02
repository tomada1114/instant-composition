import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { updateProfile } from "../lib/endpoints";
import { PROFILE_QUERY } from "../lib/queries";
import { Button } from "../ui/button";

/** The time zone this browser runs in, as an IANA name such as `Asia/Tokyo`. */
function deviceTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Every zone the browser knows, with `current` kept even when it is not among them. */
function zoneChoices(current: string): readonly string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes(current) ? zones : [current, ...zones].sort();
}

/**
 * The stored time zone, read from `GET /v1/me` and changed through
 * `PATCH /v1/me`. A change moves only the next "today": the API rewrites no
 * day already recorded. The settings page reads the profile once per visit,
 * so opening the app tab again reads nothing; while that read is out the row
 * stands with its name alone, and it is left out when the profile cannot be
 * read.
 */
export function TimeZoneRow({
  onFailedChange,
}: Readonly<{ onFailedChange: (failed: boolean) => void }>): ReactElement | null {
  const t = useTranslations("Settings.timeZone");
  const client = useQueryClient();
  const profile = useQuery({ ...PROFILE_QUERY, refetchOnMount: false });
  const [changed, setChanged] = useState(false);
  const labelId = useId();
  const saved = useRef(profile.data);
  const latest = useRef(0);
  const device = useMemo(() => deviceTimeZone(), []);
  const zone = profile.data?.timeZone;
  const choices = useMemo(() => (zone === undefined ? [] : zoneChoices(zone)), [zone]);

  if (zone === undefined) {
    return profile.isPending ? (
      <div className="flex flex-col border-t border-border py-4">
        <h2 className="flex min-h-8 items-center">{t("title")}</h2>
      </div>
    ) : null;
  }

  function save(timeZone: string): void {
    if (profile.data === undefined || timeZone === zone) return;
    const request = ++latest.current;
    saved.current ??= profile.data;
    client.setQueryData(PROFILE_QUERY.queryKey, { ...profile.data, timeZone });
    setChanged(false);
    onFailedChange(false);
    void updateProfile({ timeZone }).then((result) => {
      if (result.ok) saved.current = result.value;
      // Only the latest save settles the row; an earlier answer arriving late changes nothing shown.
      if (request !== latest.current) return;
      if (result.ok) {
        client.setQueryData(PROFILE_QUERY.queryKey, result.value);
        setChanged(true);
        return;
      }
      client.setQueryData(PROFILE_QUERY.queryKey, saved.current);
      onFailedChange(true);
    });
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border py-4">
      <div className="flex min-h-8 items-center justify-between gap-4">
        <h2 id={labelId}>{t("title")}</h2>
        <select
          aria-labelledby={labelId}
          value={zone}
          onChange={(event) => {
            save(event.target.value);
          }}
          className="min-w-0 max-w-[60%] truncate bg-background font-latin text-count text-foreground"
        >
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </div>
      {device !== zone ? (
        <Button
          variant="text"
          className="-ml-3 self-start text-foreground"
          onClick={() => {
            save(device);
          }}
        >
          {t("useDevice", { zone: device })}
        </Button>
      ) : null}
      {changed ? (
        <p role="status" className="text-muted-foreground">
          {t("saved", { zone })}
        </p>
      ) : null}
    </div>
  );
}
