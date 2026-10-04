# Foundations

Color, type, shape, space, layout and the measured contrast. Sizes are CSS px;
`globals.css` writes them in rem at a 16px root. The design's own names are in the first
column so a recipe can be looked up here.

## Color

The light values sit on `:root`, the dark ones under
`@media (prefers-color-scheme: dark)`; the property and the utility are the same in both
themes, so a component never writes `dark:`.

| Design name      | Light     | Dark      | Utility                                                 | Used for                                                                                     |
| ---------------- | --------- | --------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `canvas`         | `#FFFCF2` | `#18171C` | `bg-background`                                         | The page                                                                                     |
| `surface`        | `#FFFFFF` | `#222127` | `bg-card`, `bg-popover`                                 | Cards, panels, dialogs, the sidebar, the top bar, a secondary control's face                 |
| `raised`         | `#F6F1E3` | `#2C2B32` | `bg-raised` (`secondary` and `muted` alias it)          | Chips, key tiles, inner wells, a reach bar's or a ring's track, a secondary control's hover  |
| `border`         | `#E7E2D3` | `#3A3942` | `border-border`                                         | A card's or a panel's 2px border, hairlines between rows — decorative, no contrast floor     |
| `control-border` | `#8F8671` | `#7A7986` | `border-input`, `shadow-input`                          | A control's 2px border and its lip: a secondary button, a field, a select card, a ring ahead |
| `bar-track`      | `#2B2924` | `#2C2B32` | `bg-bar-track`                                          | The timer's and the round progress's track                                                   |
| `ink`            | `#2B2924` | `#F6F3EA` | `text-foreground`, `bg-foreground`, `border-foreground` | Text; a selected control's border; a reach bar's and a ring's fill; a switch's on track      |
| `ink-2`          | `#6B665A` | `#A9A6AF` | `text-muted-foreground`, `bg-muted-foreground`          | Secondary text, labels, the alternates; the new share of the mix bar; the 14-day bars        |
| `ink-disabled`   | `#ABA596` | `#5C5B64` | `text-disabled`                                         | Disabled text only (2.4–2.7:1, exempt) — never body text                                     |
| `action`         | `#6E00F5` | `#7B2BFF` | `bg-action`                                             | The one primary action's fill                                                                |
| `action-lip`     | `#4A00A8` | `#5212C9` | `shadow-action-lip`                                     | Its lip                                                                                      |
| `on-action`      | `#FFFFFF` | `#FFFFFF` | `text-on-action`                                        | Text on `action`                                                                             |
| `energy`         | `#FFC500` | `#FFC500` | `bg-energy`, `text-energy`                              | The streak, points, the timer's fill, the combo, celebration                                 |
| `energy-lip`     | `#D9A400` | `#C99A00` | `shadow-energy-lip`                                     | Its lip                                                                                      |
| `on-energy`      | `#2B2924` | `#2B2924` | `text-on-energy`                                        | Text, glyphs and outlines on or around `energy`                                              |
| `good`           | `#21C6A9` | `#2ED3B4` | `bg-good`                                               | The ○ button's fill; the round progress's fill                                               |
| `good-lip`       | `#12917B` | `#1E9C85` | `shadow-good-lip`                                       | Its lip                                                                                      |
| `on-good`        | `#2B2924` | `#2B2924` | `text-on-good`                                          | Text on `good`                                                                               |
| `good-ink`       | `#0E7A66` | `#2ED3B4` | `text-good-ink`, `bg-good-ink`                          | Teal text and marks: the fast mark, "−1.4 s", "+3", a reach bar's or a ring's grown segment  |
| `focus`          | `#2B2924` | `#F6F3EA` | `outline-ring` (applied globally)                       | The focus outline                                                                            |
| —                | `ink`     | `ink`     | `bg-primary` / `text-primary-foreground` (`surface`)    | shadcn's on/selected fill, so a registry control's checked state lands on the selection ink  |
| hover            | 8% white  | 8% white  | `bg-action-hover`, `bg-good-hover`                      | A filled control under the pointer: `color-mix(in oklab, <fill>, white 8%)`                  |

There is no `accent` token — shadcn's hover wash is `raised` here, and the old indicator
color is gone — and no `destructive`, `chart-*` or `ring-offset` token. `border` and
`ink-disabled` are decorative or exempt and carry no information a reader needs.

### Each colour's job

In review, count every `action`, `energy` and `good` reference in a diff and stop any
that falls outside its job.

1. **`action` (violet): the one primary action on a screen**, as a fill, never as text —
   start, next, one more round, continue, sign in. At most one per screen; ○ is not it.
2. **`energy` (yellow): energy** — the streak figure and its flame, points, the timer's
   fill, the combo, a week day done, celebration (confetti, the done screen's streak).
3. **`good` / `good-ink` (teal): ○ and what grew** — the ○ button, the round progress,
   the answer lit by a ○, the fast mark, "+3", "−1.4 s", a ring's or a reach bar's grown
   segment, a raised difficulty.
4. **`ink`: selection and focus** — a selected card's, chip's or navigation item's 2px
   border and check, a switch's on track, the focus outline.

Never in a colour: ×, a timeout, a weak point, "to review", an error — they are `ink` or
`ink-2`. Never red or pink, and never a colour per topic.

### Not by color alone

- The grades: position (× left, △ centre, ○ right), the `good` fill against a secondary
  face, the ✕ / △ / ○ glyph and the name. × and △ share the grey and differ by glyph and
  name.
- Timeout: the words "timed out" beside the return glyph.
- A filled example's answer: weight 800 and an underline, never only a colour.
- A grown segment (reach bar or ring): a 2px gap between it and the existing `ink` fill,
  plus a "+n" label.
- `energy` against the light `canvas`, `surface` or `raised` is far below 3:1, so it
  never carries information alone there: a done day is an `energy` disc with an
  `on-energy` check, the done screen's figure has a 6px `on-energy` outline, points and
  the combo are `on-energy` text on an `energy` chip, and the flame sits beside the
  figure it decorates.
- Week row: done (disc and check), today (a 3px `ink` ring), open (a 2px solid
  `control-border` ring), missed (a `raised` disc), ahead (a 2px dashed `control-border`
  ring) — each with its state in `sr-only` words and the weekday under it.
- Selection: a 2px `ink` border plus a check (cards, chips), `aria-current` plus a 2px
  `ink` border (the navigation's current item), the knob's side plus the `ink` track (a
  switch).
- Sound off: the speaker's waves become a ×, and the accessible name says "off".
- The mix bar: each share has a swatch and its count in words beside it.
- After a broken streak: "day 1 from today" in words — never "0 days in a row".

## Type

| Role                      | Family                                                                   | Weights  |
| ------------------------- | ------------------------------------------------------------------------ | -------- |
| Japanese UI and cards     | `font-sans`: M PLUS Rounded 1c, then Hiragino Sans, Noto Sans JP, system | 500, 800 |
| Latin UI and answers      | `font-latin`: Nunito                                                     | 700, 800 |
| Figures and Latin display | `font-display`: Fredoka                                                  | 600, 700 |

M PLUS Rounded 1c loads by unicode-range subsets, so a screen fetches only the glyphs it
shows, and today's system stack stands behind it while it loads. Nothing is monospaced.
A figure that changes in place — the timer's seconds, "7 / 10", the combo — is tabular
(`tabular-nums`), or sits in a fixed-width box where the family has no tabular figures,
so counting never shifts a digit.

| Token        | Family  | Size | Line height | Tracking | Weight | Used for                                                  |
| ------------ | ------- | ---- | ----------- | -------- | ------ | --------------------------------------------------------- |
| `eyebrow`    | latin   | 13   | 1.2         | 0.05em   | 800    | The uppercase Latin legend above a figure or a block      |
| `label`      | sans    | 13   | 1.4         | 0        | 800    | Units, section titles, statuses, a figure's Japanese name |
| `caption`    | sans    | 13   | 1.5         | 0        | 500    | Weekday labels, subtopic lines, a one-line note           |
| `count`      | latin   | 15   | 1.2         | 0        | 800    | Progress, counters, durations, deadlines (tabular)        |
| `body`       | sans    | 16   | 1.6         | 0        | 500    | Body text, `text` buttons, talk lines, every text field   |
| `point`      | sans    | 18   | 1.6         | 0        | 500    | The prompt and the key point on a card's back             |
| `action`     | sans    | 16   | 1.25        | 0        | 800    | Button text, select-card titles, navigation items         |
| `heading`    | sans    | 26   | 1.3         | 0        | 800    | Screen headings, dialog titles, panel titles              |
| `front`      | sans    | 36   | 1.45        | 0        | 800    | The Japanese prompt on a card's front                     |
| `front-long` | sans    | 30   | 1.5         | 0        | 800    | The same prompt past 48 characters                        |
| `answer`     | latin   | 30   | 1.3         | 0        | 800    | The model answer                                          |
| `alt`        | latin   | 18   | 1.45        | 0        | 700    | Alternate answers                                         |
| `figure-sm`  | display | 24   | 1.0         | 0        | 600    | Seconds left, seconds to flip, tile figures, the combo    |
| `number-md`  | display | 44   | 1.0         | 0        | 600    | Today's size, growth counts, the records figures row      |
| `number-lg`  | display | 72   | 0.95        | 0        | 700    | The streak on home's tile, the streak on the summary      |
| `number-xl`  | display | 132  | 0.9         | 0        | 700    | The done screen's streak figure                           |

`front-long` starts past 48 characters: the 880 stage holds about 24 characters a line
at 36, so the full size keeps a prompt to two lines, where 36 characters suited the old
420 column. The threshold lives beside the component (`FRONT_LONG_AFTER`).

Write the family beside the size for the Latin and display rows:
`text-answer font-latin`, `text-number-xl font-display`,
`text-eyebrow font-latin uppercase` (the `Eyebrow` component does this). English
passages carry `lang="en"` so a screen reader voices them in English.

## Shape and depth

| Item                                                          | Value                                                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Controls: buttons, fields, select cards, key tiles, icons     | 16 (`rounded-control`)                                                                        |
| Cards and tiles: home's panels, records' cards, `empty-state` | 16 (`rounded-card`)                                                                           |
| Large panels: the drill's card, a dialog                      | 20 (`rounded-panel`)                                                                          |
| Chips, navigation items, bars, rings, week discs, switches    | pill (`rounded-full`)                                                                         |
| Border                                                        | 2px (`border-2`): `border` on a card, `control-border` on a control                           |
| Button height                                                 | 52 (`h-13`); `text` button 44 (`h-11`)                                                        |
| Minimum hit target                                            | 44 × 44                                                                                       |
| The lip                                                       | `shadow-lip`: `0 4px 0 <lip>`, coloured by `shadow-<lip token>` — the one shadow token        |
| Pressed                                                       | `translateY(4px)` and the lip gone (`active:translate-y-1 active:shadow-none`); never a scale |

Cards are flat: a 2px `border` and no shadow, so the lip is the only depth. A control
that carries a lip reserves the lip's 4px under it, so pressing never moves its
neighbours.

**Hover**, only where the device can hover — Tailwind v4's `hover:` sits under
`@media (hover: hover)` already, so it needs no guard of its own: a filled control's
fill goes 8% lighter (`bg-action-hover`, `bg-good-hover`); a secondary control, a select
card, a navigation item or a row link takes the `raised` fill; a `text` button and a
link turn `text-foreground`. A hover never moves anything and never reveals what focus
and touch cannot reach. Focus stays the global 2px outline at a 2px offset, in `focus`.

## Space and layout

| Item                   | Value                                                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base unit              | 4 (Tailwind's own spacing scale)                                                                                                                                                                                                       |
| Breakpoints            | `pc`: `width >= 64rem` (1024), width only. `sm`: 640, for the top bar's labels and two-across cards. No other                                                                                                                          |
| Shell, `pc`            | Sidebar 240, fixed, full height, left. Content beside it: padding 32 top, 40 sides, 48 bottom                                                                                                                                          |
| Shell, below `pc`      | Top bar 56, sticky. Content padding 24 (16 below 640)                                                                                                                                                                                  |
| Content widths         | Dashboard pages (home, records, a round's summary): max 1120, centered in the content area. Reading and form pages (settings' rows, talk start, welcome): max 720                                                                      |
| Focus layout           | No sidebar, no top bar. Top strip 64: ✕ at the left (44 × 44), progress centered (max 560), counters at the right. Stage max 880, centered; its content group is vertically centered in `100dvh − 64` and the page scrolls when taller |
| Grid                   | 12 columns, 24 gutters, inside the content width; one column below `pc`                                                                                                                                                                |
| Panel padding          | 24 (`p-6`); a tile 20 (`p-5`)                                                                                                                                                                                                          |
| Between blocks         | 24, the grid's gutter; a section inside a card 24 above and below a hairline                                                                                                                                                           |
| Dialog                 | Centered at every width, max 440, over the scrim                                                                                                                                                                                       |
| Toast                  | Bottom center of the viewport, 24 up; in the shell, centered on the content area                                                                                                                                                       |
| Which screens use what | Shell: home, talk start, records, settings; the sign-in page with the brand alone. Focus: all of `/drill` (start, card, done, error), `/recap`, the talk session. Neither: the landing, the welcome, a path with no screen             |

One layout route renders the shell's navigation once; a screen renders its content only,
in the one `main`. The navigation appears only once a read has said who is signed in —
home's skeleton and `/drill`'s wait show none.

The actions sit directly under the content they act on — the grade trio and the timer
under the drill's card, at most 560 wide; a summary's actions under its hero, inside the
first view — never pinned to the window's bottom edge, where a tall window would set
them far from what they act on. A screen sizes itself from its content and `100dvh`,
never from a per-screen height sum. Below `pc` every grid falls to one column in reading
order, and the same layout serves a phone's browser; phone-specific code goes only where
behavior.md's "Phone browsers" lists it, and nothing scrolls sideways at any width.

## Contrast

Measured with the WCAG 2.x relative-luminance formula by `check_contrast.py` from the
user-level `ui-ux-designing` skill. Text needs 4.5:1; a control border, a fill that
carries data, a figure's outline and the focus outline need 3:1. The pairs are in
[contrast-pairs.json](contrast-pairs.json); re-run from the repository root after any
token or recipe change and paste the output here unedited. Run it bare first: it exits 0
only when every pair passes. The `sed` then drops the trailing spaces the script pads
its last column with, which Prettier would trim anyway.

```sh
python3 ~/.claude/skills/ui-ux-designing/scripts/check_contrast.py \
  .agents/skills/designing-ui/references/contrast-pairs.json | sed 's/ *$//'
```

```text
name                                                      fg       bg       kind  ratio  required  result
--------------------------------------------------------  -------  -------  ----  -----  --------  ------
light text: ink on canvas                                 #2B2924  #FFFCF2  text  14.15  4.50      PASS
light text: ink on surface                                #2B2924  #FFFFFF  text  14.53  4.50      PASS
light text: ink on raised                                 #2B2924  #F6F1E3  text  12.88  4.50      PASS
light text: ink-2 on canvas                               #6B665A  #FFFCF2  text  5.57   4.50      PASS
light text: ink-2 on surface                              #6B665A  #FFFFFF  text  5.72   4.50      PASS
light text: ink-2 on raised                               #6B665A  #F6F1E3  text  5.07   4.50      PASS
light text: on-action on action                           #FFFFFF  #6E00F5  text  7.04   4.50      PASS
light text: on-energy on energy                           #2B2924  #FFC500  text  9.16   4.50      PASS
light text: on-good on good                               #2B2924  #21C6A9  text  6.72   4.50      PASS
light text: good-ink on canvas                            #0E7A66  #FFFCF2  text  5.12   4.50      PASS
light text: good-ink on surface                           #0E7A66  #FFFFFF  text  5.26   4.50      PASS
light text: good-ink on raised                            #0E7A66  #F6F1E3  text  4.66   4.50      PASS
light figure outline: on-energy around energy, on canvas  #2B2924  #FFFCF2  ui    14.15  3.00      PASS
light ui: control-border on canvas                        #8F8671  #FFFCF2  ui    3.52   3.00      PASS
light ui: control-border on surface                       #8F8671  #FFFFFF  ui    3.61   3.00      PASS
light ui: control-border on raised                        #8F8671  #F6F1E3  ui    3.20   3.00      PASS
light ui: selected ink border on canvas                   #2B2924  #FFFCF2  ui    14.15  3.00      PASS
light ui: selected ink border on surface                  #2B2924  #FFFFFF  ui    14.53  3.00      PASS
light ui: selected ink border on raised                   #2B2924  #F6F1E3  ui    12.88  3.00      PASS
light ui: switch on, surface knob on ink track            #FFFFFF  #2B2924  ui    14.53  3.00      PASS
light ui: focus on canvas                                 #2B2924  #FFFCF2  ui    14.15  3.00      PASS
light ui: focus on surface                                #2B2924  #FFFFFF  ui    14.53  3.00      PASS
light ui: focus on raised                                 #2B2924  #F6F1E3  ui    12.88  3.00      PASS
light data: timer energy on bar-track                     #FFC500  #2B2924  ui    9.16   3.00      PASS
light data: progress good on bar-track                    #21C6A9  #2B2924  ui    6.72   3.00      PASS
light data: bar-track on canvas                           #2B2924  #FFFCF2  ui    14.15  3.00      PASS
light data: reach ink fill on raised                      #2B2924  #F6F1E3  ui    12.88  3.00      PASS
light data: grew good-ink on raised                       #0E7A66  #F6F1E3  ui    4.66   3.00      PASS
light data: ink-2 bar (mix bar, 14-day chart) on surface  #6B665A  #FFFFFF  ui    5.72   3.00      PASS
light data: week check on-energy on energy                #2B2924  #FFC500  ui    9.16   3.00      PASS
light data: week today ink ring on surface                #2B2924  #FFFFFF  ui    14.53  3.00      PASS
light data: week ahead control-border ring on surface     #8F8671  #FFFFFF  ui    3.61   3.00      PASS
light hover: on-action on action hover #7636F8            #FFFFFF  #7636F8  text  5.75   4.50      PASS
light hover: on-good on good hover #45CBB0                #2B2924  #45CBB0  text  7.21   4.50      PASS
light hover: secondary ink on raised                      #2B2924  #F6F1E3  text  12.88  4.50      PASS
light hover: secondary control-border on raised           #8F8671  #F6F1E3  ui    3.20   3.00      PASS
dark text: ink on canvas                                  #F6F3EA  #18171C  text  16.06  4.50      PASS
dark text: ink on surface                                 #F6F3EA  #222127  text  14.39  4.50      PASS
dark text: ink on raised                                  #F6F3EA  #2C2B32  text  12.63  4.50      PASS
dark text: ink-2 on canvas                                #A9A6AF  #18171C  text  7.44   4.50      PASS
dark text: ink-2 on surface                               #A9A6AF  #222127  text  6.66   4.50      PASS
dark text: ink-2 on raised                                #A9A6AF  #2C2B32  text  5.85   4.50      PASS
dark text: on-action on action                            #FFFFFF  #7B2BFF  text  5.78   4.50      PASS
dark text: on-energy on energy                            #2B2924  #FFC500  text  9.16   4.50      PASS
dark text: on-good on good                                #2B2924  #2ED3B4  text  7.67   4.50      PASS
dark text: good-ink on canvas                             #2ED3B4  #18171C  text  9.42   4.50      PASS
dark text: good-ink on surface                            #2ED3B4  #222127  text  8.44   4.50      PASS
dark text: good-ink on raised                             #2ED3B4  #2C2B32  text  7.40   4.50      PASS
dark text: energy figure on canvas                        #FFC500  #18171C  text  11.24  4.50      PASS
dark ui: control-border on canvas                         #7A7986  #18171C  ui    4.16   3.00      PASS
dark ui: control-border on surface                        #7A7986  #222127  ui    3.73   3.00      PASS
dark ui: control-border on raised                         #7A7986  #2C2B32  ui    3.27   3.00      PASS
dark ui: selected ink border on canvas                    #F6F3EA  #18171C  ui    16.06  3.00      PASS
dark ui: selected ink border on surface                   #F6F3EA  #222127  ui    14.39  3.00      PASS
dark ui: selected ink border on raised                    #F6F3EA  #2C2B32  ui    12.63  3.00      PASS
dark ui: switch on, surface knob on ink track             #222127  #F6F3EA  ui    14.39  3.00      PASS
dark ui: focus on canvas                                  #F6F3EA  #18171C  ui    16.06  3.00      PASS
dark ui: focus on surface                                 #F6F3EA  #222127  ui    14.39  3.00      PASS
dark ui: focus on raised                                  #F6F3EA  #2C2B32  ui    12.63  3.00      PASS
dark data: timer energy on bar-track                      #FFC500  #2C2B32  ui    8.83   3.00      PASS
dark data: progress good on bar-track                     #2ED3B4  #2C2B32  ui    7.40   3.00      PASS
dark data: reach ink fill on raised                       #F6F3EA  #2C2B32  ui    12.63  3.00      PASS
dark data: grew good-ink on raised                        #2ED3B4  #2C2B32  ui    7.40   3.00      PASS
dark data: ink-2 bar (mix bar, 14-day chart) on surface   #A9A6AF  #222127  ui    6.66   3.00      PASS
dark data: week check on-energy on energy                 #2B2924  #FFC500  ui    9.16   3.00      PASS
dark data: week today ink ring on surface                 #F6F3EA  #222127  ui    14.39  3.00      PASS
dark data: week ahead control-border ring on surface      #7A7986  #222127  ui    3.73   3.00      PASS
dark hover: on-action on action hover #8348FF             #FFFFFF  #8348FF  text  4.84   4.50      PASS
dark hover: on-good on good hover #4DD7BA                 #2B2924  #4DD7BA  text  8.13   4.50      PASS
dark hover: secondary ink on raised                       #F6F3EA  #2C2B32  text  12.63  4.50      PASS
dark hover: secondary control-border on raised            #7A7986  #2C2B32  ui    3.27   3.00      PASS
```

- The hover fills are `color-mix(in oklab, <fill>, white 8%)`, resolved to the hex in
  the pair's name. The tightest text pair is light `good-ink` on `raised` (4.66); the
  tightest hover pair is white on the dark theme's `action` hover (4.84). There is no
  `energy`-filled control, so `energy` has no hover pair.
- Not measured, on purpose: a filled button's fill against the page (its label
  identifies it, so WCAG 1.4.11 sets no floor), `border` (decorative), the dark
  `bar-track` against the canvas (the fill against the track is what carries the data),
  `energy` against the light page (never alone, see "Not by color alone") and
  `ink-disabled` (disabled text, exempt; it would fail the run).
- The focus outline is held 2px off the control, so it sits against `canvas`, `surface`
  or `raised`, never against a filled control.
