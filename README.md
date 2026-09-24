# instant-composition

[![CI](https://github.com/tomada1114/instant-composition/actions/workflows/ci.yml/badge.svg)](https://github.com/tomada1114/instant-composition/actions/workflows/ci.yml)

Instant English composition drills: see a Japanese sentence, say it in English before
the timer runs out.

## What this is

A flashcard drill for Japanese learners of English: each card shows a Japanese sentence,
and you say it in English before the timer runs out, then check yourself against the
answer. The cards are pre-generated JSON under `content/`, written ahead of time by
Claude Code skills, so the app itself calls no language model at runtime. It is a React
single-page app (`apps/web`, built with Vite and styled with Tailwind v4) talking to an
HTTP API (`apps/api`, on Hono) that keeps progress in DynamoDB, ESM-only TypeScript
throughout. Locally the API runs against DynamoDB local in a container.

`AGENTS.md` describes the architecture and the rules; this file is the tour.

## Quick start

With Docker running:

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts DynamoDB local, builds the catalog snapshot from `content/` when there
is none yet, and runs the API and the web client together. Open <http://127.0.0.1:5173>
— the UI ships in Japanese only. A first visit goes on to picking topics and the
placement round; after that `/` is the start screen. The text on every screen comes from
`messages/ja.json`. Ctrl-C stops the API and the web client; `pnpm db:down` stops
DynamoDB local, and your progress with it, since the container keeps its tables in
memory.

The snapshot is built only when there is none: after `content/` changes, run
`pnpm catalog:build` and restart `pnpm dev`, since the API reads a snapshot once per
start. The variables a local run reads are listed with empty values in `.env.example`;
every one has a default. For example, `API_CATALOG_PATH` points the API at another
snapshot, and `API_TABLE_NAME` at a fresh table, without touching your own progress:

```sh
API_TABLE_NAME=scratch pnpm dev
```

## Where this app stands

It was started from a Next.js App Router template by following
[`starting-an-app`](.agents/skills/starting-an-app/SKILL.md): the template's identity
was renamed and its language-model layer removed whole, and the Next.js application has
since been replaced by the SPA and the API above. The design direction is settled — a
dark-only "instrument", near-black with one lime — and lives in the
[`designing-ui`](.agents/skills/designing-ui/SKILL.md) skill with its tokens in
`apps/web/src/globals.css`. The first version's screens are built: the topic choice and
placement, the start screen, the drill, the end-of-round summary and its recap, the
records, and the settings.

The shadcn/ui components under `apps/web/src/ui/` are copied from the registry by hand
rather than with `shadcn add`; `designing-ui` holds how.

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
