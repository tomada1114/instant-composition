# Foundations

Color, type, space, shape, layout and the measured contrast. Sizes are CSS px;
`globals.css` writes them in rem at a 16px root. The design's own names are in the first
column so a recipe can be looked up here.

## Color

Dark only — there is no light column.

| Design name      | Value     | Property on `:root` | Utility                                        | Used for                                                                      |
| ---------------- | --------- | ------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `canvas`         | `#0A0A0B` | `--canvas`          | `bg-background`                                | The page, including outside the column on a wide window; the drill's "card"   |
| `surface`        | `#141416` | `--surface`         | `bg-card`, `bg-popover`                        | The home panel, tiles, icon tiles, sheets, selection cards, unselected chips  |
| `raised`         | `#1E1E21` | `--raised`          | `bg-raised` (`secondary` and `muted` alias it) | A `secondary` button, a press on a surface, the toast, an inline notice       |
| `hairline`       | `#26262A` | `--hairline`        | `border-border`, `bg-border`                   | Rules, grooves (ticks, timer, bars, rings), a missed day, a pressed secondary |
| `text/primary`   | `#F4F4F2` | `--ink`             | `text-foreground`, `bg-foreground`             | Body, headings, figures, ring and bar fills, a done day                       |
| `text/secondary` | `#939396` | `--ink-secondary`   | `text-muted-foreground`, `border-input`        | Labels, supporting text, eyebrows, the new-cards share of the mix bar         |
| `text/soft`      | `#CFCFCD` | `--ink-soft`        | `text-soft`                                    | Alternate answers on a card's back                                            |
| `text/disabled`  | `#5C5C60` | `--ink-disabled`    | `text-disabled`                                | Disabled text only — never body text                                          |
| `accent`         | `#B8FF2C` | `--accent`          | `bg-accent`, `text-accent`, `border-accent`    | The four roles below, and nothing else                                        |
| `on-accent`      | `#0A0A0B` | `--on-accent`       | `text-accent-foreground`                       | Text on an accent fill                                                        |
| `focus`          | `#F4F4F2` | `--focus`           | `outline-ring` (applied globally)              | The focus outline                                                             |
| —                | —         | —                   | `bg-primary` / `text-primary-foreground`       | White on/selected fill with black on it (segmented, toggle, chips, checks)    |
| —                | 92% mix   | —                   | `bg-accent-pressed`                            | The primary button while pressed                                              |

`bg-foreground` is white as data (a ring fill, a done day); `bg-primary` is white as a
control's on or selected state. `hairline` and `text/disabled` are decorative and carry
no information a reader needs.

### The four accent roles

Use the accent for these and nothing else. In review, count every `accent` reference in
a diff and stop any that falls outside them.

1. **Said it (○).** The ○ button; the answer and the current tick lit when it is
   pressed; the "fast n.n s" mark.
2. **The primary action.** The one `primary` button a screen carries (start, next, one
   more round, continue).
3. **A running indicator.** The timer bar's fill and the combo count.
4. **What grew this session.** "+3", "+20 pt"; the day bar earned in this session and a
   streak number that grew; a ring's new segment; today's grown share of the 14-day
   chart; a raised difficulty line; a milestone card's border.

Never for: ×, timeout, review, headings, eyebrows, decoration, backgrounds, selection
(white), focus (white), errors. The drill's flip button is `secondary`, so on a front
the only lime is the timer.

### Not by color alone

- ○ and ×: position (× left, ○ right), fill versus raised, the ○ / ✕ glyph and the
  label.
- Timeout: the words "timed out · to review" beside the return glyph.
- A ring's new segment: a 2px gap between it and the existing white fill, plus a "+n"
  label — accent against white is only 1.10:1, so the boundary is a gap, not a hue.
- Week bars: filled (done), white outline (open, can still be made up), dark fill
  (missed), dashed hairline (upcoming), each with its state in `sr-only` words and the
  weekday under it.
- Selection: a white border plus a filled white check (cards), a white fill plus a check
  (chips).
- Sound off: the speaker's waves become a ×, and the accessible name says "off".
- The mix bar: each share has a swatch and its count in words beside it.
- After a broken streak: "day 1 from today" in words — never "0 days in a row".

## Type

| Role                  | Family                                                              | Weights       |
| --------------------- | ------------------------------------------------------------------- | ------------- |
| Japanese UI and cards | `font-sans`: Hiragino Sans, Hiragino Kaku Gothic ProN, Noto Sans JP | 400, 600, 700 |
| English answers       | `font-latin`: Inter Tight                                           | 400, 600      |
| Figures               | `font-display`: Space Grotesk                                       | 600           |
| Labels and counters   | `font-mono`: JetBrains Mono                                         | 500           |

The three Latin families are loaded by `src/app/fonts.ts`. Every figure is tabular:
`body` sets `tabular-nums`, so counting up never shifts a digit.

| Token        | Family  | Size | Line height | Tracking | Weight | Used for                                               |
| ------------ | ------- | ---- | ----------- | -------- | ------ | ------------------------------------------------------ |
| `eyebrow`    | mono    | 11   | 1.2         | 0.14em   | 500    | The tracked uppercase legend above a figure or a block |
| `caption`    | sans    | 12   | 1.4         | 0        | 400    | Weekday labels, subtopic lines, tile names             |
| `label`      | sans    | 13   | 1.4         | 0        | 600    | Units, section titles, statuses                        |
| `mono-sm`    | mono    | 13   | 1.2         | 0        | 500    | Progress, counters, durations, deadlines               |
| `body`       | sans    | 15   | 1.6         | 0        | 400    | Body text, `text` buttons                              |
| `point`      | sans    | 14   | 1.7         | 0        | 400    | The prompt and the key point on a card's back          |
| `action`     | sans    | 16   | 1.4         | 0        | 700    | Button text, selection-card titles                     |
| `heading`    | sans    | 22   | 1.35        | 0        | 700    | Screen headings, intro steps, sheet titles             |
| `front`      | sans    | 28   | 1.55        | 0.01em   | 700    | The Japanese prompt on a card's front                  |
| `front-long` | sans    | 23   | 1.55        | 0.01em   | 700    | The same prompt past 36 characters                     |
| `answer`     | latin   | 26   | 1.25        | -0.02em  | 600    | The model answer                                       |
| `alt`        | latin   | 16   | 1.45        | 0        | 400    | Alternate answers                                      |
| `figure-sm`  | display | 22   | 1.0         | -0.02em  | 600    | Seconds left, seconds to flip, tile figures, the combo |
| `number-md`  | display | 44   | 1.0         | -0.03em  | 600    | Today's size, a portion's progress, growth counts      |
| `number-lg`  | display | 72   | 0.9         | -0.04em  | 600    | The streak on the summary                              |
| `number-xl`  | display | 128  | 0.86        | -0.05em  | 600    | The streak on the start screen                         |

Write the family beside the size for the Latin, display and mono rows:
`text-answer font-latin`, `text-number-xl font-display`,
`text-eyebrow font-mono uppercase` (the `Eyebrow` component does this). English passages
carry `lang="en"` so a screen reader voices them in English.

## Space, shape, layout

| Item                                        | Value                                                             |
| ------------------------------------------- | ----------------------------------------------------------------- |
| Base unit                                   | 4 (Tailwind's own spacing scale)                                  |
| Column                                      | `max-w-column` (420), centered; canvas outside it                 |
| Side gutter                                 | 16 (`px-4`) below 452 wide                                        |
| Panel padding                               | 20 (`p-5`); a tile 16 (`p-4`)                                     |
| Between blocks                              | 40 (`gap-10`); summary sections are 32 above and below a hairline |
| Panel radius (home panel, sheet, milestone) | 28 (`rounded-card`)                                               |
| Button radius                               | 18 (`rounded-control`)                                            |
| Tile, selection card, alternates            | 16 (`rounded-tile`)                                               |
| Icon tile                                   | 12 (`rounded-icon`)                                               |
| Week bar                                    | 8 (`rounded-bar`)                                                 |
| Chips, toggles, ticks, grooves              | pill (`rounded-full`)                                             |
| Button height                               | 60 (`h-15`); `text` button 44 (`h-11`)                            |
| Minimum hit target                          | 44 × 44                                                           |
| Shadow                                      | None. Depth is canvas / surface / raised                          |
| Border                                      | 1.5px (`border-[1.5px]`), only where a recipe says                |

Vertical order on every screen: the main actions (start, flip, ○/×, next) sit in the
bottom third, where a thumb reaches, on a PC too; pause, navigation and close sit at the
top edge. The card screen is fixed top to bottom — ticks and top strip (pause, progress,
combo) → the face → timer bar → actions — and never scrolls as a page; a back that does
not fit scrolls inside its own area.

## Contrast

Measured with the WCAG 2.x relative-luminance formula (`check_contrast.py` from the
user-level `ui-ux-designing` skill). Text needs 4.5:1; a control border, a fill that
carries data, and the focus outline need 3:1; decorative pairs have no floor.

| Pair                                           | Ratio                 | Floor | Result                                      |
| ---------------------------------------------- | --------------------- | ----- | ------------------------------------------- |
| `text/primary` on canvas / surface / raised    | 17.97 / 16.71 / 15.10 | 4.5   | pass                                        |
| `text/secondary` on canvas / surface / raised  | 6.46 / 6.01 / 5.43    | 4.5   | pass                                        |
| `text/soft` on canvas / raised                 | 12.68 / 10.66         | 4.5   | pass                                        |
| accent text on canvas / surface                | 16.38 / 15.23         | 4.5   | pass                                        |
| `on-accent` on accent                          | 16.38                 | 4.5   | pass                                        |
| `on-accent` on `accent-pressed` (`#A9EB28`)    | 13.76                 | 4.5   | pass                                        |
| black on white (segmented, chips, `primary`)   | 17.97                 | 4.5   | pass                                        |
| `text/secondary` as a border on canvas         | 6.46                  | 3.0   | pass                                        |
| focus outline on canvas                        | 17.97                 | 3.0   | pass                                        |
| white fill on hairline groove                  | 13.69                 | 3.0   | pass                                        |
| accent fill on hairline groove                 | 12.47                 | 3.0   | pass                                        |
| open-day outline (white) on canvas             | 17.97                 | 3.0   | pass                                        |
| ring's new segment against existing white      | 1.10                  | 3.0   | fail — shown by a 2px gap and "+n", not hue |
| hairline (missed day, upcoming dash) on canvas | 1.31                  | —     | decorative; the state is also in words      |
| `text/disabled` on canvas                      | 2.97                  | —     | disabled text, exempt                       |

The focus outline is held 2px off the control, so it sits against the canvas or surface,
never against an accent fill.
