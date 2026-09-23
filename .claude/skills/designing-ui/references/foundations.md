# Foundations

Color, type, space, shape, layout and the measured contrast. Sizes are CSS px as the
spec states them; `globals.css` writes them in rem at a 16px root. The spec's own names
are in the first column so a recipe quoted from it can be looked up here.

## Color

Dark only — there is no light column.

| Spec name        | Value     | Property on `:root` | Utility                                        | Used for                                                                     |
| ---------------- | --------- | ------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `canvas`         | `#000000` | `--canvas`          | `bg-background`                                | The page, including outside the column on a wide window                      |
| `surface`        | `#171717` | `--surface`         | `bg-card`, `bg-popover`                        | Cards, sheets, the blocks of the summary screen                              |
| `raised`         | `#232323` | `--raised`          | `bg-raised` (`secondary` and `muted` alias it) | One step up inside a card: alternates block, a selected card, chips, presses |
| `hairline`       | `#333333` | `--hairline`        | `border-border`, `bg-border`                   | Dividers, ring and bar grooves, the timer groove, a missed day's dot         |
| `text/primary`   | `#FDFDFD` | `--ink`             | `text-foreground`, `bg-foreground`             | Body, headings, figures, ring and bar fills, a done day's dot                |
| `text/secondary` | `#9A9A9A` | `--ink-secondary`   | `text-muted-foreground`, `border-input`        | Supporting text, labels, a secondary button's border, the history bars       |
| `text/review`    | `#C8C8C8` | `--ink-review`      | `text-review`                                  | The text of the "to review" chip                                             |
| `text/disabled`  | `#6F6F6F` | `--ink-disabled`    | `text-disabled`                                | Disabled text only — never body text                                         |
| `accent`         | `#A6FF00` | `--accent`          | `bg-accent`, `text-accent`, `border-accent`    | The four roles below, and nothing else                                       |
| `on-accent`      | `#040126` | `--on-accent`       | `text-accent-foreground`                       | Text on an accent fill                                                       |
| `focus`          | `#FDFDFD` | `--focus`           | `outline-ring` (applied globally)              | The focus outline                                                            |
| —                | —         | —                   | `bg-primary` / `text-primary-foreground`       | White on/selected fill with black on it (segmented, toggle track)            |
| —                | 92% mix   | —                   | `bg-accent-pressed`                            | The primary button while pressed                                             |
| —                | 35% mix   | `--accent-glow`     | inside `shadow-glow`                           | The rim light's blur                                                         |

`bg-foreground` is white as data (a ring fill, a done dot); `bg-primary` is white as a
control's on or selected state. `hairline` and `text/disabled` are decorative and carry
no information a reader needs.

### The four accent roles

Use the accent for these and nothing else. In review, count every `accent` reference in
a diff and stop any that falls outside them.

1. **Said it (○).** The ○ button, the rim light when it is pressed, the "fast n.n s"
   chip.
2. **The primary action.** The one `primary` button a screen carries (start, next, one
   more round).
3. **A running indicator.** The timer bar's fill and the combo count.
4. **What grew this session.** "+3", "+20 pt"; the streak dots earned in this session
   (today's, and yesterday's when it was made up) and a streak number that grew; a
   ring's new segment; a raised difficulty line; a milestone card's border.

Never for: ×, timeout, review, headings, decoration, backgrounds, selection (white),
focus (white), errors. When making up yesterday, only the dots and streak number that
this session earned are accent; the ring marking a day that can still be made up is
white.

### Not by color alone

- ○ and ×: position (× left, ○ right), fill versus outline, and the label.
- Timeout: the word "timed out" and the "to review" chip.
- A ring's new segment: a 2px gap between it and the existing white fill, plus a "+n"
  label — accent against white is only 1.22:1, so the boundary is a gap, not a hue.
- Week dots: filled (done), ring plus the "open" caption under the weekday (can still be
  made up), dark dot (missed), and the weekday label.
- A selected topic chip: white border plus a check mark.
- Sound off: a slash through the note icon, and the accessible name says "off".
- After a broken streak: "day 1 from today" in words — never "0 days in a row".

## Type

| Role                    | Family                                                              | Weights       |
| ----------------------- | ------------------------------------------------------------------- | ------------- |
| Japanese UI and cards   | `font-sans`: Hiragino Sans, Hiragino Kaku Gothic ProN, Noto Sans JP | 400, 600      |
| English and big figures | `font-latin`: Inter (loaded by `src/app/fonts.ts`), system-ui       | 400, 500, 600 |
| Mono figures            | `font-mono`: ui-monospace, SF Mono, JetBrains Mono                  | 500, 700      |

Every figure is tabular: `body` sets `tabular-nums`, so counting up never shifts a
digit.

| Token        | Family | Size | Line height | Tracking | Weight | Used for                                  |
| ------------ | ------ | ---- | ----------- | -------- | ------ | ----------------------------------------- |
| `caption`    | sans   | 12   | 1.4         | 0        | 400    | Weekday labels, small notes               |
| `label`      | sans   | 13   | 1.4         | 0        | 600    | Labels, section titles, chips             |
| `body`       | sans   | 15   | 1.6         | 0        | 400    | Body text, `text` buttons                 |
| `point`      | sans   | 14   | 1.6         | 0        | 400    | The key point on a card's back            |
| `action`     | sans   | 16   | 1.4         | 0        | 600    | `primary` and `secondary` button text     |
| `heading`    | sans   | 21   | 1.3         | 0        | 600    | Screen headings                           |
| `front`      | sans   | 24   | 1.5         | 0        | 600    | The Japanese prompt on a card's front     |
| `front-long` | sans   | 20   | 1.5         | 0        | 600    | The same prompt when it runs past 2 lines |
| `answer`     | latin  | 22   | 1.4         | -0.01em  | 500    | The model answer                          |
| `alt`        | latin  | 16   | 1.5         | 0        | 400    | Alternate answers                         |
| `mono-sm`    | mono   | 13   | 1.2         | -0.02em  | 500    | Progress, key hints, time deltas          |
| `mono-md`    | mono   | 20   | 1.0         | -0.02em  | 700    | Seconds left, seconds to flip             |
| `number-md`  | latin  | 36   | 1.1         | -0.023em | 600    | Combo, growth counts                      |
| `number-lg`  | latin  | 64   | 1.0         | -0.017em | 600    | Streak, sentences mastered                |

Write the family beside the size for the Latin and mono rows: `text-answer font-latin`,
`text-mono-md font-mono`. A front prompt holds at most three lines at `front-long`;
content longer than that is not generated. English passages carry `lang="en"` so a
screen reader voices them in English.

## Space, shape, layout

| Item                                     | Value                                              |
| ---------------------------------------- | -------------------------------------------------- |
| Base unit                                | 4 (Tailwind's own spacing scale)                   |
| Column                                   | `max-w-column` (420), centered; canvas outside it  |
| Side gutter                              | 16 (`px-4`) below 452 wide                         |
| Card padding                             | 24 (`p-6`)                                         |
| Between elements                         | 16 (`gap-4`)                                       |
| Between blocks (summary screen)          | 40 (`gap-10`)                                      |
| Card radius                              | 28 (`rounded-card`)                                |
| Small surface radius (alternates, tiles) | 16 (`rounded-tile`)                                |
| Buttons, chips, toggles                  | pill (`rounded-full`)                              |
| Button height                            | 56 (`h-14`); `text` button 44 (`h-11`)             |
| Minimum hit target                       | 44 × 44                                            |
| Shadow                                   | None. Depth is canvas / surface / raised           |
| Border                                   | 1.5px (`border-[1.5px]`), only where a recipe says |

The page shell is one element:
`mx-auto box-content flex min-h-dvh max-w-column flex-col px-4` — `box-content` keeps
the 420 for content while the gutter sits outside it.

Vertical order on every screen: the main actions (start, flip, ○/×, next) sit in the
bottom third, where a thumb reaches, on a PC too; pause, settings and close sit at the
top edge. The card screen is fixed top to bottom — top strip (pause, progress, combo) →
card → timer bar → actions — and never scrolls as a page; a back that does not fit
scrolls inside the card.

## Contrast

Measured with the WCAG 2.x relative-luminance formula. Text needs 4.5:1; a control
border, a fill that carries data, and the focus outline need 3:1; decorative pairs have
no floor.

| Pair                                                 | Ratio                 | Floor | Result                                      |
| ---------------------------------------------------- | --------------------- | ----- | ------------------------------------------- |
| `text/primary` on canvas / surface / raised          | 20.65 / 17.62 / 15.45 | 4.5   | pass                                        |
| `text/secondary` on canvas / surface / raised        | 7.46 / 6.37 / 5.59    | 4.5   | pass                                        |
| `text/review` on raised / surface                    | 9.39 / 10.72          | 4.5   | pass                                        |
| accent text on canvas / surface / raised             | 16.93 / 14.45 / 12.67 | 4.5   | pass                                        |
| `on-accent` on accent                                | 16.31                 | 4.5   | pass                                        |
| `on-accent` on `accent-pressed` (`#99EB00`)          | 13.72                 | 4.5   | pass                                        |
| black on white (segmented, `primary`)                | 20.65                 | 4.5   | pass                                        |
| `text/secondary` border on canvas / surface / raised | 7.46 / 6.37 / 5.59    | 3.0   | pass                                        |
| focus outline on canvas / surface                    | 20.65 / 17.62         | 3.0   | pass                                        |
| white fill on hairline groove                        | 12.42                 | 3.0   | pass                                        |
| accent fill on hairline groove                       | 10.18                 | 3.0   | pass                                        |
| done dot (white) on canvas                           | 20.65                 | 3.0   | pass                                        |
| ring's new segment against existing white            | 1.22                  | 3.0   | fail — shown by a 2px gap and "+n", not hue |
| missed dot (hairline) on canvas                      | 1.66                  | —     | decorative                                  |
| `text/disabled` on canvas / surface / raised         | 4.18 / 3.57 / 3.13    | —     | disabled text, exempt                       |
| skeleton (raised) on canvas                          | 1.34                  | —     | decorative                                  |

The focus outline is held 2px off the control, so it sits against the canvas or surface,
never against an accent fill (white on accent is 1.22:1).
