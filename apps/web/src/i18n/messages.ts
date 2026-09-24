import ja from "../../../../messages/ja.json";

/**
 * The one locale the web client ships, and the catalog its UI strings come
 * from.
 *
 * @remarks
 * `messages/ja.json` at the repository root is the catalog the Next.js tree
 * reads too: there is one catalog, and its shape is the type every `t()` call
 * is checked against. The locale is not in the URL and nothing negotiates it:
 * `ja` is the only catalog, so there is nothing to choose between until a
 * second one exists (ADR-0008).
 */
export const LOCALE = "ja";

export type Locale = typeof LOCALE;

/** The catalog shape: Japanese, the one locale shipped, is the source of truth for it. */
export type Messages = typeof ja;

export const MESSAGES: Messages = ja;

declare module "use-intl" {
  // Teaches `useTranslations` this catalog: a key outside it, or a namespace
  // it does not hold, fails to compile instead of rendering as its own name.
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
