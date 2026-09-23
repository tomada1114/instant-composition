# Components

Every part a screen may use, and its values. Build nothing outside this inventory: when
a screen needs a new part, add it here first, built from existing tokens only. Quoted
labels are English glosses of the UI copy; the copy itself belongs in `messages/ja.json`
(`localizing-ui`). Colors are written as utilities — the foundations reference maps them
to the design's names.

## Inventory

| Part                      | Variants                                                   | States                                                                         |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `button`                  | `primary` (accent fill), `secondary` (raised fill), `text` | default, focus, pressed, disabled                                              |
| `kbd`                     | `side`: `end` (default), `start`                           | hidden until the learner has pressed a key (`keys:` variant)                   |
| `icon-button`             | tile (default), `plain`                                    | default, focus, pressed; sound adds `aria-pressed`                             |
| `eyebrow`                 | —                                                          | —                                                                              |
| `grade-pair`              | — (× and ○ side by side)                                   | default, focus, pressed; only on a back the learner flipped                    |
| `drill-face`              | `front`, `back-self`, `back-timeout`                       | with or without the "again" mark; during the ○ light                           |
| `ticks`                   | —                                                          | done, current, current lit (○), upcoming; absent past 30 cards                 |
| `timer-bar`               | —                                                          | running; at 0 (fill gone)                                                      |
| `progress`                | —                                                          | "7 / 10" in mono; during the retry round "again 2 / 3"                         |
| `streak-counter`          | — (combo)                                                  | shown from 2; disappears when broken                                           |
| `home-panel`              | ready, in progress, done, recover, not enough, load failed | —                                                                              |
| `mix-bar`                 | —                                                          | review and new shares, either may be 0                                         |
| `chip/choice`             | — (focus subtopic)                                         | unselected, selected (white fill + check), disabled (at the limit)             |
| `select-card`             | —                                                          | unselected, selected (white border + filled check), locked (the last one kept) |
| `segmented`               | — (5 / 10 / 15 / 20 / 30 cards a day)                      | one selected                                                                   |
| `toggle`                  | —                                                          | on, off                                                                        |
| `ring-stack`              | `concentric` (up to 4 topics), `grid` (all 5)              | with a new segment, without, empty (grooves + one line)                        |
| `week-row`                | —                                                          | done, done today, open (can be made up), missed, upcoming                      |
| `dot-calendar`            | — (last 12 weeks)                                          | the `week-row` states, without the accent                                      |
| `stat`                    | `xl`, `lg`, `md`, `tile`                                   | grew this session, unchanged, after a break ("day 1 from today")               |
| `growth-list`             | —                                                          | faster, × → ○, sent to review, empty; "see all" open/closed                    |
| `disclosure` + `bar-list` | —                                                          | closed, open (a topic's breakdown on the record screen)                        |
| `bar-chart`               | — (last 14 days)                                           | today's bar grew, unchanged                                                    |
| `milestone-card`          | —                                                          | only in the session that reached it; stacked when several                      |
| `milestone-list`          | —                                                          | some earned, none ("none yet")                                                 |
| `difficulty-line`         | `up`, `down`, `same`                                       | —                                                                              |
| `info-tip`                | —                                                          | closed, open                                                                   |
| `sheet`                   | `pause`, `confirm`                                         | —                                                                              |
| `toast`                   | —                                                          | shown for 4 s                                                                  |
| `inline-notice`           | —                                                          | unsaved records; gone once sent                                                |
| `skeleton`                | —                                                          | when the start screen takes over 300 ms                                        |
| `empty-state`             | —                                                          | not enough cards; cards could not be loaded                                    |

There is no status chip. "To review", "timed out", "again" and "fast" are text with a
glyph: a pill reads as something to press.

## Button

| Variant     | Face        | Text                                 | Used for                                           |
| ----------- | ----------- | ------------------------------------ | -------------------------------------------------- |
| `primary`   | `bg-accent` | `text-accent-foreground text-action` | One per screen, led on by → (`PrimaryButton`); ○   |
| `secondary` | `bg-raised` | `text-foreground text-action`        | ×, flip, "one more" beside a primary, "stop"       |
| `text`      | transparent | `text-muted-foreground text-body`    | "see all", "see the summary →", "count from today" |

- Height 60 (`text`: 44), 18 radius (`rounded-control`), no border, width set by the
  caller (`w-full`, half of a pair). `relative`, so a `kbd` pins to it.
- Pressed: `primary` darkens 8% (`bg-accent-pressed`); `secondary` becomes `bg-border`;
  `text` turns `text-foreground`. Never scale a button.
- Disabled: `primary` becomes `bg-raised text-disabled`; the others `text-disabled`.
- No hover style: the listed states are complete, and a hover-only cue does not reach a
  touch screen.

`src/components/ui/button.tsx` is this recipe.

## Key hint (`kbd`)

A 20-tall pill, 1px border and text in `currentColor` at 45% opacity, `eyebrow` mono
with normal tracking, pinned 14 from one edge of its control. Hidden until `<html>`
carries `data-keys`, which `src/components/lib/key-mode.tsx` sets on the first key press
and remembers in local storage; `aria-hidden` always. A "←" hint sits at the start edge,
every other at the end. Never a free-standing chip, and never shown to a learner who has
only touched the screen.

## Icon button, eyebrow

- `icon-button`: 44 × 44, 12 radius, a 20 glyph in `text-foreground` on `bg-card`;
  pressed `bg-raised`. `plain` drops the tile (the drill's pause). The caller names it
  (`aria-label`); sound carries `aria-pressed`. Home's top right is sound, records
  (bars), settings (gear); a sub-screen's top left is ← back.
- `eyebrow`: `font-mono text-eyebrow uppercase text-muted-foreground`, above a figure or
  a block ("Streak", "Today", "Placement", "Welcome"). Decorative when the figure beside
  it already has a Japanese name: then `aria-hidden`.

Glyphs are drawn in `src/components/ui/glyphs.tsx` on a 20 grid, 1.75 strokes, round
ends. There is no icon library.

## Grade pair

× on the left (`secondary`, ✕ glyph, "not yet", hint "←" at the start), ○ on the right
(`primary`, ○ glyph, "said it", hint "→" at the end), half the width each with a 10 gap.
Shown only on a back the learner flipped; a timed-out back shows a single `primary`
"next" instead.

## Drill faces

There is no card box: each face sits on the canvas and fills the space between the top
strip and the timer (or the actions).

| Face           | Contents, top to bottom                                                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `front`        | an `eyebrow` "again" with the return glyph on a retry → the prompt (`front`, left-aligned, `text-balance`), centred in the space with 48 extra below; the whole area flips on a press                                                                                                                        |
| `back-self`    | the whole prompt (`point`, muted, wrapped — never truncated) → the model answer (`answer`) → the alternates as a list between hairlines (`alt`, `text-soft`, 12 above and below each) → the key point (`point`, muted, led by a white "point" `label`) → seconds to flip at the right (`figure-sm`, "2.8 s") |
| `back-timeout` | as `back-self`, with the return glyph and "timed out · to review" (`label`, muted) in place of the seconds                                                                                                                                                                                                   |

- A ○ turns the answer `text-accent` (160 ms) and lights the current tick; a × fades the
  answer to `text-muted-foreground`.
- A fast ○ shows "fast 2.1 s" in `figure-sm text-accent` rising into place.
- When a back does not fit, only its area scrolls; the top strip and the actions stay
  fixed. The last 32px fades to the canvas (decoration only). ↑/↓ scroll it; ←/→ are the
  grades and never scroll.

## Ticks, progress and timer bar

| Item   | Value                                                                                                                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ticks  | One per card of the pass across the column, 3 tall, 4 apart, pill: done `bg-foreground`, current `bg-muted-foreground` (`bg-accent` while its ○ shows), upcoming `bg-border`. Omitted past 30 cards |
| Strip  | Under the ticks, 44 tall: pause (`plain` icon button) left, progress in `mono-sm` muted centre, combo right                                                                                         |
| Combo  | From 2: the count in `figure-sm` + "in a row" in `mono-sm`, both `text-accent`                                                                                                                      |
| Timer  | Directly above the actions: a 4-tall pill groove `bg-border`, fill `bg-accent` shrinking linearly from the limit to 0; the whole seconds left, rounded up, at its right in `figure-sm`              |
| At 0   | The fill is gone and the figure reads "0". The color never changes — never red                                                                                                                      |
| Limit  | 4 s + 0.5 s × English word count, rounded up, clamped to 6–20 s (6 words → 7, 12 → 10, 20 → 14, 28 → 18)                                                                                            |
| Motion | The fill carries `data-motion="essential"` so reduced motion does not freeze it (it may step once a second)                                                                                         |

The limit formula is a starting value, tuned by use: keep it in configuration, not in
the component.

## Home panel and mix bar

The start screen is three stacked zones: the top bar (brand `eyebrow` left, icon tiles
right), the streak block centred in the free space (`eyebrow` "Streak", the figure in
`number-xl`, the week row), and one `bg-card rounded-card p-5` panel at the bottom that
carries the state and its one primary action.

| State       | Panel contents                                                                                                                                                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ready       | `eyebrow` "Today"; the size in `number-md` + "sentences" and "about n min" in `mono-sm` at the right; the mix bar; a short-day line; start                                                                                                                             |
| in progress | the portion's name (`label`, muted); "4 / 10" in `number-md`; a 6-tall white-on-hairline progress bar; resume                                                                                                                                                          |
| done        | a white check disc + "done for today" (`heading`), "2 rounds · 20 sentences" in `mono-sm`; "see the summary →" (`text`) at the top right; one more — or, while yesterday can still be made up, a line, the deadline, "make up yesterday" and "one more" as `secondary` |
| recover     | one line, both sizes and the time in `mono-sm`, the deadline; "do yesterday's too"; "count from today" (`text`)                                                                                                                                                        |
| not enough  | `heading`, one muted line with the count, "widen the range" (`secondary`, to settings)                                                                                                                                                                                 |
| load failed | `heading`, "load again" (`secondary`, the screen's primary key)                                                                                                                                                                                                        |

`mix-bar`: a 6-tall split — the review share `bg-foreground`, the new share
`bg-muted-foreground`, 2 apart — over a `caption` row: a swatch and "review 4", a swatch
and "new 6", and "focus: meetings" when a focus is set.

## Chips and selection controls

`chip/choice` (a pressable focus subtopic in settings): 36 tall, 14 across, pill, with
the hit area grown by 4 above and below to 44; rows 8 apart so hit areas just touch.

| State      | Face         | Text                                 | Mark        |
| ---------- | ------------ | ------------------------------------ | ----------- |
| unselected | `bg-card`    | `text-foreground text-label`         | none        |
| selected   | `bg-primary` | `text-primary-foreground text-label` | check, left |
| disabled   | `bg-card`    | `text-disabled text-label`           | none        |

- `select-card`: `bg-card`, 16 radius, 72 tall at least; the title in `action`, the
  subtopics in one truncated muted `caption` line; a 24 disc at the right — hairline
  ring unselected, white fill with a black check selected, plus a white 1.5px border.
  Never the accent. `locked` (the last topic kept) keeps the selected look and refuses
  the press with `aria-disabled`; the refusal is said on the press, in a `status` line.
- Focus subtopics use `chip/choice`. The section heading carries "1 / 2" in `mono-sm` at
  its right; at the limit every unselected chip turns `text-disabled` and stops
  accepting presses.
- `segmented`: track `bg-card`, 18 radius, 4 inset; the selected segment is
  `bg-primary text-primary-foreground` at 16 radius, figures in
  `font-display text-action`.
- `toggle`: 52 × 32; on is a `bg-primary` track with a black knob at the right; off a
  `bg-raised` track with a grey knob at the left. No "on"/"off" words: position and fill
  carry the state, and the switch role says it.
- Settings rows without a control of their own (sound, difficulty) sit between
  hairlines, 64 tall, name left and control right.

## Progress rings (`ring-stack`)

| Item         | Value                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stroke       | 10, rings 6 apart; groove `hairline`                                                                                                                 |
| Fill         | `foreground`: progress from the last milestone to the next (137 → 37 of the 100–200 step; 58 → 8 of the 50–100 step); restarts at 0 past a milestone |
| New segment  | `accent`, with a 2px gap from the existing fill                                                                                                      |
| Label        | Right of each ring: topic name (`label`, muted) + mastered count (`figure-sm`); this session's growth as "+3" in `text-accent`                       |
| Order        | Outermost first, in the order of the chosen topics                                                                                                   |
| `concentric` | Up to 4 topics, diameter 200                                                                                                                         |
| `grid`       | All 5 topics: single rings of diameter 72, 2 columns × 3 rows, label to the right, rows 16 apart, about 250 tall                                     |
| Milestones   | 10 / 25 / 50 / 100 mastered, then every 100 — the same steps as the milestone cards                                                                  |
| Empty        | Grooves only, with one muted "0 so far" line; what counts as mastered is the ⓘ beside the section title                                              |

## Streak (`week-row` + `stat`)

- On the start screen the figure is `number-xl` with "days in a row" (`label`, muted)
  beside its baseline; on the summary it is `number-lg`, `text-accent` when this session
  added today's or yesterday's day, `text-foreground` otherwise.
- Seven bars Monday to Sunday across the column, 36 tall, 8 radius, 6 apart, each over a
  `caption` weekday.

| State                                                              | Look                               |
| ------------------------------------------------------------------ | ---------------------------------- |
| done (a made-up day looks the same)                                | `bg-foreground`                    |
| done today — earned in this session, including a made-up yesterday | `bg-accent`                        |
| open — yesterday, until today's cut-off                            | 1.5px `foreground` outline, hollow |
| missed — a broken day or an expired open day                       | `bg-border`                        |
| upcoming                                                           | 1px dashed `border-border`         |

- Each bar's state is also in `sr-only` words. No grace allowance and no "n left" line.
  How the streak counts is one ⓘ on the record screen.
- Yesterday open (start screen): the figure is the streak up to the day before,
  `text-foreground`, with one `body` line that yesterday is open.
- After a break: never "0 days". A `heading` "day 1 from today" with the longest streak
  in muted `mono-sm`; once today's set is done the summary shows "1" in `number-lg`,
  `text-accent`.
- Streak milestones: 7 / 14 / 30 / 60 / 100 / 200 / 365 days, then every 100 from 400.

## Summary screen parts

The summary is a header (close ✕ at the top right on a live summary, ← at the top left
on a re-read; the title in `heading` under it) and sections separated by hairlines, 32
above and below each. Section titles are muted `label`s.

| Part               | Value                                                                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stat/md`          | Figure (`number-md`, `font-display`) + name (`label`); only this session's growth is `text-accent`                                                                                             |
| `growth-list`      | Per row, between hairlines: the prompt (one line, truncated) and the delta at the right ("−1.2 s", "× → ○" in `mono-sm`). First 3 rows, then a `text` button "see all". Rows are not pressable |
| "see all" opened   | Opens in place below, the button becomes "close" (`aria-expanded`); never a new screen; up to 30 rows. The bottom buttons stay fixed                                                           |
| No growth          | No big figure: one muted `body` line — how many were compared, "no change" — and one for first-time sentences                                                                                  |
| Review             | Title with the count in `figure-sm` at its right, then the prompts as a `growth-list` with nothing at the row's end. Nothing to review: one muted line with the count 0                        |
| `bar-chart`        | Sentences said, last 14 days. Pill bars 8 wide, 6 apart, 48 tall at most: `bg-muted-foreground`, and only today's growth `bg-accent`                                                           |
| `difficulty-line`  | `up`: the new level plus "↑", the whole line in `text-accent`, lit once. `down`: the same with "↓", `text-muted-foreground`, no motion. `same`: not shown                                      |
| `milestone-card`   | `bg-card`, 28 radius, 1.5px `border-accent`, an `eyebrow` "title" over the name (`heading`). Only in the session that reached it; never shown twice, never withdrawn                           |
| Milestone names    | A number and its subject only ("100 in daily life", "30 days in a row"); no milestone for the overall total                                                                                    |
| Several milestones | Stacked 16 apart, streak first then topic order, each 150 ms after the last                                                                                                                    |
| Points             | "+20 pt" (`figure-sm`, `text-accent`) + the total in muted `mono-sm`. One point per card of a completed session, +10 when it completes the day's set (including yesterday's)                   |
| Placement          | The first placement leads with a `bg-card` panel: "difficulty" (`label`, muted) over "starting around TOEIC n" (`heading`)                                                                     |
| `inline-notice`    | `bg-raised rounded-tile`, padding 12 / 16, the ⓘ-style notice glyph, a white `body` line with the unsaved count, a `text` button "resend" at the right. Never red                              |
| Heading variants   | Yesterday's set: its own "done" heading. Re-reading today's summary: a "today's summary" heading, ← top left, no bottom buttons, no count-up — the session's accent stays                      |

## Sheet, info tip, toast, empty, skeleton

- `sheet`: rises from the bottom; `bg-popover`, top corners `rounded-t-card`, a 70%
  canvas scrim behind, 28 above its title and 24 between blocks. Buttons stack
  vertically with the main action at the bottom. The pause sheet lists the drill's keys
  between a hairline and its buttons — only in keys mode.
- `info-tip`: a 44 hit area around a 16 ⓘ glyph beside a section title; pressing it
  opens one muted `caption` line under the title in place (`aria-expanded`). For a
  definition someone needs once: what counts as mastered, how the streak counts.
- `toast`: 24 above the bottom edge; `bg-raised rounded-tile`, `text-foreground`, the
  notice glyph; gone after 4 s. Never red. No success toast, ever.
- `empty-state`: a `bg-card rounded-card` panel with a `heading`, at most one muted line
  and one `secondary` button.
- `skeleton`: after 300 ms of start-screen loading, `bg-card` blocks the size of the
  figure, the week and the panel, each with its part's radius. No text, no spinner, no
  pulsing.

## Record screen parts

The record screen: ← and "records" (`heading`); the rings with ⓘ and each topic's
disclosure; the stat tiles; the calendar with ⓘ; the milestones. Nothing is lit.

| Part             | Value                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disclosure`     | One 48-tall row over a hairline: "topic breakdown" (`body`) with a chevron at the right in `text-muted-foreground`, turned to point right when closed; `aria-expanded`                                                          |
| `bar-list`       | Under an open disclosure. Per row: subtopic (`caption`, muted), a bar, the count (`mono-sm`, right-aligned). Bar 6 tall, pill, groove `hairline`, fill `foreground`, relative to the topic's largest. No percentages, no accent |
| `stat/tile`      | `bg-card rounded-tile p-4`: the name in muted `caption`, the figure in `figure-sm`, an optional `eyebrow`-sized note ("longest 21 days"). Streak and difficulty two across; said, days and points three across                  |
| `dot-calendar`   | Last 12 weeks, one column per week (oldest left), rows Monday to Sunday. Dots 12 across, 6 apart. The `week-row` states with a solid hairline ring for upcoming, but never the accent — nothing grows here                      |
| `milestone-list` | A muted `label` title, then per row the subject (`label`, muted) and the milestones earned ("7 · 14 · 30", `mono-sm`, white). Streak first, then topic order. Empty: "none yet", muted `body`                                   |
