import { useRef, useState, type ReactElement, type SubmitEvent } from "react";
import { useTranslations } from "use-intl";

import { signInWith, type SignInOutcome } from "../lib/sign-in";
import { Button } from "../ui/button";
import { ArrowGlyph } from "../ui/glyphs";

type Status = "idle" | "sending" | Exclude<SignInOutcome, "signed-in">;

const FIELD =
  "min-h-11 w-full rounded-control border-2 border-input bg-card px-4 py-3 text-body text-foreground enabled:hover:bg-raised disabled:text-disabled";

const NOTICE = {
  refused: "refused",
  "action-required": "actionRequired",
  failed: "failed",
} as const;

/**
 * The sign-in form: an email, a password and "sign in" as the one `primary`,
 * in the reading width. Enter in either field submits, as a form does; the
 * password is sent exactly as typed. While a sign-in is out the form takes no
 * second one. A refusal, an account an administrator must act on, or no
 * answer at all is said under the fields, and the form stays ready to send
 * again. A signed-in visitor is sent to `/` by a full-page navigation, so the
 * new session starts a visit of its own.
 */
export function LoginScreen(): ReactElement {
  const t = useTranslations("Login");
  const [status, setStatus] = useState<Status>("idle");
  const inFlight = useRef(false);
  const sending = status === "sending";

  async function submit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    const form = new FormData(event.currentTarget);
    const text = (name: string): string => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    setStatus("sending");
    const outcome = await signInWith(text("email"), text("password"));
    if (outcome === "signed-in") {
      globalThis.location.assign("/");
      return;
    }
    inFlight.current = false;
    setStatus(outcome);
  }

  return (
    <div className="mx-auto flex w-full max-w-reading flex-col gap-8">
      <h1 className="text-heading">{t("title")}</h1>
      <form
        className="flex flex-col gap-6"
        aria-busy={sending}
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="text-label">{t("email")}</span>
          <input
            className={FIELD}
            type="email"
            name="email"
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            required
            readOnly={sending}
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-label">{t("password")}</span>
          <input
            className={FIELD}
            type="password"
            name="password"
            autoComplete="current-password"
            required
            readOnly={sending}
          />
        </label>
        {status === "idle" || sending ? null : (
          <p role="alert" className="text-body">
            {t(NOTICE[status])}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={sending}>
          {sending ? t("sending") : t("submit")}
          <ArrowGlyph className="size-4.5" />
        </Button>
      </form>
    </div>
  );
}
