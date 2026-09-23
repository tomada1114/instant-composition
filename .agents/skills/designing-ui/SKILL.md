---
name: designing-ui
description: >
  Covers this app's settled "night scoreboard" direction and the Tailwind v4 + shadcn/ui
  foundation under it: the design lock and ledger, the dark-only tokens in
  src/app/globals.css, the component recipes, motion, sound, keys and accessibility
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
Primary reference:  Stryds (stryds.com): a black canvas, cards one step lighter, one
                    neon green reserved for the main action and emphasis. When a choice
                    is unclear, lean towards it.
Preserve:           black canvas; one neon; large card radii and pill controls; big,
                    tightly tracked figures; no shadows — depth comes only from the
                    canvas / surface / raised steps.
Borrow only:        tabular monospace seconds and progress from a scoreboard; dark stat
                    cards with bars for the summary and record screens; the order of a
                    closing summary (streak, results, one more round, calendar).
Role rules:         the accent marks exactly four things — a said-it (○) grade, the one
                    primary action on a screen, a running indicator (timer bar, combo),
                    and what grew in this session. Selection is white. Focus is white.
                    A missed (×) or timed-out card is grey, never red.
Media strategy:     none. No illustration or photography; the only graphics are rings,
                    bars and dots drawn in white, grey and the accent.
Reject:             mascots, rounded bold display type, confetti, full-screen flashes,
                    shakes, 3D card flips, praise copy and exclamation marks, red for
                    errors or misses, a colour per topic, a light theme.
Memorable move:     a black screen where only what moved this session glows green.
```

Four principles decide what the lock does not: **only what moved lights up** (a value
that did not change stays white or grey and still); **figures lead, sentences follow**
(say "3 sentences got faster" and "−1.2 s", not an explanation; no line of prose longer
than one line); **a miss is not a penalty** (no red, no miss count, no accuracy rate);
**never childish** (a number instead of praise).

## Ledger

"Spec" is the design specification this direction was transcribed from, which lives
outside this repository; "Here" marks a call made while transcribing it.

| Decision                                                                                                   | Source | Why                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dark only: no light theme, no OS-appearance switch                                                         | Spec   | A single small light reads as feedback only on a dark field                                                                                                     |
| Secondary text `#9A9A9A`; `#6F6F6F` only for disabled text                                                 | Spec   | `#6F6F6F` measures 4.18:1 on black, under the 4.5:1 body-text floor                                                                                             |
| Inter is the only web font; Japanese uses the system stack                                                 | Spec   | Japanese system fonts already cover the UI; one fetched family keeps the load small                                                                             |
| One column, 420 max, 16 gutter, even on a PC                                                               | Spec   | The real setting is a phone; the PC build is the same screen                                                                                                    |
| The neon is `accent`, not shadcn's `primary`                                                               | Here   | The spec calls it `accent` and asks review to count its uses; one grep for `accent` then finds every one                                                        |
| shadcn's `primary` is white, with a black foreground                                                       | Here   | Registry controls paint on/selected with `primary`, and the spec shows selection in white (toggle, segmented); a copy's checked state lands on-palette unedited |
| `raised` is its own token; `secondary` and `muted` alias it                                                | Here   | The spec uses raised for a dozen parts; one name stops a screen choosing between three                                                                          |
| No `destructive` or `chart-*` token                                                                        | Here   | Red and a colour per series are rejected; a copy's classes for them generate nothing                                                                            |
| Tailwind's default palette, radii, sizes, shadows and animations cleared                                   | Here   | Makes the lock partly mechanical: `bg-red-500`, `shadow-sm`, `animate-pulse` do nothing                                                                         |
| `dark:` always matches                                                                                     | Here   | The app is always dark, so a copy's dark-tuned classes are the right ones on any OS                                                                             |
| Sizes in rem at a 16px root                                                                                | Here   | The spec's px values stay exact by default and scale with the browser's text size                                                                               |
| Focus is a global white 2px outline, 2px offset, in the base layer                                         | Here   | The spec wants it on every control; one rule cannot be forgotten per component                                                                                  |
| `h1` is `heading`; `h2`/`h3` are `label`                                                                   | Here   | The spec's section titles ("Milestones" on the record screen) are set as labels                                                                                 |
| Tokens added beyond the spec: `action` (16/600), `front-long` (20), `accent-pressed`, `primary-foreground` | Here   | Each writes down a value the spec states in prose — button text, a front over two lines, the 8% darker press, black on the white segment                        |
| Reduced motion spares `data-motion="essential"`                                                            | Here   | The spec keeps the timer bar shrinking under reduced motion; the global collapse would freeze it                                                                |
| `viewport` declares `color-scheme: dark` and a black `theme-color`                                         | Here   | Browser controls and a phone's toolbar match the canvas before the stylesheet loads                                                                             |

## References

Read the one the task needs; each is a transcription of the spec, not a proposal.

- [foundations.md](references/foundations.md) — token map, the four accent roles,
  not-colour-alone rules, type scale, spacing, shape, layout and the measured contrast.
- [components.md](references/components.md) — the component inventory and every recipe:
  button, grade pair, flashcard, timer bar, chips, selection controls, rings, streak,
  summary parts, sheet, toast, skeleton.
- [behavior.md](references/behavior.md) — motion and its reduced form, sound, keys,
  accessibility and the implementation rules (timing, pause on hide, the session day).

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
  and `shadow-*` classes go, radii become `rounded-card`, `rounded-tile` or
  `rounded-full`. `src/components/ui/button.tsx` is the worked example.
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
  it with every size, radius, container and shadow name `globals.css` declares; a new
  one is added in both places, plus a `cn` case in `tests/ui-primitives.test.tsx`.
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
- Mobile is not a later pass: one fluid column with a 16px gutter, no horizontal scroll.

## A screen with no precedent here

Do not extrapolate from taste. Add the part to the inventory in the components reference
first, built from existing tokens only, then research the surface the way the direction
was researched and adapt the findings to the lock rather than letting them relax it. If
a finding and the lock genuinely conflict, say so and let a human decide which gives way
— quietly softening the lock toward a safer middle is the failure this file guards
against. The user-level `refero-design` skill is the research method when it is
installed.
