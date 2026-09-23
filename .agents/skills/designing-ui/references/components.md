# Components

Every part a screen may use, and its values. Build nothing outside this inventory: when
a screen needs a new part, add it here first, built from existing tokens only. Quoted
labels are English glosses of the UI copy; the copy itself belongs in `messages/ja.json`
(`localizing-ui`). Colors are written as utilities — the foundations reference maps them
to the spec's names.

## Inventory

| Part                      | Variants                                               | States                                                                        |
| ------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `button`                  | `primary` (accent fill), `secondary` (outline), `text` | default, focus, pressed, disabled                                             |
| `grade-pair`              | — (× and ○ side by side)                               | default, focus, pressed; only on a back the learner flipped                   |
| `flashcard`               | `front`, `back-self`, `back-timeout`                   | with or without the "again" mark; during the ○ rim light                      |
| `timer-bar`               | —                                                      | running; at 0 (fill gone)                                                     |
| `progress`                | —                                                      | "7 / 10" in mono; during the retry round "again 2 / 3"                        |
| `streak-counter`          | — (combo)                                              | shown from 2; disappears when broken                                          |
| `chip`                    | `review`, `speed`, `again`, `kbd`                      | —                                                                             |
| `chip/choice`             | — (focus subtopic)                                     | unselected, selected (white border + check), disabled (at the limit)          |
| `select-card`             | —                                                      | unselected, selected (check + raised + white border), disabled (at the limit) |
| `segmented`               | — (5 / 10 / 15 / 20 / 30 cards a day)                  | one selected                                                                  |
| `toggle`                  | —                                                      | on, off (the words "on"/"off" shown too)                                      |
| `icon-button`             | `sound`, `close`                                       | sound on/off (slash); close; both focus and pressed                           |
| `ring-stack`              | `concentric` (up to 4 topics), `grid` (all 5)          | with a new segment, without, empty (grooves + one line)                       |
| `week-row`                | —                                                      | done, done today, open (can be made up), missed, upcoming                     |
| `dot-calendar`            | — (last 12 weeks)                                      | the `week-row` states, without the accent                                     |
| `stat`                    | `lg`, `md`                                             | grew this session, unchanged, after a break ("day 1 from today")              |
| `growth-list`             | —                                                      | faster, × → ○, sent to review, empty; "see all" open/closed                   |
| `disclosure` + `bar-list` | —                                                      | closed, open (a topic's breakdown on the record screen)                       |
| `bar-chart`               | — (last 14 days)                                       | today's bar grew, unchanged                                                   |
| `milestone-card`          | —                                                      | only in the session that reached it; stacked when several                     |
| `milestone-list`          | —                                                      | some earned, none ("none yet")                                                |
| `difficulty-line`         | `up`, `down`, `same`                                   | —                                                                             |
| `sheet`                   | `pause`, `confirm`                                     | —                                                                             |
| `toast`                   | —                                                      | shown for 4 s                                                                 |
| `inline-notice`           | —                                                      | unsaved records (top of the summary); gone once sent                          |
| `skeleton`                | —                                                      | when the start screen takes over 300 ms                                       |
| `empty-state`             | —                                                      | not enough cards                                                              |

## Button

| Variant     | Face        | Text                                 | Border               | Used for                            |
| ----------- | ----------- | ------------------------------------ | -------------------- | ----------------------------------- |
| `primary`   | `bg-accent` | `text-accent-foreground text-action` | none                 | One per screen. The ○ button is one |
| `secondary` | transparent | `text-foreground text-action`        | 1.5px `border-input` | ×, "finish", redoing a grade        |
| `text`      | transparent | `text-muted-foreground text-body`    | none                 | "record", "settings", "not now"     |

- Height 56 (`text`: 44), pill radius, width set by the caller (`w-full`, half of a
  pair).
- Pressed: `primary` darkens 8% (`bg-accent-pressed`); `secondary` fills with
  `bg-raised`; `text` turns `text-foreground`. Never scale a button up or down.
- Disabled: `primary` becomes `bg-raised text-disabled`; the others turn `text-disabled`
  (and the border `border-disabled`).
- No hover style: the listed states are complete, and a hover-only cue does not reach a
  touch screen.
- On a PC, a `chip/kbd` sits at the button's end ("Space", "→"). Not on touch devices.

`src/components/ui/button.tsx` is this recipe.

## Grade pair

× on the left (`secondary`, "← couldn't say it"), ○ on the right (`primary`, "said it
→"), half the width each with a 12 gap. Shown only on a back the learner flipped; a
timed-out back shows a single `primary` "next" instead.

## Flashcard

| Face           | Contents, top to bottom                                                                                                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `front`        | `chip/again` when it is a retry → the prompt (`front`, left-aligned) → space                                                                                                                                                                       |
| `back-self`    | the prompt (`body`, muted, one line, truncated) → the model answer (`answer`) → an alternates block (`bg-raised rounded-tile`, 2–3 lines of `alt`) → the key point (`point`, muted, led by a "point" label) → seconds to flip (`mono-md`, "2.8 s") |
| `back-timeout` | as `back-self`, with "timed out" (`label`) and `chip/review` in place of the seconds                                                                                                                                                               |

- `bg-card rounded-card p-6`, no shadow.
- Fills the rest of the column (minimum 280); front and back are the same height.
- When a back does not fit: only the card scrolls, vertically; the top strip and the
  grade pair (or "next") stay fixed. The last 24px fades from transparent to `surface`
  (decoration only). ↑/↓ scroll the card; ←/→ are the grades and never scroll. The worst
  case — a 28-word answer and three alternates of the same length — is about 730 tall,
  about 880 with the screen around it: a tall PC window usually fits it, a phone does
  not.

## Timer bar

| Item     | Value                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------- |
| Position | Directly under the card, the card's width                                                                |
| Bar      | 6 tall, pill; groove `bg-border`; fill `bg-accent`, shrinking linearly from the limit to 0               |
| Figure   | Seconds left to its right in `mono-md`, rounded up ("5", "4" …), no unit                                 |
| At 0     | The fill is gone and the figure reads "0". The color never changes — never red                           |
| Limit    | 4 s + 0.5 s × English word count, rounded up, clamped to 6–20 s (6 words → 7, 12 → 10, 20 → 14, 28 → 18) |
| Motion   | Carries `data-motion="essential"` so reduced motion does not freeze it (it may step once a second)       |

The limit formula is a starting value, tuned by use: keep it in configuration, not in
the component.

## Chips

| Variant  | Face        | Text                                           | Border                | Label                        |
| -------- | ----------- | ---------------------------------------------- | --------------------- | ---------------------------- |
| `review` | `bg-raised` | `text-review text-label`                       | none                  | "to review"                  |
| `speed`  | transparent | `text-accent`, `label` + `mono-sm`             | 1.5px `border-accent` | "fast 2.1 s"                 |
| `again`  | `bg-raised` | `text-muted-foreground text-label`             | none                  | "again"                      |
| `kbd`    | transparent | `text-muted-foreground text-mono-sm font-mono` | 1px `border-border`   | Space, ←, →, ↑, ↓, F, J, Esc |

28 tall, 12 horizontal padding, pill.

`chip/choice` (a pressable focus subtopic in settings): 36 tall, 12 padding, pill, with
the hit area grown by 4 above and below to 44; rows 8 apart so hit areas just touch.
Wraps in rows — at most 37 when every topic is chosen.

| State      | Face        | Text                         | Border                    | Mark               |
| ---------- | ----------- | ---------------------------- | ------------------------- | ------------------ |
| unselected | `bg-raised` | `text-foreground text-label` | none                      | none               |
| selected   | `bg-raised` | `text-foreground text-label` | 1.5px `border-foreground` | white check, right |
| disabled   | `bg-raised` | `text-disabled text-label`   | none                      | none               |

## Selection controls

- `select-card`: `bg-card`, no border unselected; selected is `bg-raised`, a 1.5px white
  border and a white check at the right end. Never the accent.
- Focus subtopics use `chip/choice`. At the limit of two, every unselected chip turns
  `text-disabled` and stops accepting presses, and one line says the limit is two.
- `segmented`: track `bg-raised`; the selected segment is `bg-primary` with
  `text-primary-foreground`.
- `toggle`: on is a `bg-primary` track with a black knob; off is a `bg-raised` track
  with a 1.5px `border-input` border and a grey knob. The words "on"/"off" sit to its
  right.

## Icon button

| Variant | Look                                                                    | Accessible name                                   |
| ------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| `sound` | ♪ in `text-foreground`; off adds a 1.5px slash. The color never changes | "sound effects on" / "off", with `aria-pressed`   |
| `close` | ✕ in `text-foreground`                                                  | "pause" on the card screens, "close" on a summary |

Hit area 44 × 44, glyph 20. Pressed shows a 44 `bg-raised` circle behind the glyph.

## Progress rings (`ring-stack`)

| Item         | Value                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stroke       | 10, rings 6 apart; groove `hairline`                                                                                                                 |
| Fill         | `foreground`: progress from the last milestone to the next (137 → 37 of the 100–200 step; 58 → 8 of the 50–100 step); restarts at 0 past a milestone |
| New segment  | `accent`, with a 2px gap from the existing fill                                                                                                      |
| Label        | Right of each ring: topic name + mastered count; this session's growth as "+3" in `text-accent`                                                      |
| Order        | Outermost first, in the order of the chosen topics                                                                                                   |
| `concentric` | Up to 4 topics, diameter 200                                                                                                                         |
| `grid`       | All 5 topics: single rings of diameter 72, 2 columns × 3 rows, label to the right, rows 16 apart, about 250 tall                                     |
| Milestones   | 10 / 25 / 50 / 100 mastered, then every 100 — the same steps as the milestone cards                                                                  |
| Empty        | Grooves only, with one muted `body` line under them saying mastered sentences are counted here                                                       |

## Streak (`week-row` + `stat/lg`)

- The figure is `number-lg` plus a "days in a row" `label`. It is `text-accent` when
  this session added today's or yesterday's day, `text-foreground` otherwise.
- Seven dots Monday to Sunday, 12 across and 16 apart, each over a `caption` weekday.

| State                                                              | Look                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| done (a made-up day looks the same)                                | `foreground` fill                                                                                      |
| done today — earned in this session, including a made-up yesterday | `accent` fill                                                                                          |
| open — yesterday, until today's cut-off                            | 1.5px `foreground` ring, hollow, plus an "open" `caption` under the weekday in `text-muted-foreground` |
| missed — a broken day or an expired open day                       | `hairline` fill                                                                                        |
| upcoming                                                           | 1px `hairline` ring                                                                                    |

- No grace allowance and no "n left" line under the row. The counting rule is one line
  at the bottom of the record screen, not in settings.
- Yesterday open (start screen): the figure is the streak up to the day before,
  `text-foreground`, with one `body` line that yesterday is open; under the row, a muted
  line that doing yesterday's set keeps the streak and a white line with both sets'
  sizes and time.
- After a break: never "0 days". A `heading` "day 1 from today" with a muted `caption`
  for the longest streak; once today's set is done the summary shows "1" in `number-lg`,
  `text-accent`.
- Streak milestones: 7 / 14 / 30 / 60 / 100 / 200 / 365 days, then every 100 from 400.

## Summary screen parts

| Part               | Value                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stat/md`          | Figure (`number-md`) + name (`label`); only this session's growth is `text-accent`                                                                                                        |
| `growth-list`      | Per row: the prompt (one line, truncated) and the delta at the right ("−1.2 s" in `mono-sm`, "× → ○" in `label`). First 3 rows, then a `text` button "see all". Rows are not pressable    |
| "see all" opened   | Opens in place below, the button becomes "close" (`aria-expanded`); never a new screen; up to 30 rows. The bottom buttons stay fixed                                                      |
| No growth          | No big figure: two muted `body` lines — how many were compared, and that they will be compared next time. A mixed session adds a line counting the first-time sentences                   |
| Nothing to review  | No list, one `body` line with the count 0. Never a `number-md` 0                                                                                                                          |
| `bar-chart`        | Sentences said, last 14 days. Bars `bg-muted-foreground`, and only today's growth `bg-accent`. 48 tall, bars 8 wide, 6 apart                                                              |
| `difficulty-line`  | `up`: the new level plus "↑", the whole line in `text-accent`, lit once. `down`: the same with "↓", `text-muted-foreground`, no motion. `same`: not shown                                 |
| `milestone-card`   | `bg-card`, 1.5px `border-accent`, name (`heading`) + what it marks (`caption`). Only in the session that reached it; never shown twice, never withdrawn if the count later drops          |
| Milestone names    | A number and its subject only ("100 in daily life", "30 days in a row"); no milestone for the overall total                                                                               |
| Several milestones | Stacked 16 apart, streak first then topic order, each 150 ms after the last                                                                                                               |
| Points             | "+20 pt" (`text-accent`, `mono-md`) + the total (`caption`). One point per card of a completed session, +10 when it completes the day's set (including yesterday's)                       |
| `inline-notice`    | Top of the summary: `bg-raised rounded-tile`, padding 12 / 16, a white "!" glyph, a white `body` line with the unsaved count, a `text` button "resend" at the right. Never red            |
| Heading variants   | Yesterday's set: its own "done" heading. Re-reading today's summary: a "today's summary" heading, a `text` "← back" top left, no bottom buttons, no count-up — the session's accent stays |

## Sheet, toast, empty, skeleton

- `sheet`: rises from the bottom; `bg-popover`, top corners `rounded-t-card`, a 60%
  black scrim behind. Buttons stack vertically with the main action at the bottom.
- `toast`: 16 above the bottom buttons; `bg-raised`, `text-foreground`, a white "!"
  glyph; gone after 4 s. Never red. No success toast, ever.
- `empty-state`: a `bg-card` card where the flashcard would be, with a `heading`, one
  `body` line and one `secondary` button.
- `skeleton`: after 300 ms of start-screen loading, `bg-raised` blocks the size of the
  figures, the week row and the button, each with its part's radius. No text, no
  spinner, no pulsing.

## Record screen parts

| Part             | Value                                                                                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disclosure`     | One 44-tall row: topic name (`body`, `text-foreground`) + "breakdown", with ▾ (open) / ▸ (closed) in `text-muted-foreground` at the right; `aria-expanded`                                                            |
| `bar-list`       | Under an open disclosure. Per row: subtopic (`body`), a bar, the count (`mono-sm`, right-aligned). Bar 8 tall, pill, groove `hairline`, fill `foreground`, relative to the topic's largest. No percentages, no accent |
| `dot-calendar`   | Last 12 weeks, one column per week (oldest left), rows Monday to Sunday. Dots 10 across, 4 apart (164 wide). The `week-row` states, but never the accent — nothing grows here                                         |
| `milestone-list` | A `label` title, then per row the subject (`label`, muted) and the milestones earned ("7 · 14 · 30", `body`, white, tabular). Streak first, then topic order. Empty: "none yet", muted `body`                         |
