# instant-composition

[![CI](https://github.com/tomada1114/instant-composition/actions/workflows/ci.yml/badge.svg)](https://github.com/tomada1114/instant-composition/actions/workflows/ci.yml)

Instant English composition drills: see a Japanese sentence, say it in English before
the timer runs out.

## What this is

A flashcard drill for Japanese learners of English: each card shows a Japanese sentence,
and you say it in English before the timer runs out, then check yourself against the
answer. The cards are pre-generated JSON under `content/`, written ahead of time by
Claude Code skills, so the app itself calls no language model at runtime. It is a
Next.js App Router application styled with Tailwind v4 and shadcn/ui, ESM-only
TypeScript throughout. It runs as a local server, with progress kept in a SQLite file.

`AGENTS.md` describes the architecture and the rules; this file is the tour.

## Quick start

```sh
pnpm install
pnpm dev
```

Then open <http://localhost:3000>, which redirects to `/ja` — the UI ships in Japanese
only. A first visit goes on to picking topics and the placement round; after that `/ja`
is the start screen, `src/app/[locale]/(home)/page.tsx`. The text on every screen comes
from `messages/ja.json`.

Two optional variables, listed with empty values in `.env.example`, point the server
somewhere other than its defaults:

- `CONTENT_DIR` — the content root the cards are read from; `content/` by default. Point
  it at another checkout's `content/` to drill cards generated there.
- `PROGRESS_DB_PATH` — the SQLite file progress is kept in; `data/progress.sqlite` by
  default (ignored by Git, created on first use). A scratch path gives a fresh start
  without touching your own progress.

```sh
CONTENT_DIR=../instant-composition-cards/content PROGRESS_DB_PATH=/tmp/try.sqlite pnpm dev
```

## Where this app stands

It was started from a Next.js App Router template by following
[`starting-an-app`](.agents/skills/starting-an-app/SKILL.md): the template's identity
was renamed and its language-model layer removed whole. The design direction is settled
— a dark-only "night scoreboard", black with one neon green — and lives in the
[`designing-ui`](.agents/skills/designing-ui/SKILL.md) skill with its tokens in
`src/app/globals.css`. The first version's screens are built: the topic choice and
placement, the start screen, the drill, the end-of-round summary and its recap, the
records, and the settings.

`pnpm dlx shadcn@latest add <name>` cannot run from this repository's root under its
supply-chain policy; `designing-ui` holds the workaround.

## Development

This package is private: nothing here is packed, published, or consumed as a tarball.

```sh
corepack pnpm@11.18.0 install --frozen-lockfile
pnpm check:quick
```

The install puts the Git hooks in place on its own — lefthook's `postinstall` does it,
on every non-CI install — and `package.json`'s `prepare` script then runs
`scripts/verify-hooks.mjs`, which fails the install if the pre-commit hook did not
actually land. So there is no setup step for the hooks; `pnpm hooks:install` is the
repair when that check reports one is needed.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete workflow, and
[AGENTS.md](AGENTS.md) for the architecture, the command index, and the rules every
change is held to.

## License

[MIT](LICENSE) © tomada
