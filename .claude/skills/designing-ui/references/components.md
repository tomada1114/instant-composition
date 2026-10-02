# Components

Every part a screen may use, and its values. Build nothing outside this inventory: when
a screen needs a new part, add it here first, built from existing tokens only. Quoted
labels are English glosses of the UI copy; the copy itself belongs in `messages/ja.json`
(`localizing-ui`). Colors are written as utilities — the foundations reference maps them
to the design's names.

## Inventory

| Part                      | Variants                                                          | States                                                                         |
| ------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `button`                  | `primary` (accent fill), `secondary` (raised fill), `text`        | default, focus, pressed, disabled                                              |
| `kbd`                     | `side`: `end` (default), `start`                                  | hidden until the learner has pressed a key (`keys:` variant)                   |
| `icon-button`             | tile (default), `plain`                                           | default, focus, pressed; sound adds `aria-pressed`                             |
| `eyebrow`                 | —                                                                 | —                                                                              |
| `tab-bar`                 | — (home, talk, records, settings)                                 | current (`aria-current="page"`), other; focus                                  |
| `tabs`                    | — (settings: cards, level, app; records: overview, weak, history) | current (`aria-selected`), other; focus                                        |
| `grade-pair`              | — (× and ○ side by side)                                          | default, focus, pressed; only on a back the learner flipped                    |
| `drill-face`              | `front`, `back-self`, `back-timeout`                              | with or without the "again" mark; during the ○ light                           |
| `ticks`                   | —                                                                 | done, current, current lit (○), upcoming; absent past 30 cards                 |
| `timer-bar`               | —                                                                 | running; at 0 (fill gone)                                                      |
| `progress`                | —                                                                 | "7 / 10" in mono; during the retry round "again 2 / 3"                         |
| `streak-counter`          | — (combo)                                                         | shown from 2; disappears when broken                                           |
| `home-panel`              | ready, in progress, done, recover, not enough, load failed        | —                                                                              |
| `mix-bar`                 | —                                                                 | review and new shares, either may be 0                                         |
| `chip/choice`             | — (focus subtopic)                                                | unselected, selected (white fill + check), disabled (at the limit)             |
| `select-card`             | one column (default), `compact` (two across)                      | unselected, selected (white border + filled check), locked (the last one kept) |
| `segmented`               | one row (cards a day, s per card, auto/manual); `columns`         | one selected; none (a level not yet measured)                                  |
| `toggle`                  | —                                                                 | on, off                                                                        |
| `answer-field`            | — (the talk's Japanese and English fields)                        | empty (placeholder), typing, focus (white underline), disabled                 |
| `talk-line`               | — (partner, you, teacher)                                         | current (white), earlier (muted)                                               |
| `waiting-line`            | —                                                                 | whoever speaks next, over a still "…"                                          |
| `hidden-answer`           | — (W3f)                                                           | —                                                                              |
| `key-picker`              | — (settings: the ○ and × keys)                                    | showing its key; waiting (white fill, "press a key"); refused (status line)    |
| `ring-stack`              | `concentric` (up to 4 topics), `grid` (all 5)                     | with a new segment, without, empty (grooves + one line)                        |
| `week-row`                | —                                                                 | done, done today, open (can be made up), missed, upcoming                      |
| `dot-calendar`            | — (last 12 weeks)                                                 | the `week-row` states, without the accent                                      |
| `stat`                    | `xl`, `lg`, `md`, `tile`                                          | grew this session, unchanged, after a break ("day 1 from today")               |
| `growth-list`             | —                                                                 | faster, × → ○, sent to review, empty; "see all" open/closed                    |
| `disclosure` + `bar-list` | —                                                                 | closed, open (a topic's breakdown on the record screen)                        |
| `bar-chart`               | — (last 14 days)                                                  | today's bar grew, unchanged                                                    |
| `milestone-card`          | —                                                                 | only in the session that reached it; stacked when several                      |
| `milestone-list`          | —                                                                 | some earned, none ("none yet")                                                 |
| `weak-list`               | —                                                                 | grammar and scenes, one of them, none ("none right now")                       |
| `difficulty-line`         | `up`, `down`, `same`                                              | —                                                                              |
| `info-tip`                | —                                                                 | closed, open                                                                   |
| `sheet`                   | `pause`, `confirm`                                                | —                                                                              |
| `toast`                   | —                                                                 | shown for 4 s                                                                  |
| `inline-notice`           | —                                                                 | unsaved records; gone once sent                                                |
| `skeleton`                | —                                                                 | when the start screen takes over 300 ms                                        |
| `empty-state`             | —                                                                 | not enough cards; cards could not be loaded; no such page                      |
| `landing`                 | — (the signed-out `/`)                                            | —                                                                              |

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

`apps/web/src/ui/button.tsx` is this recipe.

## Key hint (`kbd`)

A 20-tall pill, 1px border and text in `currentColor` at 45% opacity, `eyebrow` mono
with normal tracking, pinned 14 from one edge of its control. Hidden until `<html>`
carries `data-keys`, which `apps/web/src/lib/key-mode.tsx` sets on the first key press
and remembers in local storage; `aria-hidden` always. A "←" hint sits at the start edge,
every other at the end. Never a free-standing chip, and never shown to a learner who has
only touched the screen.

## Icon button, eyebrow

- `icon-button`: 44 × 44, 12 radius, a 20 glyph in `text-foreground` on `bg-card`;
  pressed `bg-raised`. `plain` drops the tile (the drill's pause). The caller names it
  (`aria-label`); sound carries `aria-pressed`. Home's top right is sound alone; a
  re-read summary's top left is ← back.
- `eyebrow`: `font-mono text-eyebrow uppercase text-muted-foreground`, above a figure or
  a block ("Streak", "Today", "Placement", "Welcome"). Decorative when the figure beside
  it already has a Japanese name: then `aria-hidden`.

Glyphs are drawn in `apps/web/src/ui/glyphs.tsx` on a 20 grid, 1.75 strokes, round ends.
There is no icon library.

## Tab bar

The one navigation, on every screen once a read has said who is signed in: home, records
and settings, their loading and failed states included, so switching tabs never blanks
it; the drill's start, card and done screens and its failed state; the summary and the
recap. It is left off only where there is nowhere to go yet: the signed-out landing, the
first visit's welcome with its one way forward, a path with no screen (`empty-state`),
and a loading state before anyone is known to be signed in (home's skeleton, `/drill`
and `/recap` waiting on the home view). Researched on Refero: learning apps keep their
sections in a bottom bar at the thumb (Brilliant's home, courses, leagues, settings;
Duolingo, BoldVoice, LookUp, Kann) and drop it for a quiz — the owner chose otherwise in
#267, so a round can be left mid-way (to change a setting just noticed); the top edge
still stays the drill's, for its ticks.

- Fixed to the column's bottom edge: `bg-background`, four equal cells across the column
  over one hairline (`border-t border-border`), each `--tab-bar-height` (49, an iOS tab
  bar) including the hairline. It sits `--column-inset` up from the window's edge on a
  `wide` window, or a phone's home-indicator inset up where that is larger
  (`viewport-fit=cover` makes `env(safe-area-inset-bottom)` readable), the canvas under
  it covering what scrolls past.
- A cell is a link: the 20 glyph (house, speech bubble, bars, gear) over its name in
  `caption`, 4 apart, centred. The whole cell is the hit area.
- Current: `text-foreground`, plus a 24 × 2 white pill on the hairline above it, so the
  state does not rest on grey against white alone. Other: `text-muted-foreground`. Never
  the accent, never a filled tile or a pill behind the glyph.
- The router marks the current link `aria-current="page"`, matched on the exact path so
  `/` is not current on every screen, and ignoring the query. The `nav` is named
  ("menu") and is the screen's only navigation landmark.
- Rendered after the screen's `main`, so a sheet opened inside `main` covers it. A
  screen under it pads its foot by `--tab-bar-space` (the bar plus any inset it rises
  by) plus its own bottom gap. Home's skeleton reserves that space but draws no bar: a
  signed-out visitor at `/` must not see one flash before the landing.
- On the talk screen it hides while a keyboard covers a focused field, and returns on
  blur (the behavior reference's implementation rules).
- Esc on records and settings still goes home.
- From a round's first front until it closes, choosing a tab (or Back) pauses the drill
  and opens the leave sheet (see `sheet`); the start screen, the done screen, the
  summary and the recap leave at once — there is nothing to lose. A round left this way
  is resumed from home's "resume", from the card it stopped at, as the pause sheet's
  "stop" leaves it.
- The card screen's fixed height is the column less `--tab-bar-space`, so its actions
  end 12 above the bar; a live summary's sticky actions rest on the bar
  (`bottom: --tab-bar-space + --column-inset`), not on the window's edge.

`apps/web/src/lib/tab-bar.tsx` is this recipe, and
`apps/web/src/drill/use-leave-guard.ts` the drill's question.

The four tabs, in order: home (`/`), talk (`/talk`), records, settings — the owner's
call in #322, recorded in the ledger. The talk glyph is a speech bubble's outline drawn
like the others.

## Talk parts

Built for the talk screen (`building-the-talk-activity`'s `ux-screens.md`), from the
tokens the drill already uses.

- **`answer-field`.** A `textarea` with no border and no fill: one
  `border-b border-border` underline that turns `border-foreground` on focus, `text-alt`
  (16, never smaller: the behavior reference) on the canvas, its placeholder
  `text-muted-foreground`. It starts one line tall (at least the 44 touch height) and
  grows with its text. It takes at most 300 characters — input stops there — with spell
  checking, auto-correct and auto-capitalising off. Enter sends and never breaks the
  line; the Enter that confirms an input method's conversion (`isComposing`, or
  `keyCode` 229 on Safari) does not send. Named by its step's label.
- **`talk-line`.** One turn: the speaker's `eyebrow` over the body in `text-body`. No
  frame, no bubble, no fill; lines in the list are parted by a hairline
  (`border-t border-border`, none above the first) with 12 above and below. The current
  turn is `text-foreground`; earlier turns drop to `text-muted-foreground`.
- **`waiting-line`.** The `talk-line` shape with whoever speaks next as the eyebrow and
  a still "…" in `text-muted-foreground` as the body, hidden from a screen reader. No
  spinner, blink or skeleton.
- **`hidden-answer`.** Where the model answer stood once it is hidden (W3f): one 2-tall
  `bg-muted-foreground` pill per word, each as wide as its word in `ch`, wrapping like
  the sentence did, so its shape stays as a cue while its words do not. A screen reader
  hears only its label ("hidden").

## In-page tabs (`tabs`)

Records and settings are each split into tabs so that every tab fits a 390 × 844 phone
above the tab bar without the page scrolling: settings into "cards" (topics, focus,
cards a day), "level" (the level, who moves it, measuring again, seconds per card) and
"app" (sound, time zone, account); records into "overview" (the rings and each topic's
breakdown), "weak" (the weak points) and "history" (the stat tiles, the calendar and the
milestones). The owner decided it in #215: mobile-first, and a hub screen is read at a
glance on a phone, not scrolled through.

Which heights bind: 390 × 844 is the one a tab must fit with no page scroll. The PC
column (at most 720 tall, see the foundations reference), a shorter phone and a phone on
its side are not promised it — there a tab whose fixed parts do not fit scrolls the
page, and every control stays reachable above the bar.

- Under the screen's `heading`, 12 below it: equal cells across the column over one
  hairline (`border-b border-border`), each 44 tall, the name centred in `label`.
- Current: `text-foreground` with a 2px white line along the hairline under the whole
  cell; other: `text-muted-foreground`. The same white mark the tab bar uses, never the
  accent, never a filled segment — that shape is `segmented`, a setting's value.
- A `tablist` named by the screen's heading, each cell a `tab` with `aria-selected`;
  only the current tab is in the Tab order, and ←/→ move to the previous and next tab
  (wrapping round), Home and End to the first and last, choosing it as focus lands. The
  panel under it is the `tabpanel`, named by its tab and in the Tab order itself (the
  global white outline); only the current one is rendered, and only the current tab
  carries `aria-controls`.
- The chosen tab is the URL's `?tab=` (`/settings?tab=level`), replaced rather than
  pushed, so a reload or a link keeps it and Back leaves the screen. The first tab is
  the bare path: choosing it drops `?tab=`, and a `?tab=` naming no tab is replaced by
  the bare path.
- The screen is at least the column's height less the tab bar's space (its bottom
  padding), 24 above the heading and 24 above the bar, and otherwise as tall as its
  content — a floor, never a fixed height. The panel takes what is left. A list that
  cannot fit — the focus chips, an opened breakdown, the milestones — grows into that
  space and scrolls inside its own region (`SELF_SCROLL`: `contain-size`, so its rows
  never count towards the screen's height), down to about one row; nothing else scrolls
  inside a tab. When the rest of a tab does not fit either, the screen grows past the
  column and the page scrolls; nothing is clipped and nothing ends under the bar.
- A self-scrolling region is inset by 6 (`-m-1.5 p-1.5`) where its rows take focus, so
  their outline is not clipped, and takes focus itself (`tabIndex=0`, named by its
  section's heading) where none of its rows does — the milestones — so a keyboard can
  scroll it.

`apps/web/src/ui/tabs.tsx` is this recipe; `apps/web/src/lib/tabbed-screen.tsx` lays out
a screen around it and exports `SELF_SCROLL`.

## Grade pair

× on the left (`secondary`, ✕ glyph, "not yet"), ○ on the right (`primary`, ○ glyph,
"said it"), half the width each with a 10 gap. Each hint is the learner's key for that
grade, "←" and "→" by default: a "←" sits at the start edge, any other at the end. Shown
only on a back the learner flipped; a timed-out back shows a single `primary` "next"
instead.

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
| Limit  | The learner's setting: 15, 20, 30, 45 or 60 s, 30 by default. A round keeps the limit it was dealt with; a new choice applies from the next round                                                   |
| Pace   | What "fast" is judged by, not when the timer runs out: 4 s + 0.5 s × English word count, rounded up, clamped to 6–20 s (6 words → 7, 12 → 10, 20 → 14, 28 → 18)                                     |
| Motion | The fill carries `data-motion="essential"` so reduced motion does not freeze it (it may step once a second)                                                                                         |

The limits on offer, their default and the pace formula are starting values, tuned by
use: keep them in configuration, not in the component.

## Home panel and mix bar

The start screen is three stacked zones over the tab bar: the top bar (brand `eyebrow`
left, the sound tile right), the streak block centred in the free space (`eyebrow`
"Streak", the figure in `number-xl`, the week row), and one `bg-card rounded-card p-5`
panel at the bottom that carries the state and its one primary action. The zones are at
least 32 apart, so the tallest panel (done, with yesterday to make up) still fits a PC's
720 column.

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
and "new 6", "focus: meetings" when a focus is set, and "weak: present perfect" when the
deal carries a weak grammar concept — names only, set apart by "、", never lit.

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
  `compact` sets two cards across, 8 apart, 64 tall at least, 16 across and 12 between
  the text and the disc, the title in `label` so the longest topic name holds one line
  at a phone's width: settings' "cards" tab lists its five topics in three rows this
  way, where one column would leave the focus chips no room.
- Focus subtopics use `chip/choice`. The section heading carries "1 / 2" in `mono-sm` at
  its right; at the limit every unselected chip turns `text-disabled` and stops
  accepting presses.
- `segmented`: track `bg-card`, 18 radius, 4 inset; the selected segment is
  `bg-primary text-primary-foreground` at 16 radius, figures in
  `font-display text-action`. More options than a phone's row holds (the ten levels by
  TOEIC) wrap into rows of `columns` (five) on the same track, 4 between rows, rather
  than scroll or shrink below 44.
- `toggle`: 52 × 32; on is a `bg-primary` track with a black knob at the right; off a
  `bg-raised` track with a grey knob at the left. No "on"/"off" words: position and fill
  carry the state, and the switch role says it.
- Settings rows without a control of their own (sound, grade keys, time zone, account)
  sit between hairlines, 64 tall, name left and control right.
- `key-picker`: the × key then the ○ key, 8 apart, each a 44-tall `rounded-tile`
  `bg-raised` tile at least 64 wide with its grade's glyph and the key in `mono-sm` (an
  arrow as the arrow, a digit or letter as itself). Pressed, it takes focus and waits:
  `bg-primary text-primary-foreground` with "press a key" in `label`, white because it
  is a selection, never the accent. The next key pressed becomes that grade's key and
  saves; one outside ↑ ↓ ← →, 0–9 and A–Z, or the other grade's, is refused in the row's
  `status` line and the tile keeps waiting. Esc or leaving the tile gives up.

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
  between a hairline and its buttons — only in keys mode. On a `wide` window it opens
  centered in the window instead (`wide:items-center`), every corner rounded
  (`wide:rounded-card`), over the same scrim: a bar at the bottom of a tall window sits
  far from the screen it pauses. The leave sheet, asked when a tab or Back would leave a
  round under way, is the pause sheet's recipe with its own title ("leave the round?"),
  the same resume hint, "leave" in place of "stop" and no key list; focus waits on
  "continue", which Escape presses.
- `info-tip`: a 44 hit area around a 16 ⓘ glyph beside a section title; pressing it
  opens one muted `caption` line under the title in place (`aria-expanded`). For a
  definition someone needs once: what counts as mastered, how the streak counts.
- `toast`: fixed across the column with its 16 gutter, 96 above the tab bar (plus
  `--column-inset` and `--tab-bar-space`), so it clears the drill's bottom buttons;
  `bg-raised rounded-tile`, padding 14 / 16, the notice glyph 12 before a
  `text-foreground` line. Gone after 4 s (`TUNING.toastMs`), shown again for each new
  failure; it takes no press (`pointer-events-none`) and speaks through a
  `role="status"` region that stays mounted. Never red. No success toast, ever.
  `apps/web/src/drill/toast.tsx` is this recipe.
- `empty-state`: a `bg-card rounded-card` panel with a `heading`, at most one muted line
  and one `secondary` button. A path with no screen is this panel alone, centred in the
  column with no tab bar, its button a link home that Space and Enter press
  (`apps/web/src/not-found.tsx`).
- `skeleton`: after 300 ms of start-screen loading, `bg-card` blocks the size of the
  figure, the week and the panel, each with its part's radius. No text, no spinner, no
  pulsing.

## Record screen parts

The record screen: "records" (`heading`), its `tabs` and the tab bar; under "overview"
the rings with ⓘ and each topic's disclosure; under "weak" the weak points with ⓘ; under
"history" the stat tiles, the calendar with ⓘ and the milestones. Nothing is lit.

| Part             | Value                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disclosure`     | One 48-tall row over a hairline: "topic breakdown" (`body`) with a chevron at the right in `text-muted-foreground`, turned to point right when closed; `aria-expanded`                                                          |
| `bar-list`       | Under an open disclosure. Per row: subtopic (`caption`, muted), a bar, the count (`mono-sm`, right-aligned). Bar 6 tall, pill, groove `hairline`, fill `foreground`, relative to the topic's largest. No percentages, no accent |
| `stat/tile`      | `bg-card rounded-tile p-4`: the name in muted `caption`, the figure in `figure-sm`, an optional `eyebrow`-sized note ("longest 21 days"). Streak and difficulty two across; said, days and points three across                  |
| `dot-calendar`   | Last 12 weeks, one column per week (oldest left), rows Monday to Sunday. Dots 12 across, 6 apart. The `week-row` states with a solid hairline ring for upcoming, but never the accent — nothing grows here                      |
| `milestone-list` | A muted `label` title, then per row the subject (`label`, muted) and the milestones earned ("7 · 14 · 30", `mono-sm`, white). Streak first, then topic order. Empty: "none yet", muted `body`                                   |
| `weak-list`      | A muted `label` title with ⓘ; per row the kind (`label`, muted) and its names (`body`, white, "、" between), weakest first. No row for an empty kind; neither: "none right now". No count, no rate, no accent                   |

## Landing

`/` for a visitor who is not signed in: what the drill is, told the way the W2 intro
tells the placement round, with nothing read from the API.

- Top: the brand `eyebrow` over the app's name in `heading`. No sound tile and no tab
  bar: a visitor has nowhere to go yet.
- Centred in the free space: the drill's three moves — a Japanese prompt, said in
  English before the timer runs out, flipped and graded ○ / × — as numbered steps
  between hairlines, "01" in muted `mono-sm` and the move in `heading`, one line each.
- Bottom: "sign in" as the one `primary`, a link (`Button asChild`) to the API's sign-in
  redirect, led on by → with its Space hint.
- No illustration, no sample card, no feature paragraphs, no second action. The accent
  is the sign-in alone.
