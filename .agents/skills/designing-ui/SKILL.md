---
name: designing-ui
description: >
  Covers this app's settled "instrument" direction and the Tailwind v4 + shadcn/ui
  foundation under it: the design lock and ledger, the dark-only tokens and the three
  web fonts, the component recipes, motion, sound, keys, key hints and accessibility
  rules, adding a shadcn/ui component with pnpm dlx shadcn@latest add into
  src/components/ui/, cn and tailwind-merge, and the Preflight traps. Use when building
  or restyling a component or screen, choosing a color, type size, radius, spacing or
  motion, using the accent, or adding or renaming a theme token.
---

# Designing UI

**Owns:** the visual direction and its lock, the theme tokens in `src/app/globals.css`,
the component recipes, how a shadcn/ui component enters `src/components/`, and the craft
rules every screen follows. **Does not own:** which zone a component may import from
(`building-app-routes` and AGENTS.md's Architecture); the TypeScript inside a component
(`writing-typescript`); the text a component renders (`localizing-ui`); the rename and
locale steps of starting an app (`starting-an-app`).

The tokens are partly mechanical — `globals.css` clears Tailwind's own palette, radii,
sizes, shadows and animations, so an off-vocabulary class generates nothing — but a
drifted screen still passes every gate. The lock is the check: read it before styling,
and compare the rendered screen against it afterwards.

## The lock

```text
Primary reference:  Superlative (playsuperlative.com): a precision instrument's panel —
                    matte near-black, white ink, small tracked labels at the edges, one
                    indicator color that reads as function, never decoration. When a
                    choice is unclear, lean towards it.
Preserve:           near-black canvas; one lime; figures in a grotesk set big and tight;
                    tracked mono micro-labels; hairline rules instead of boxes; no
                    shadows — depth comes only from canvas / surface / raised.
Borrow only:        from WHOOP, big figures over a quiet data row (the home screen's
                    streak over its week); from Cron, rounded-rectangle controls
                    (18 radius) rather than pills, and icon tiles for navigation.
Role rules:         the accent marks exactly four things — a said-it (○) grade, the one
                    primary action on a screen, a running indicator (timer bar, combo),
                    and what grew in this session. Selection is white. Focus is white.
                    A missed (×) or timed-out card is grey, never red.
Media strategy:     none. No illustration or photography; the only graphics are glyphs,
                    rings, bars, ticks and dots drawn in white, grey and the accent.
Reject:             a card box around the drill prompt; pills that look pressable but
                    are not (a status is plain text with a glyph); prose — an
                    explanation longer than one line, a note under every control; key
                    hints shown to someone who has not used a key; mascots, confetti,
                    full-screen flashes, shakes, 3D flips, praise and exclamation marks,
                    red, a colour per topic, a light theme.
Memorable move:     the drill is the whole screen — ticks across the top, the prompt
                    set large on the canvas, a lime line running out above the thumb.
```

Four principles decide what the lock does not: **only what moved lights up** (a value
that did not change stays white or grey and still); **figures lead, words label them**
(a number with a two-word name, not a sentence; no line of prose longer than one line,
and a definition someone needs only once goes behind ⓘ); **a miss is not a penalty** (no
red, no miss count, no accuracy rate); **never childish** (a number instead of praise).

## Ledger

"Spec" is the design specification the first direction was transcribed from, which lives
outside this repository; "Redesign" marks a call made when the direction moved from
"night scoreboard" to "instrument" at the owner's request (less text, a designed rather
than home-made feel); "Here" marks a call made while transcribing either.

| Decision                                                                                    | Source   | Why                                                                                                                               |
| ------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Dark only: no light theme, no OS-appearance switch                                          | Spec     | A single small light reads as feedback only on a dark field; the owner chose to keep it over a light "paper" direction            |
| Canvas `#0A0A0B`, not pure black                                                            | Redesign | The primary reference's matte panel; pure black made the surface step (`#141416`) read as a hole rather than a layer              |
| Accent `#B8FF2C`                                                                            | Redesign | Kept the lime of the first direction, a step warmer so it reads as an indicator light rather than a highlighter                   |
| Three web fonts: Inter Tight (English), Space Grotesk (figures), JetBrains Mono (labels)    | Redesign | Figures and labels carry the instrument look; Japanese stays on the system stack, which already covers it                         |
| No card box on the drill: the prompt and the answer sit on the canvas                       | Redesign | A tall empty box around one sentence read as unfinished; the whole screen is the card                                             |
| Progress as one tick per card across the top, the count in mono under it                    | Redesign | The ticks show where the round is at a glance; the count stays for exact reading and for a screen reader                          |
| Buttons are 60 tall, 18 radius, filled; `secondary` is a raised fill with no border         | Redesign | Borrowed from Cron; a filled pair reads as two buttons without a 1.5px outline                                                    |
| "To review", "timed out" and "fast" are plain text (with a glyph), never a pill             | Redesign | A pill reads as a button; these are states                                                                                        |
| Key hints hidden until the learner presses a key (`data-keys`, remembered in local storage) | Redesign | A permanent "Space" on every button was noise for touch learners; whoever uses a key sees them from then on                       |
| `?` pauses, and the pause sheet lists the keys                                              | Redesign | One place to learn the keys, reached by the key a keyboard user tries first                                                       |
| A ○ lights the answer and the current tick, not a rim around a card                         | Redesign | With no card box there is no rim; the answer is what the learner is looking at                                                    |
| Navigation is icon tiles (sound, records, settings); back is ←                              | Redesign | Underlined text links read as a document, not an app                                                                              |
| Definitions (what counts as mastered, how the streak counts) sit behind ⓘ                   | Redesign | Needed once, read never again; a permanent paragraph taxed every visit                                                            |
| Secondary text `#939396`; `#5C5C60` only for disabled text                                  | Here     | `#5C5C60` measures 2.97:1 on the canvas, under the text floor                                                                     |
| One column, 420 max, 16 gutter, even on a PC                                                | Spec     | The real setting is a phone; the PC build is the same screen                                                                      |
| The neon is `accent`, not shadcn's `primary`                                                | Here     | One grep for `accent` finds every use, so review can count them against the four roles                                            |
| shadcn's `primary` is white, with a black foreground                                        | Here     | Registry controls paint on/selected with `primary`, and selection here is white; a copy's checked state lands on-palette unedited |
| `raised` is its own token; `secondary` and `muted` alias it                                 | Here     | One name stops a screen choosing between three                                                                                    |
| No `destructive`, `chart-*` or shadow token                                                 | Here     | Red, a colour per series and elevation are rejected; a copy's classes for them generate nothing                                   |
| Tailwind's default palette, radii, sizes, shadows and animations cleared                    | Here     | Makes the lock partly mechanical: `bg-red-500`, `shadow-sm`, `animate-pulse` do nothing                                           |
| `dark:` always matches                                                                      | Here     | The app is always dark, so a copy's dark-tuned classes are the right ones on any OS                                               |
| Sizes in rem at a 16px root                                                                 | Here     | px values stay exact by default and scale with the browser's text size                                                            |
| Focus is a global white 2px outline, 2px offset, in the base layer                          | Here     | On every control; one rule cannot be forgotten per component                                                                      |
| Reduced motion spares `data-motion="essential"`                                             | Here     | The timer bar keeps shrinking under reduced motion; the global collapse would freeze it                                           |
| `viewport` declares `color-scheme: dark` and a `#0A0A0B` `theme-color`                      | Here     | Browser controls and a phone's toolbar match the canvas before the stylesheet loads                                               |

## References

Read the one the task needs; each records what is settled, not a proposal.

- [foundations.md](references/foundations.md) — token map, the four accent roles,
  not-colour-alone rules, the three families and the type scale, spacing, shape, layout
  and the measured contrast.
- [components.md](references/components.md) — the component inventory and every recipe:
  button, key hint, icon button, eyebrow, grade pair, the drill's faces, ticks, timer
  bar, selection controls, rings, week bars, summary parts, sheet, info tip, toast,
  skeleton.
- [behavior.md](references/behavior.md) — motion and its reduced form, sound, keys and
  key hints, accessibility and the implementation rules (timing, pause on hide, the
  session day).

## Foundation

Tailwind v4 with no `tailwind.config.js`: `postcss.config.mjs` is the whole of the build
wiring, and the theme is CSS. A component never carries a raw color, a one-off `px` type
size, or an arbitrary-value color.

- `components.json` points every shadcn alias inside one zone, so the CLI writes into
  `src/components/` and nowhere else.
- `pnpm dlx shadcn@latest …` cannot run from the repository root: the CLI's own
  dependency graph reaches a package that `pnpm-workspace.yaml`'s `trustPolicy` refuses.
  Run it from a scratch directory outside the checkout with
  `-c <path to this checkout>`. Any package the component needs is then added with
  `pnpm add` here, under the review `managing-dependencies` owns.
- `add` may also write CSS variables — even a `.dark` block — into `globals.css`. Read
  that diff and revert it; a new role goes into the palette by hand.
- Rewrite the copy on the way in: `cn` from `@/components/lib/utils`, `Slot` from
  `@radix-ui/react-slot`, an `interface` for the props and an explicit return type, then
  restyle it to its recipe — `hover:bg-accent` becomes `hover:bg-raised`, `destructive`
  and `shadow-*` classes go, radii become `rounded-card`, `rounded-control`,
  `rounded-tile`, `rounded-icon`, `rounded-bar` or `rounded-full`.
  `src/components/ui/button.tsx` is the worked example.
- Prefer a registry component over a hand-rolled one. The reject list still applies to a
  component that ships inside a library.

## Tokens

- The shape is shadcn's: a plain custom property on `:root` per color, mapped onto a
  utility by `@theme inline`, so one declaration drives every utility that reads it.
- Dark only. `:root` sets `color-scheme: dark`, there is no `prefers-color-scheme` block
  and no light value anywhere, and `@custom-variant dark` matches every element. Adding
  a light theme is renegotiating the lock, not a token edit.
- A token declared directly in a plain `@theme` block is emitted only once some utility
  uses it, so `var()` against an unused one from hand-written CSS resolves to nothing.
  Declare such a block `@theme static` when raw CSS reads the tokens too.
- Never give a size token and a color token the same name: with both, a bare
  `text-<name>` always resolves to the color.
- `twMerge` knows only Tailwind's default theme. `src/components/lib/utils.ts` extends
  it with every size, radius and container name `globals.css` declares; a new one is
  added in both places, plus a `cn` case in `tests/ui-primitives.test.tsx`.
- The fonts are `next/font/google` in `src/app/fonts.ts`, exposed as CSS variables that
  `--font-latin`, `--font-display` and `--font-mono` read; `fontVariables` goes on every
  `<html>`. A fourth family is renegotiating the lock.
- Measure a new text/background pairing against WCAG contrast rather than estimating it,
  and add it to the table in the foundations reference.

## Craft rules

- Preflight resets headings, links and margins. `globals.css` restores heading sizes and
  link underlines in `@layer base`, and deliberately does not restore a `<p>` margin:
  space with the container's `gap-*`, not with margins on the children.
- Tailwind v4's Preflight gives a button `cursor: default`; the base layer restores the
  pointer for enabled buttons. Keep that rule rather than adding `cursor-pointer`.
- Focus is visible on every control; never remove the outline to tidy a field.
- Motion is functional and short, and `prefers-reduced-motion` switches each moment to
  its reduced form. No spinner and no pulsing skeleton, anywhere.
- Copy is a label, not an instruction. Before adding a line of explanation, ask what the
  screen would need to make it unnecessary; a definition someone needs once goes behind
  an `InfoTip`, a refusal is said when it happens (the last topic pressed off), not in
  advance.
- A key hint is a `Kbd` inside the control it presses, never a free-standing chip.
- Mobile is not a later pass: one fluid column with a 16px gutter, no horizontal scroll.

## A screen with no precedent here

Do not extrapolate from taste. Add the part to the inventory in the components reference
first, built from existing tokens only, then research the surface the way the direction
was researched and adapt the findings to the lock rather than letting them relax it. If
a finding and the lock genuinely conflict, say so and let a human decide which gives way
— quietly softening the lock toward a safer middle is the failure this file guards
against. The user-level `refero-design` skill is the research method when it is
installed.
