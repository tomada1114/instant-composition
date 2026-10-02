---
name: designing-ui
description: >
  Covers this app's settled "Lemon Arcade" direction, PC first in light and dark, and
  the Tailwind v4 + shadcn/ui foundation under it: the lock and ledger, the two-theme
  tokens and three web fonts, the layout system, component recipes, hover, motion,
  celebration, sound, keys and accessibility, copying a shadcn/ui component by hand into
  apps/web/src/ui/, globals.css tokens, cn and tailwind-merge, and the Preflight traps.
  Use when building or restyling a component or screen in apps/web, choosing a color,
  type size, radius, spacing, layout or motion, or adding or renaming a theme token.
---

# Designing UI

**Owns:** the visual direction and its lock, the theme tokens in
`apps/web/src/globals.css`, the layout system, the component recipes, how a shadcn/ui
component enters `apps/web/src/ui/`, and the craft rules every screen follows. **Does
not own:** the route, the data a screen reads and where its files go
(`building-web-screens`); the TypeScript inside a component (`writing-typescript`); the
text a component renders (`localizing-ui`); the rename and locale steps of starting an
app (`starting-an-app`).

The tokens are partly mechanical — `globals.css` clears Tailwind's own palette, radii,
sizes, shadows and animations, so an off-vocabulary class generates nothing — but a
drifted screen still passes every gate. The lock is the check: read it before styling,
and compare the rendered screen against it afterwards, in both themes. #349's work items
bring `apps/web` to this direction; until one lands, code that disagrees with this skill
is the code's to change, not the skill's.

## The lock

```text
Primary reference:  Duolingo (Refero styles 9457a848, fad6cd55; screens 881f6ed6, d68cd559):
                    shape, type and components. Rounded everywhere, heavy rounded figures,
                    the pressable button with a solid lip, flat cards with 2px borders, a
                    giant coloured streak number beside a flame.
Palette source:     Playdate (Refero c91209ef), bounded to colour: yellow energy, a violet
                    action, charcoal ink, teal status. Its charcoal becomes the dark theme.
Borrow only:        Waterllama's confetti timing, for a streak that grew and a milestone,
                    drawn as code-native shapes; Duolingo dark's (630776f9) bars and energy
                    colour staying bright on charcoal.
Role rules:         violet = the one primary action on a screen, as a fill, never as text;
                    yellow = energy: the streak, points, the timer, the combo, celebration;
                    teal = ○ and what grew; ×, a timeout and a weak point are neutral grey,
                    never red or pink. Selection is ink: a border and a check.
Media strategy:     no mascot and no illustration. Filled glyphs (flame, bolt, target, star)
                    in the app's glyph set; confetti as CSS shapes.
Reject:             Duolingo's green; red or pink for a miss; hearts or lives; a mascot drawn
                    in CSS; a colour per topic; praise and exclamation marks.
Memorable move:     chunky pressable buttons with a lip, and a giant yellow flame-number when
                    the streak grows.
```

Four principles decide what the lock does not: **each colour has one job** (violet the
one primary action, yellow energy, teal ○ and what grew, ink selection and focus — a
value outside its colour's job stays ink or grey); **figures lead, words label them** (a
number with a two-word name, not a sentence; no line of prose longer than one line, and
a definition someone needs only once goes behind ⓘ); **a miss is not a penalty** (no
red, no miss count, no accuracy rate); **playful, never childish** (a number instead of
praise; no mascot, hearts or lives).

## Ledger

"Redesign" marks a call made when the direction was transcribed from its first
specification, which lives outside this repository; "Here" marks a call made while
transcribing a direction; "Owner" marks a call the owner made in an issue, named beside
it. Each `Owner (#349)` row replaces an earlier row for the phone-first "instrument"
direction; its reason is #349's § Decisions.

| Decision                                                                                                                 | Source             | Why                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Light and dark, following the OS (`prefers-color-scheme`); no in-app theme switch                                        | Owner (#349)       | A PC is often used in a bright room, and the native apps will follow the OS too                                                                      |
| Lemon Arcade: a cream or charcoal canvas, a violet `action`, a yellow `energy`, a teal `good`, charcoal ink              | Owner (#349)       | The owner's pick over "Instrument, daylight" and "Pastel Studio": a drastic change towards light, friendly and game-like (Duolingo and Speak)        |
| Three web fonts: Fredoka (figures), Nunito (Latin UI and answers), M PLUS Rounded 1c (Japanese)                          | Owner (#349)       | Rounded, heavy figures carry the look; a Japanese web font is the accepted cost of a rounded Japanese face                                           |
| The drill's face sits on a card: `surface`, a 2px `border`, 20 radius, inside the 880 stage                              | Owner (#349)       | Flat cards with 2px borders are the primary reference's; on a PC's wide stage the card gathers the face                                              |
| Round progress is an 18px `good` bar on `bar-track` with "7 / 10" beside it                                              | Owner (#349)       | The primary reference's lesson bar; a 560 bar reads where the round is at a glance, the count stays for exact reading and a screen reader            |
| Buttons are 52 tall, 16 radius, with a 4px solid lip; pressed drops onto the lip. `secondary` has a 2px `control-border` | Owner (#349)       | The memorable move: chunky pressable buttons; the lip is the only depth                                                                              |
| "To review", "timed out" and "fast" are plain text (with a glyph), never a pill                                          | Redesign           | A pill reads as a button; beside lip buttons it would read as one more                                                                               |
| Key hints hidden until the learner presses a key (`data-keys`, remembered in local storage)                              | Redesign           | A permanent "Space" on every button was noise for touch and mouse learners; whoever uses a key sees them from then on                                |
| `?` pauses, and the pause dialog lists the keys                                                                          | Redesign           | One place to learn the keys, reached by the key a keyboard user tries first                                                                          |
| A ○ turns the answer `good-ink`, and the progress bar advances                                                           | Owner (#349)       | Teal is ○; the answer is what the learner is looking at                                                                                              |
| Navigation is a left sidebar 240 wide from `pc` (1024) up, a top bar 56 tall below it                                    | Owner (#349)       | The common PC pattern (Duolingo, Linear, Meta AI); a top bar below 1024 needs no bottom inset and no height arithmetic                               |
| The navigation lists four sections, talk second: home, talk, records, settings                                           | Owner (#322, #349) | The talk activity is a hub of its own, reached like records and settings                                                                             |
| A focus layout — no navigation, ✕ at the top left, progress across the top — for the drill, the recap and a talk session | Owner (#349)       | Lessons drop the navigation (Duolingo, Quizlet, the Duolingo English Test); leaving mid-round stays one ✕ → "stop" away, which #267 needed           |
| Records and settings are one page each, with no in-page tabs and no `?tab=`                                              | Owner (#349)       | The tabs existed for a phone's no-scroll rule, which went with the phone; statistics and settings pages are single pages on a PC (NYT Games, Linear) |
| The ○ and × keys are the learner's setting, picked by pressing the key, stored as its `code`                             | Owner (#266)       | A key that never reached the app on one machine (#265) left nothing to switch to; a pressed key shows the picker what reaches it                     |
| The sound switch stays a lone tile at home's top right, and a row in settings                                            | Here               | Muting is wanted before a round; it reads the home view, so moving it into the shell would add a read to every screen                                |
| Definitions (what counts as mastered, how the streak counts) sit behind ⓘ                                                | Redesign           | Needed once, read never again; a permanent paragraph taxed every visit                                                                               |
| Secondary text is `ink-2`; `ink-disabled` only for disabled text                                                         | Owner (#349)       | `ink-2` measures at least 5.07:1 on every surface; `ink-disabled` is 2.4–2.7:1, exempt as disabled text                                              |
| PC first: content to 1120 (dashboards) or 720 (reading and forms), a focus stage to 880, one column below `pc`           | Owner (#349)       | The window is a laptop browser's; phones only need to keep working, because native apps will serve them, so nothing is phone-specific                |
| The violet is `action`, not shadcn's `primary`; `primary` is `ink`                                                       | Owner (#349)       | Registry controls paint on/selected with `primary`, and selection is ink, so a copy's checked state lands on the selection colour unedited           |
| `raised` is its own token; `secondary` and `muted` alias it                                                              | Here               | One name stops a screen choosing between three                                                                                                       |
| One shadow token, the lip; no `destructive` or `chart-*` token                                                           | Owner (#349)       | Cards are flat, so the lip is the only depth; red and a colour per series stay rejected, so a copy's classes for them generate nothing               |
| Tailwind's default palette, radii, sizes, shadows and animations cleared                                                 | Here               | Makes the lock partly mechanical: `bg-red-500`, `shadow-sm`, `animate-pulse` do nothing                                                              |
| `dark:` is Tailwind's own; a component writes none                                                                       | Owner (#349)       | Every token carries both themes' values, so a component styled with tokens is right in both; a copy's `dark:` classes are removed on the way in      |
| Every control has a hover state, under `@media (hover: hover)` (Tailwind v4's `hover:`)                                  | Owner (#349)       | Keyboard and mouse are equal on a PC; a touch screen never sees a hover it cannot leave                                                              |
| Sizes in rem at a 16px root                                                                                              | Here               | px values stay exact by default and scale with the browser's text size                                                                               |
| Focus is a global 2px outline in `focus` (`ink`), 2px offset, in the base layer                                          | Owner (#349)       | On every control and in both themes; one rule cannot be forgotten per component                                                                      |
| Reduced motion spares `data-motion="essential"`, and every celebration has a still form                                  | Owner (#349)       | The timer bar keeps shrinking under reduced motion; confetti and pops are decoration, so they go                                                     |
| A finished round, a streak that grew and a milestone are celebrated; confetti for the last two                           | Owner (#349)       | Excitement where it is earned, while a miss is never punished                                                                                        |
| `index.html` declares `color-scheme: light dark` and a `theme-color` per scheme (`#FFFCF2`, `#18171C`)                   | Owner (#349)       | Browser controls match the canvas in either theme before the stylesheet loads                                                                        |
| Signed out, `/` is a landing: the brand, a heading, the three steps, one sign-in link, and a static sample card beside   | Owner (#349)       | Two columns on a PC; the product's own face is the hero, so no illustration is needed                                                                |
| Sign-in is a link dressed as the `primary` button                                                                        | Here               | A full-page navigation to the managed login: a link says where it goes, and Space still presses it (`data-primary`)                                  |
| A path with no screen is the `empty-state` panel with one link home, and no navigation                                   | Owner (#349)       | It reads nothing, so a signed-out visitor meets it too; navigation would offer screens they cannot open                                              |
| Every sheet is a dialog, centered at every width, max 440                                                                | Owner (#349)       | A bar rising from the bottom of a PC window sits far from the screen it pauses                                                                       |

## References

Read the one the task needs; each records what is settled, not a proposal.

- [foundations.md](references/foundations.md) — the two-theme token map and each
  colour's job, not-colour-alone rules, the three families and the PC type scale, shape,
  the lip, hover, the layout system, and the measured contrast from
  [contrast-pairs.json](references/contrast-pairs.json).
- [components.md](references/components.md) — the component inventory and every recipe:
  the lip buttons, the shell (sidebar, top bar, skip link), the focus strip, the drill's
  card, bars, the streak and points, selection controls, home's tiles, the records and
  settings parts, dialog, toast, the confetti layer.
- [behavior.md](references/behavior.md) — motion, celebration and their reduced forms,
  the four sounds, keys and key hints, accessibility and the implementation rules
  (timing, pause on hide, the session day).

## Foundation

Tailwind v4 with no `tailwind.config.js`: the `@tailwindcss/vite` plugin in
`apps/web/vite.config.ts` is the whole of the build wiring, and the theme is CSS in
`apps/web/src/globals.css`. A component never carries a raw color, a one-off `px` type
size, or an arbitrary-value color.

- There is no `components.json` and no `@/` alias, so the shadcn CLI has nowhere to
  write. A registry component is copied by hand into `apps/web/src/ui/`, and its `@/…`
  imports become relative ones. Any package it needs is added to `apps/web` with
  `pnpm add` under the review `managing-dependencies` owns, and named in the web
  client's import row (`APP_NPM_EDGES` in `eslint.config.mjs`), or lint refuses it.
- A registry item may also carry CSS variables — even a `.dark` block. Leave them out; a
  new role goes into the palette by hand, with a light and a dark value.
- Rewrite the copy on the way in: `cn` from `../lib/utils`, `Slot` from
  `@radix-ui/react-slot`, an `interface` for the props and an explicit return type, a
  named export rather than a default one, then restyle it to its recipe —
  `hover:bg-accent` becomes `hover:bg-raised` (there is no `accent` token),
  `destructive`, `shadow-*` and `dark:` classes go, radii become `rounded-control`,
  `rounded-card`, `rounded-panel` or `rounded-full`. `apps/web/src/ui/button.tsx` is the
  worked example; its header comment records each departure from the registry copy.
- Prefer a registry component over a hand-rolled one. The reject list still applies to a
  component that ships inside a library.

## Tokens

- The shape is shadcn's: a plain custom property per color, mapped onto a utility by
  `@theme inline`, so one declaration drives every utility that reads it.
- Two themes: the light values on `:root`, the dark ones under
  `@media (prefers-color-scheme: dark)`, and `color-scheme: light dark`. A new color
  token gets both values and both contrast rows, or it is not done.
- A token declared directly in a plain `@theme` block is emitted only once some utility
  uses it, so `var()` against an unused one from hand-written CSS resolves to nothing.
  Declare such a block `@theme static` when raw CSS reads the tokens too.
- Never give a size token and a color token the same name: with both, a bare
  `text-<name>` always resolves to the color. `action` is the one name the design gives
  both, so the violet is declared under `--background-color-*` rather than `--color-*`:
  that makes `bg-action` and `bg-action-hover` and leaves `text-action` the type size.
- `twMerge` knows only Tailwind's default theme. `apps/web/src/lib/utils.ts` extends it
  with every size, radius, shadow and container name `globals.css` declares; a new one
  is added in both places, plus a `cn` case in `tests/web-ui-primitives.test.tsx`.
- The fonts are bundled from npm packages imported once by `apps/web/src/main.tsx` —
  nothing is fetched from a font host. `globals.css` names each family on `:root`, and
  `--font-sans`, `--font-latin` and `--font-display` read those. A fourth family is
  renegotiating the lock.
- Measure a new pair against WCAG contrast rather than estimating it: add it to
  `references/contrast-pairs.json` and paste the re-run into the foundations reference.

## Craft rules

- Preflight resets headings, links and margins. `globals.css` restores heading sizes and
  link underlines in `@layer base`, and deliberately does not restore a `<p>` margin:
  space with the container's `gap-*`, not with margins on the children.
- Tailwind v4's Preflight gives a button `cursor: default`; the base layer restores the
  pointer for enabled buttons. Keep that rule rather than adding `cursor-pointer`.
- Focus is visible on every control; never remove the outline to tidy a field.
- Every interactive part has a hover state, written with `hover:` — never a hover-only
  cue: whatever hover reveals, focus and touch reach too.
- Lint catches only a narrow slice of accessibility: the six jsx-a11y rules in
  `web/react-a11y` (`eslint.config.mjs`) check ARIA attributes, roles and `alt` text.
  What holds the rest of the rules in the behaviour reference is review, and the
  rendered tests that find a control by its role and accessible name.
- Motion is functional and short, celebration is earned, and `prefers-reduced-motion`
  switches each moment to its reduced form. No spinner and no pulsing skeleton,
  anywhere.
- Copy is a label, not an instruction. Before adding a line of explanation, ask what the
  screen would need to make it unnecessary; a definition someone needs once goes behind
  an `InfoTip`, a refusal is said when it happens (the last topic pressed off), not in
  advance.
- A key hint is a `Kbd` inside the control it presses, never a free-standing chip.
- PC first: one responsive layout, `pc` at 1024 wide, one column below it, no
  phone-specific code. Nothing scrolls sideways at any width.

## A screen with no precedent here

Do not extrapolate from taste. Add the part to the inventory in the components reference
first, built from existing tokens only, then research the surface the way the direction
was researched and adapt the findings to the lock rather than letting them relax it. If
a finding and the lock genuinely conflict, say so and let a human decide which gives way
— quietly softening the lock toward a safer middle is the failure this file guards
against. The user-level `refero-design` skill is the research method when it is
installed.
