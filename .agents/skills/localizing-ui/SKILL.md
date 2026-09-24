---
name: localizing-ui
description: >
  Covers the message catalogs under messages/ and the web client's use-intl plumbing in
  apps/web/src/i18n/: adding or renaming a UI string so the catalog, MESSAGE_KEYS and
  the typed key union stay in step, ICU arguments and plural categories, useTranslations
  and CatalogProvider, and why the locale is not in the URL. Use when adding a
  translated string, editing messages/ja.json, touching apps/web/src/i18n/messages.ts or
  provider.tsx, proposing a second locale, or when a message renders as its own key
  name.
---

# Localizing UI

**Owns:** what goes into a message catalog and how it reaches the code that renders it —
`messages/*.json`, the catalog typing in `apps/web/src/i18n/messages.ts`, and
`CatalogProvider` in `apps/web/src/i18n/provider.tsx`. **Does not own:** the route tree,
links and the screens that render the strings (`building-web-screens`); how a rendered
test case is written (`writing-tests`) and which vitest project it joins
(`placing-tests`); TypeScript idiom inside a module (`writing-typescript`); the locale
steps of turning this template into an app (`starting-an-app`).

## A tree full of Japanese is not a violation

AGENTS.md's Conventions makes `messages/*.json` the one exception to the English-only
rule, and states the exception's own limit: it covers the catalogs' string values and
nothing else. Keys stay English, and so does every comment, test, and document about
them, bar the narrow case AGENTS.md spells out — a literal whose exact bytes are what a
check or a worked example exercises, which is why the plural example below quotes
Japanese rather than translating it. That rule lives in AGENTS.md; this skill only
points at it.

The place it is easiest to break is a skill's own frontmatter. Enforced by:
`tests/skills-frontmatter.test.ts`, which rejects CJK in a `description`. A Japanese
example belongs in a fenced block in a body, never in a trigger string.

`typos.toml` scans `messages/` with no exclusion and needs none — Japanese text does not
look like a misspelled English word. If the spell-checker ever fires on a catalog, fix
the text; adding an exclusion is weakening a gate.

## Adding a string, end to end

Three edits, in this order. Doing two of them and running a check reports the part you
have not made yet, so make all three first.

1. `messages/ja.json` — add the key under a namespace. Japanese, the one locale this app
   ships, is the source of truth for the catalog's _shape_: `Messages = typeof ja` in
   `apps/web/src/i18n/messages.ts`, and its `declare module "use-intl"` block registers
   that shape as `AppConfig`'s `Messages`, so a key outside the catalog fails to compile
   instead of rendering as its own name.
2. `tests/messages.test.ts` — add the dotted `Namespace.key` to `MESSAGE_KEYS`. It lives
   in the test, not in the web client, because nothing the application ships reads it:
   it exists only to be diffed against the catalog (see the three checks below).
3. Render it: `const t = useTranslations("Namespace")` from `use-intl`, then `t("key")`.
   Every screen is already under `CatalogProvider`, which `App` mounts once.

Then `pnpm exec vitest run tests/messages.test.ts && pnpm typecheck`.

Three checks hold the catalog, the hand-written list and the typed union together. The
last two overlap on purpose: both fail when `ja.json` gains a key nobody listed, but
only the runtime case names it.

- `MESSAGE_KEYS` is `as const satisfies readonly MessageKey[]`, so an entry the catalog
  does not hold — a typo, a key renamed or deleted in `ja.json` — fails
  `pnpm typecheck`.
- `expectTypeOf<(typeof MESSAGE_KEYS)[number]>().toEqualTypeOf<MessageKey>()` fails
  `pnpm typecheck` when `ja.json` gained a key nobody listed, but the error names a type
  mismatch, not the key. `as const satisfies` rather than an annotation of
  `readonly MessageKey[]` is what makes this possible: the annotation would discard the
  literal tuple type and let a new key land silently.
- The runtime case fires on that same omission, comparing the list against the keys read
  from `messages/ja.json` on disk rather than from what the bundler resolved — keep it
  for that: it is the one check that names the offending key, and the only one that
  would notice `DottedKeys` and the test's own `dottedKeys` walk disagreeing, a
  divergence that would make both type checks agree wrongly.

`MESSAGE_KEYS` is the one thing here that is not derived from `ja.json`, and that is
deliberate. `MessageKey` agrees with the catalog by construction, so it can never report
a key that was never added; only a list a human maintains as step 2 above can. Deriving
it would collapse all three checks into `flatten(ja) === flatten(ja)`.

A namespace is a first-level object in the catalog and the argument `useTranslations`
takes. Group by the screen or component that reads it (`Home`, `Drill`, `Settings`), so
a screen's strings are one namespace to read and one to review. The document's own title
and description are the `Metadata` namespace, which `App` writes into the document on
mount; `apps/web/index.html` carries only a placeholder.

## ICU arguments and plural categories

- An argument is `{name}`, and every locale's version of a key must ask for the same
  set. Enforced by: `tests/messages.test.ts`, which compares argument names per key
  across catalogs — an argument the caller does not pass is a runtime formatting error
  in that one locale, on a page nobody opened in it.
- Plural **categories** deliberately differ between catalogs, and the test does not
  compare them. A plural key carries only `other` in `ja.json`, because Japanese has no
  singular/plural distinction; an English catalog added later would carry `one` and
  `other`, and an unused `one` branch in Japanese would be a translation of a grammar
  the language does not have.

  ```json
  "cardCount": "{count, plural, other {# 文}}"
  ```

- `#` inside a plural branch is the count. Pass it as an argument —
  `t("cardCount", { count: cards.length })` — and never format a number into the string
  yourself, which would hard-code one locale's digit grouping into all of them.
- Every message is also formatted once by `tests/messages.test.ts`, with
  `createTranslator` (re-exported from `@instant-composition/web`, the same formatter
  `useTranslations` uses) and a dummy value per argument, so malformed ICU syntax fails
  there rather than on a screen.

## The modules, and which one to reach for

Each file under `apps/web/src/i18n/` carries its reasoning in its own TSDoc; read the
file rather than a paraphrase. What is worth knowing before you open one:

- `messages.ts` — `LOCALE` (`"ja"`), `Messages`, `MESSAGES`, and the `use-intl`
  `AppConfig` augmentation. It imports `messages/ja.json` by a relative path — the one
  relative read out of `apps/web` that `tests/boundaries.test.ts` admits, since
  `apps/web` imports no workspace package.
- `provider.tsx` — `CatalogProvider`, `use-intl`'s `IntlProvider` over `LOCALE` and
  `MESSAGES`. A test rendering a single component wraps it in this; a test mounting the
  whole `App` gets it already.

**A message that renders as its own key name** means the catalog and `MESSAGE_KEYS` are
out of step, or the string was read under a namespace that does not hold it. Run
`tests/messages.test.ts` first; it names the key.

## The locale is not in the URL

A path names a screen and nothing else — `/records`, never `/ja/records` — and nothing
negotiates a locale: no `Accept-Language`, no cookie, no stored preference. `ja` is the
only catalog, so there is nothing to choose between. ADR-0008 records that, and records
that the locale will come from the learner's profile once a second one exists. Do not
describe a negotiation that is not there, and do not add a locale segment to a route.

## Adding a locale

This app ships `ja` only, and a second locale is an architecture change rather than a
catalog edit: `LOCALE` becomes a list, `MESSAGES` a record keyed by it,
`CatalogProvider` has to be told which one to use, and where that choice comes from is
the open part of ADR-0008. Take it through an ADR first. **REQUIRED:**
`recording-architecture-decisions`. The catalog half is then a new
`messages/<locale>.json` translating every key `ja.json` holds, and the `LOCALES` list
at the top of `tests/messages.test.ts`, which already compares every catalog's keys and
ICU arguments against `ja`.

## What to run

```bash
pnpm exec vitest run tests/messages.test.ts  # catalogs against each other and against MESSAGE_KEYS
pnpm typecheck                               # both type directions, and every t() call site
pnpm exec vitest run tests/web-<screen>.test.tsx  # the screen that renders the string
```

Then open the screen under `pnpm dev`. `pnpm run test:smoke` checks only that the built
document says `<html lang="ja">`, which `apps/web/index.html` hard-codes; nothing checks
that a string reads correctly on screen, and that is what opening it is for.
