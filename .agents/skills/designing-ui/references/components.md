# Components

Every part a screen may use, and its values. Build nothing outside this inventory: when
a screen needs a new part, add it here first, built from existing tokens only. Quoted
labels are English glosses of the UI copy; the copy itself belongs in `messages/ja.json`
(`localizing-ui`). Colors are written as utilities — the foundations reference maps them
to the design's names and to both themes.

Every interactive part has a hover state (the foundations reference's hover rule) on top
of the states listed; a part with no hover below is not interactive.

## Inventory

| Part                      | Variants                                                   | States                                                                |
| ------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `button`                  | `primary` (`action`), `good` (○), `secondary`, `text`      | default, hover, focus, pressed, disabled                              |
| `kbd`                     | `side`: `end` (default), `start`                           | hidden until the learner has pressed a key (`keys:` variant)          |
| `icon-button`             | tile (default), `plain`                                    | default, hover, focus, pressed; sound adds `aria-pressed`             |
| `eyebrow`                 | —                                                          | —                                                                     |
| `sidebar`                 | — (from `pc`: brand, home, vocab, talk, records, settings) | current (`aria-current="page"`), other; hover, focus                  |
| `top-bar`                 | labels from 768, glyphs only below                         | current, other; hover, focus                                          |
| `skip-link`               | —                                                          | hidden until focused                                                  |
| `focus-strip`             | `drill`, `summary`, `talk`                                 | —                                                                     |
| `dialog`                  | `pause`, `leave`, `confirm` (retest, W4, delete a card)    | open, with focus trapped                                              |
| `grade-trio`              | — (×, △ and ○ side by side)                                | as `button`; with intervals, or none on a re-ask                      |
| `drill-card`              | `front`, `back-self`, `back-timeout`                       | with or without the "again" mark; during the ○ light                  |
| `vocab-card`              | `front` (sentence or dialogue), `back`                     | with or without the "again" mark or the talk mark; during the ○ light |
| `cloze-blank`             | —                                                          | — (one per blanked word)                                              |
| `progress`                | `drill` (one bar), `talk` (six segments)                   | "7 / 22"; "again n" beside it while re-asks wait                      |
| `timer-bar`               | —                                                          | running; at 0 (fill gone)                                             |
| `combo-chip`              | —                                                          | shown from 2; gone when broken                                        |
| `home-panel`              | ready, in progress, done, recover, not enough, load failed | —                                                                     |
| `streak-tile`             | —                                                          | grew today, unchanged, yesterday open, after a break                  |
| `home-tile`               | `vocab`, `talk`, `weak`, `reach`                           | figures, not yet answered (frame only), failed (one line), empty      |
| `deck-row`                | — (the vocabulary hub's rows)                              | default, hover, focus; refused (`aria-disabled`) when empty           |
| `mix-bar`                 | —                                                          | review and new shares, either may be 0                                |
| `chip/choice`             | — (focus subtopic)                                         | unselected, selected (ink border + check), disabled (at the limit)    |
| `tag`                     | —                                                          | — (not pressable)                                                     |
| `select-card`             | three across from `pc`, two from 640, one below; candidate | unselected, selected, locked; candidate: in learning, added           |
| `segmented`               | one row (up to six options); `columns`                     | one selected; none (a level not yet measured)                         |
| `toggle`                  | —                                                          | on, off                                                               |
| `answer-field`            | — (the talk's Japanese and English fields)                 | empty (placeholder), typing, focus, disabled                          |
| `talk-line`               | — (partner, you, teacher)                                  | current (`ink`), earlier (`ink-2`)                                    |
| `waiting-line`            | —                                                          | whoever speaks next, over a still "…"                                 |
| `hidden-answer`           | — (W3f)                                                    | —                                                                     |
| `key-picker`              | — (settings: the ×, △ and ○ keys)                          | showing its key; waiting ("press a key"); refused (status line)       |
| `ring-stack`              | `concentric` (up to 4 topics), `grid` (all 5)              | with a grown segment, without, empty (tracks + one line)              |
| `reach-bars`              | — (home's reach tile)                                      | with a grown segment, without, empty                                  |
| `week-row`                | —                                                          | done, today, open (can be made up), missed, ahead                     |
| `dot-calendar`            | — (last 12 weeks)                                          | the `week-row` states, in `ink`                                       |
| `stat`                    | `xl` (done screen), `lg`, `md`, `tile`                     | grew this session, unchanged, after a break ("day 1 from today")      |
| `points-chip`             | —                                                          | "+N pt", pops in once                                                 |
| `figures-row`             | — (records: streak, said, days, points, difficulty)        | —                                                                     |
| `section-list`            | — (settings: cards, level, app, account)                   | current section, other; hover, focus                                  |
| `settings-row`            | inline control, full-width control                         | —                                                                     |
| `growth-list`             | —                                                          | faster, × → ○, sent to review, empty; "see all" open/closed           |
| `disclosure` + `bar-list` | —                                                          | closed, open (a topic's breakdown on the records page)                |
| `bar-chart`               | — (last 14 days)                                           | today's bar grew, unchanged                                           |
| `milestone-card`          | —                                                          | only in the session that reached it; stacked when several             |
| `milestone-list`          | —                                                          | some earned, none ("none yet")                                        |
| `weak-list`               | —                                                          | grammar and scenes, one of them, none ("none right now")              |
| `difficulty-line`         | `up`, `down`, `same`                                       | —                                                                     |
| `info-tip`                | —                                                          | closed, open                                                          |
| `toast`                   | —                                                          | shown for 4 s                                                         |
| `inline-notice`           | —                                                          | unsaved records; gone once sent                                       |
| `skeleton`                | —                                                          | when home's read takes over 300 ms                                    |
| `empty-state`             | —                                                          | not enough cards; cards could not be loaded; no such page             |
| `landing`                 | — (the signed-out `/`)                                     | —                                                                     |
| `confetti`                | — (a streak that grew, a milestone)                        | bursting, gone; absent under reduced motion                           |

There is no status chip. "Timed out", "again", "from a talk" and "fast" are text with a
glyph: beside lip buttons, a pill reads as one more button. `tag` is the one pill that
is not pressable, and it never sits beside a button.

## Button

| Variant     | Face                                          | Lip                 | Hover             | Used for                                           |
| ----------- | --------------------------------------------- | ------------------- | ----------------- | -------------------------------------------------- |
| `primary`   | `bg-action text-on-action`                    | `shadow-action-lip` | `bg-action-hover` | One per screen, led on by → (`PrimaryButton`)      |
| `good`      | `bg-good text-on-good`                        | `shadow-good-lip`   | `bg-good-hover`   | ○ "said it" — never the primary                    |
| `secondary` | `bg-card text-foreground`, 2px `border-input` | `shadow-input`      | `bg-raised`       | ×, △, flip, "one more" beside a primary, "stop"    |
| `text`      | transparent, `text-muted-foreground`          | none                | `text-foreground` | "see all", "see the summary →", "count from today" |

- Height 52 (`text`: 44), 16 radius (`rounded-control`), `text-action` (`text`:
  `text-body`), width set by the caller (`w-full`, half of a pair). `relative`, so a
  `kbd` pins to it. The lip is `shadow-lip` coloured by the lip column, and the button
  reserves 4 below itself for it.
- Pressed: `translate-y-1` and `shadow-none` — the face drops onto where its lip was.
  Never scale a button.
- Disabled: `bg-raised text-disabled`, no lip, no hover, no press.
- Neither `good` nor `secondary` is ever red, and × is never `good`'s opposite colour: a
  miss is `secondary`.

`apps/web/src/ui/button.tsx` is this recipe.

## Key hint (`kbd`)

A 20-tall pill, a 1.5px border in `currentColor` at 45% opacity (decorative) and its key
in `currentColor` at full strength — so its text measures as the control's own label —
`eyebrow` with normal tracking, pinned 14 from one edge of its control. Hidden until
`<html>` carries `data-keys`, which `apps/web/src/lib/key-mode.tsx` sets on the first
key press and remembers in local storage; `aria-hidden` always. A "←" hint sits at the
start edge, every other at the end. Never a free-standing chip, and never shown to a
learner who has only used the mouse or touch.

## Icon button, eyebrow

- `icon-button`: 44 × 44, 16 radius, a 20 glyph in `text-foreground` on `bg-card` with a
  2px `border-input`; hover and pressed `bg-raised`. `plain` drops the face (the focus
  strip's ✕). The caller names it (`aria-label`); sound carries `aria-pressed`. Home's
  top right is sound alone.
- `eyebrow`: `font-latin text-eyebrow uppercase text-muted-foreground`, above a figure
  or a block ("Streak", "Today", "Placement", "Welcome"). Decorative when the figure
  beside it already has a Japanese name: then `aria-hidden`.

Glyphs are drawn on a 20 grid, round ends: outlines at 1.75 strokes in
`apps/web/src/ui/glyphs.tsx`, and the filled set (flame, bolt, target, star) the lock
names in `apps/web/src/ui/filled-glyphs.tsx`. There is no icon library.

## Shell: sidebar, top bar, skip link

One layout route renders these once, before `main`; a screen renders its content only.
They appear once a read has said who is signed in, on home, the vocabulary hub, talk
start, records and settings — never on the landing, the welcome, a path with no screen,
a focus screen, or a loading state before anyone is known (home's skeleton, `/drill`'s
wait).

- **`sidebar`** (from `pc`): 240 wide, fixed to the left at full height, `bg-card` with
  a 2px `border-border` on its right, padding 24 / 16. The brand at the top in
  `font-display text-figure-sm`, 32 above the items. Then the five sections, in order —
  home (`/`), vocab (`/vocab`), talk (`/talk`), records, settings — each a link 44 tall,
  a pill, the 20 glyph (house, card stack, speech bubble, bars, gear) 12 before its name
  in `text-action`, the whole row the hit area, 4 apart.
- **Current item:** `text-foreground` with a 2px `border-foreground` pill around the row
  — the selection ink, never a colour — and `aria-current="page"`, matched on the exact
  path so `/` is not current everywhere, ignoring the query and the hash. Other:
  `text-muted-foreground` and a transparent 2px border, so nothing shifts. Hover:
  `bg-raised`.
- **`top-bar`** (below `pc`): 56 tall, sticky at the top, `bg-card` over a 2px
  `border-border`. The brand at the left; the five sections at the right as the same
  pills 44 tall, glyph and name from 768, the glyph alone below it with the name as its
  `aria-label`. Nothing scrolls sideways at 390, 640 or 768.
- Both are one `nav` named "menu", the page's only navigation landmark. Esc on the
  vocabulary hub, records and settings still goes home.
- **`skip-link`**: the first focusable element of every shell page, "skip to content",
  pointing at `main` (`id="main"`, `tabIndex={-1}`). Visually hidden until it takes
  focus, then a `secondary` button at 16, 16 over everything.

## Focus strip and focus layout

The focus layout has no navigation: a 64-tall strip across the top, the stage under it
(max 880, centered, its content group vertically centered in `100dvh − 64`; the page
scrolls when taller).

- Left: ✕, a `plain` `icon-button` 44 × 44. `drill` names it "pause" — it opens the
  pause dialog, as Esc and `?` do — except on the start screen, where nothing is in
  progress and it goes home at once. `summary` names it "close" and goes home (a re-read
  recap too); `talk` names it "end" and opens W4.
- Centre, max 560: the `progress` (below). Right: the counters — "7 / 10" in
  `text-count`, then the `combo-chip`.
- Moving to another section mid-round is ✕ → "stop", or the browser's Back, which opens
  the leave dialog (the behavior reference).

## Drill card

The face sits on one card inside the stage: `bg-card`, a 2px `border-border`,
`rounded-panel`, padding 32. Under it, 24 apart, the timer (front) or the actions, at
most 560 wide and centered.

| Face           | Contents, top to bottom                                                                                                                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `front`        | an `eyebrow` "again" with the return glyph on a retry → the prompt (`front`, or `front-long` past 48 characters; `text-balance`), centred on the card; the whole card flips on a press                                                                                                                          |
| `back-self`    | the whole prompt (`point`, muted, wrapped — never truncated) → the model answer (`answer font-latin`) → the alternates as a list between hairlines (`alt font-latin`, muted, 12 above and below each) → the key point (`point`, led by a "point" `label`) → seconds to flip at the right (`figure-sm`, "2.8 s") |
| `back-timeout` | as `back-self`, with the return glyph and "timed out" (`label`, muted) in place of the seconds, then the `grade-trio` as on `back-self`; no "next" — the grade decides                                                                                                                                          |

- **`grade-trio`**: × "forgot" (忘れた, `secondary`, ✕ glyph), △ "unsure" (微妙,
  `secondary`, △ glyph) and ○ "remembered" (覚えてた, `good`, ○ glyph), left to right, a
  third of the width each with 12 gaps, max 560. Each button stays 52 tall: its name
  over its next interval ("tomorrow", "3 days") in `caption`, the intervals as the
  server dealt them with the card — the client computes none. A re-ask's buttons have no
  interval line. Each hint is that grade's first key, "←", "2" and "→" by default: a "←"
  sits at the start edge, any other at the end. × and △ share the grey and differ by
  glyph and name only.
- A ○ turns the answer `text-good-ink` (160 ms); a △ leaves it `text-foreground`
  (`ink`); a × fades it to `text-muted-foreground`. A first pass advances the progress
  bar whatever its grade.
- A fast ○ shows "fast 2.1 s" in `figure-sm text-good-ink` rising into place.
- The vocabulary session's face is the `vocab-card` below, on the same card and stage,
  with the same `grade-trio`; it has no timer, combo or points.
- When a back does not fit, only the card's inner area scrolls; the strip and the
  actions stay put. The last 32px fades to `surface` (decoration only). ↑/↓ scroll it;
  the grade keys never scroll.

## Vocab card and cloze blank

The `drill-card`'s frame — `bg-card`, a 2px `border-border`, `rounded-panel`, padding
32, inside the 880 stage — with "flip" (`secondary`, max 560) 24 under the front and the
`grade-trio` under the back.

| Face    | Contents, top to bottom                                                                                                                                                                                                                                                                |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `front` | the category `eyebrow` ("phrasal verb") → the definition (`body font-latin`) → the example with each blanked word a `cloze-blank`. A set phrase's example is the dialogue form: two lines, "A: …" over "B: …", the blank in its line                                                   |
| `back`  | the category `eyebrow` → the headword (`answer font-latin`) → the meaning (`heading`) → a hairline → the example filled in, the answer's words at weight 800 and underlined — never only coloured → `example2` (muted). The grades light the headword as they light the drill's answer |

- **Marks.** A re-ask carries the "again" mark — the return glyph and "again" as the
  `eyebrow`, before the category — and its trio has no interval line. A card from a talk
  carries the talk mark beside the category, "from a talk" with the speech-bubble glyph,
  text and never a pill; on the back only, a `text` "delete" sits at the card's top
  right, away from the grades, and opens the `dialog` `confirm`.
- **`cloze-blank`**: one per blanked word, a fixed 6ch underline (2px
  `border-foreground` at its foot, no fill) inline in the sentence — never as long as
  the word, so its width gives nothing away.

## Progress, timer bar and combo

| Item     | Value                                                                                                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Progress | `drill`: an 18-tall pill, `bg-good` on `bg-bar-track`, the done share filled, max 560. `talk`: six 8-tall pills 4 apart, done turns `bg-good`, the rest `bg-bar-track`, "3 / 6" at the right                         |
| Count    | "7 / 10" in `text-count`, beside the bar, counting first passes; it is what a screen reader reads. While re-asks wait, "again n" follows it in muted `text-count`. There is no retry round and no count of one       |
| Combo    | From 2: a `combo-chip` — an `energy` pill with its lip, a bolt glyph and the count + "in a row" in `text-count text-on-energy`                                                                                       |
| Timer    | Under the card, above the actions: a 12-tall pill, `bg-energy` on `bg-bar-track`, shrinking linearly from the limit to 0; the whole seconds left, rounded up, at its right in `figure-sm font-display` (tabular box) |
| At 0     | The fill is gone and the figure reads "0". The colour never changes — never red                                                                                                                                      |
| Limit    | The learner's setting: 15, 20, 30, 45 or 60 s, 30 by default. A round keeps the limit it was dealt with; a new choice applies from the next round                                                                    |
| Pace     | What "fast" is judged by, not when the timer runs out: 4 s + 0.5 s × English word count, rounded up, clamped to 6–20 s (6 words → 7, 12 → 10, 20 → 14, 28 → 18)                                                      |
| Motion   | The timer's fill carries `data-motion="essential"` so reduced motion does not freeze it (it may step once a second)                                                                                                  |

The limits on offer, their default and the pace formula are starting values, tuned by
use: keep them in configuration, not in the component.

## Home

Max 1120, on the grid: the Today panel (8 columns) beside the `streak-tile` (4), then
four `home-tile`s 2 × 2 (6 columns each): vocab and talk, then weak and reach — every
tile keeps at least 340 at 1024. Below `pc`: Today, the streak, vocab, talk, weak,
reach, one column. Over them, the date (`heading`) at the left and the sound tile at the
right.

`home-panel` (Today) is `bg-card rounded-card p-6` with a 2px `border-border`, its one
primary action at its bottom right:

| State       | Panel contents                                                                                                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ready       | `eyebrow` "Today"; the size in `number-md` + "sentences" and "about n min" in `text-count`; the mix bar; a short-day line; start                                                                                                                                    |
| in progress | the portion's name (`label`, muted); "4 / 10" in `number-md`; an 8-tall `good`-on-`bar-track` progress pill; resume                                                                                                                                                 |
| done        | a check disc + "done for today" (`heading`), "2 rounds · 20 sentences" in `text-count`; "see the summary →" (`text`) at the top right; one more — or, while yesterday can still be made up, a line, the deadline, "make up yesterday" and "one more" as `secondary` |
| recover     | one line, both sizes and the time in `text-count`, the deadline; "do yesterday's too"; "count from today" (`text`)                                                                                                                                                  |
| not enough  | `heading`, one muted line with the count, "widen the range" (`secondary`, to settings)                                                                                                                                                                              |
| load failed | `heading`, "load again" (`secondary`, the screen's primary key)                                                                                                                                                                                                     |

- `mix-bar`: an 8-tall split pill — the review share `bg-foreground`, the new share
  `bg-muted-foreground`, 2 apart — over a `caption` row: a swatch and "review 4", a
  swatch and "new 6", then `tag`s for "focus: meetings" and "weak: present perfect" when
  the deal carries them.
- `streak-tile`: the same card; `eyebrow` "Streak", the figure in
  `number-lg font-display` beside a filled flame in `text-energy`, "days in a row"
  (`label`, muted), the `week-row`, "longest 21 days" in muted `text-count`.
- `home-tile`: the same card, 20 padding, a `heading`-sized title, its body, and a
  `text` link "see in records →" at the bottom; the whole tile is not a link. `weak`:
  the `weak-list`'s rows, at most three names a kind. `reach`: `reach-bars` per chosen
  topic — name (`label`), mastered count (`figure-sm`), a 10-tall pill, `bg-foreground`
  on `bg-raised` relative to the next milestone, this session's growth in `bg-good-ink`
  after a 2px gap. `talk`: "6 turns", "the scene is chosen for you", and a `secondary`
  "start a talk" (home's one primary stays "start"). `vocab`: today's due and new, and a
  `secondary` "study words" to today's session; done for today, "today's done" and
  "tomorrow 14" in `text-count` with a `text` link "open vocab →" to the hub; no cards
  for the language pair, "no cards yet".
- The weak and reach tiles read the records query beside the home view, and the vocab
  tile the hub's query. Not answered yet: the frame and title, no figures, no animation.
  Failed: one line, "could not load", and the rest of home works. Empty: "none right
  now" and "0 so far".

## Chips and selection controls

Selected is ink everywhere: a 2px `border-foreground` and, where there is room, a check.
Never `action`, `energy` or `good`.

- `chip/choice` (a pressable focus subtopic): 36 tall, 14 across, pill, the hit area
  grown by 4 above and below to 44; rows 8 apart. Unselected: `bg-raised` with a 2px
  `border-border` inset, `text-label text-foreground`; hover `border-input`. Selected:
  the border `border-foreground` and a check at the left. Disabled (at the limit):
  `text-disabled`, no hover, presses refused. The section heading carries "1 / 2" in
  `text-count` at its right.
- `tag`: the chip's face — `bg-raised`, 2px `border-border` inset, weight 800 — 28 tall,
  not pressable, no hover.
- `select-card`: `bg-card`, 2px `border-input` with its lip (`shadow-lip shadow-input`),
  `rounded-control`, 72 tall at least; the title in `action`, the subtopics in one
  truncated muted `caption` line; a 24 disc at the right — a 2px `border-input` ring
  unselected, a `bg-foreground` disc with a `surface` check selected, and the border and
  lip turn `ink`. Hover `bg-raised`; pressed drops onto the lip. `locked` (the last
  topic kept) keeps the selected look and refuses the press with `aria-disabled`; the
  refusal is said on the press, in a `status` line. Three across from `pc`, two from
  640, one below, 12 apart.
- `segmented`: track `bg-raised`, `rounded-control`, 4 inset; each segment 44 tall; the
  selected one `bg-card` with a 2px `border-foreground`, figures in
  `font-display text-action`; hover on the others `bg-card`. More options than a row
  holds (the ten levels by TOEIC) wrap into rows of `columns` (five), 4 between rows,
  rather than shrink below 44.
- `segmented` takes up to six options in one row — the daily limits' "unlimited" always
  the last — before it wraps into `columns`.
- `toggle`: 52 × 32. On: a `bg-foreground` track with a `bg-card` knob at the right.
  Off: a `bg-raised` track with a 2px `border-input` and a `bg-input` knob at the left.
  No "on"/"off" words: position and fill carry the state, and the switch role says it.
  Hover steps the track once: off to `bg-border`, on to `bg-muted-foreground` (the knob
  still measures as `ink-2` against `surface`).
- `key-picker`: three tiles — the × key, the △ key, then the ○ key — 8 apart, each a
  44-tall `rounded-control` `bg-raised` tile at least 64 wide with a 2px `border-input`,
  its grade's glyph and the key in `text-count` (an arrow as the arrow, a digit or
  letter as itself); hover `bg-card`. Pressed, it takes focus and waits: its border
  turns `border-foreground` and it reads "press a key" in `label` — a selection, so ink.
  The next key pressed becomes that grade's key and saves; one outside ↑ ↓ ← →, 0–9 and
  A–Z, or one another grade holds, is refused in the row's `status` line and the tile
  keeps waiting. A stored pair shows its two keys and the △ key derived from them. Esc
  or leaving the tile gives up.

## Deck row

The vocabulary hub's category rows (and its weak row): each a link 56 tall between 2px
`border-border` hairlines — the name (`body`) at the left; today's due and new in
`text-count` and in learning / all in muted `text-count` at the right, then a chevron
pointing right. Hover `bg-raised`; the whole row is the hit area. With nothing to study
today it reads "none today" and refuses the press with `aria-disabled`, keeping focus
and no hover.

## Talk parts

Built for the talk session (`building-the-talk-activity`'s `ux-screens.md`): a column
max 720 centered on the focus stage, filling `100dvh − 64`; the conversation scrolls
inside it, kept at its bottom, and the step panel rests on its foot.

- **`answer-field`.** A `textarea` on `bg-card` with a 2px `border-input`,
  `rounded-control`, padding 12 / 16, `text-body` (16, never smaller: the behavior
  reference); its placeholder `text-muted-foreground`; hover `bg-raised`; focus adds the
  global outline. It starts one line tall (at least 44) and grows with its text. It
  takes at most 300 characters — input stops there — with spell checking, auto-correct
  and auto-capitalising off. Enter sends and never breaks the line; the Enter that
  confirms an input method's conversion (`isComposing`, or `keyCode` 229 on Safari) does
  not send. Named by its step's label.
- **`talk-line`.** One turn: the speaker's `eyebrow` over the body in `text-body`. No
  frame, no bubble, no fill; lines are parted by a 2px `border-border` hairline (none
  above the first) with 12 above and below. The current turn is `text-foreground`;
  earlier turns `text-muted-foreground`.
- **`waiting-line`.** The `talk-line` shape with whoever speaks next as the eyebrow and
  a still "…" in `text-muted-foreground`, hidden from a screen reader. No spinner, blink
  or skeleton.
- **`hidden-answer`.** Where the model answer stood once it is hidden (W3f): one 2-tall
  `bg-muted-foreground` pill per word, each as wide as its word in `ch`, wrapping like
  the sentence did. A screen reader hears only its label ("hidden").
- The step panel is a `bg-card rounded-panel` card with a 2px `border-border`, padding
  20, its actions at its foot.
- **The candidate card.** Under "the end", in the conversation, scrolling with it and
  kept in view when it appears: a `bg-card rounded-panel` card with a 2px
  `border-border`, padding 20, the title "make cards" in `heading`. Each candidate is a
  `select-card`, two across (one below 640), none selected: the headword as its title
  (`font-latin`), the category and the meaning as its caption. One already in learning
  reads "in learning" (`caption`, muted) beside its disc; one added reads "added" and is
  no longer pressable (`aria-disabled`). "add" (`secondary`) sits at the card's foot,
  disabled until one is selected; "new talk" stays the one primary. Waiting: the title
  over the `waiting-line`'s still "…". Failed: one line with the notice glyph and "try
  again" (`secondary`).

## Rings, reach and the week (`ring-stack`, `week-row`, `stat`)

| Item         | Value                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stroke       | 12, rings 6 apart; track `raised`                                                                                                                    |
| Fill         | `foreground`: progress from the last milestone to the next (137 → 37 of the 100–200 step; 58 → 8 of the 50–100 step); restarts at 0 past a milestone |
| Grown        | `good-ink`, after a 2px gap from the existing fill                                                                                                   |
| Label        | Right of each ring: topic name (`label`, muted) + mastered count (`figure-sm`); this session's growth as "+3" in `text-good-ink`                     |
| Order        | Outermost first, in the order of the chosen topics                                                                                                   |
| `concentric` | Up to 4 topics, diameter 200                                                                                                                         |
| `grid`       | All 5 topics: single rings of diameter 72, 2 columns × 3 rows, label to the right, rows 16 apart                                                     |
| Milestones   | 10 / 25 / 50 / 100 mastered, then every 100 — the same steps as the milestone cards                                                                  |
| Empty        | Tracks only, with one muted "0 so far" line; what counts as mastered is the ⓘ beside the section title                                               |

`week-row`: seven 32 discs Monday to Sunday, 8 apart, each over a `caption` weekday.

| State                                        | Look                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| done (a made-up day looks the same)          | `bg-energy` disc with a `text-on-energy` check; checks in when earned now |
| today, not yet done                          | a 3px `border-foreground` ring                                            |
| open — yesterday, until today's cut-off      | a 2px solid `border-input` ring                                           |
| missed — a broken day or an expired open day | a `bg-raised` disc                                                        |
| ahead                                        | a 2px dashed `border-input` ring                                          |

- Each disc's state is also in `sr-only` words. No grace allowance and no "n left" line.
  How the streak counts is one ⓘ on the records page.
- `stat/xl` (the done screen's streak, when it grew): the figure in
  `number-xl font-display text-energy` with a 6px `on-energy` outline
  (`paint-order: stroke fill`) and an 8px `on-energy` drop, beside a filled flame; the
  outline carries its contrast. Unchanged: `number-lg`, `text-foreground`.
- Yesterday open: the figure is the streak up to the day before, with one `body` line
  that yesterday is open. After a break: never "0 days" — a `heading` "day 1 from today"
  with the longest streak in muted `text-count`.
- Streak milestones: 7 / 14 / 30 / 60 / 100 / 200 / 365 days, then every 100 from 400.

## Summary parts

The done screen and the recap are focus screens, max 1120: the hero centered (the title
in `heading`, the streak, the week), the actions under it in the first view ("one more
5" `secondary`, "finish" `primary`), then the cards on the grid — growth, reach and
points (4 columns each), then the review list (7) and the 14-day chart (5). Milestone
cards sit above that row, the difficulty line under it. Below `pc`: one column in this
order.

| Part               | Value                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stat/md`          | Figure (`number-md font-display`) + name (`label`); this session's growth `text-good-ink`                                                                                            |
| `points-chip`      | "+20 pt" in `text-count text-on-energy` on an `energy` pill with its lip, 32 tall; the total in muted `text-count` beside it                                                         |
| `growth-list`      | Per row, between hairlines: the prompt (one line, truncated) and the delta at the right ("−1.2 s", "× → ○" in `text-count`, the delta `text-good-ink`). First 3 rows, then "see all" |
| "see all" opened   | Opens in place below; the button becomes "close" (`aria-expanded`); up to 30 rows                                                                                                    |
| No growth          | No big figure: one muted `body` line — how many were compared, "no change" — and one for first-time sentences                                                                        |
| Review             | Title with the count in `figure-sm` at its right, then the prompts as a `growth-list` with nothing at the row's end. Nothing to review: one muted line with the count 0              |
| `bar-chart`        | Sentences said, last 14 days: pill bars 10 wide, 6 apart, 64 tall at most, `bg-muted-foreground`; only today's growth `bg-good-ink`, after a 2px gap                                 |
| `difficulty-line`  | `up`: the new level plus "↑", `text-good-ink`. `down`: the same with "↓", `text-muted-foreground`, no motion. `same`: not shown                                                      |
| `milestone-card`   | `bg-card rounded-card`, a 2px `border-energy` (decorative), a filled star in `text-energy` beside an `eyebrow` "title", the name in `heading`. Only in the session that reached it   |
| Milestone names    | A number and its subject only ("100 in daily life", "30 days in a row"); no milestone for the overall total                                                                          |
| Several milestones | Stacked 16 apart, streak first then topic order                                                                                                                                      |
| Placement          | The first placement leads with a card: "difficulty" (`label`, muted) over "starting around TOEIC n" (`heading`)                                                                      |
| `inline-notice`    | `bg-raised rounded-control`, padding 12 / 16, the notice glyph, a `body` line with the unsaved count, a `text` "resend" at the right. Never red                                      |
| Heading variants   | Yesterday's set: its own "done" heading. Re-reading today's summary: "today's summary", ✕ goes home, no actions, no count-up, no celebration — the growth marks stay                 |

## Records and settings parts

Records is one page, max 1120: the `figures-row`, then 8/4 rows — reach (`ring-stack`
and each topic's `disclosure`) beside weak (`weak-list`), then the `dot-calendar` beside
the `milestone-list`. The page scrolls; nothing scrolls inside itself except an opened
breakdown that outgrows its card. Nothing is lit.

| Part             | Value                                                                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `figures-row`    | Five cells across one card, parted by 2px `border-border` rules: the name in `label` (muted), the figure in `number-md font-display`, an optional note in muted `caption` ("longest 21 days", "auto"). Below `pc`: two across |
| `disclosure`     | One 48-tall row over a hairline: "topic breakdown" (`body`) with a chevron at the right, turned to point right when closed; `aria-expanded`; hover `bg-raised`                                                                |
| `bar-list`       | Under an open disclosure. Per row: subtopic (`caption`, muted), a 8-tall pill `bg-foreground` on `bg-raised` relative to the topic's largest, the count (`text-count`, right-aligned). No percentages                         |
| `dot-calendar`   | Last 12 weeks, one column per week (oldest left), rows Monday to Sunday. Dots 14 across, 6 apart. The `week-row` states, but done is a `bg-foreground` dot — a 14 dot cannot carry the check that gives `energy` its contrast |
| `milestone-list` | Per row the subject (`label`, muted) and the milestones earned ("7 · 14 · 30", `text-count`). Streak first, then topic order. Empty: "none yet", muted `body`                                                                 |
| `weak-list`      | A title with ⓘ; per row the kind (`label`, muted) and its names (`body`, "、" between), weakest first. No row for an empty kind; neither: "none right now". No count, no rate, never a colour                                 |

Settings is one page: the `section-list` beside rows max 720.

- `section-list`: 200 wide, sticky 32 from the top, links to `#cards`, `#level`, `#app`
  and `#account`, each a pill 44 tall; the section in view is current (the sidebar's ink
  border and `aria-current="true"`). Below `pc`: a row of the same pills under the
  heading. Each section opens with a `heading` and its `id`.
- `settings-row`: between 2px `border-border` hairlines, at least 64 tall: the label
  (`body`) and its one-line note (muted `caption`) at the left, the control at the
  right. A control too wide for that — the topics, the focus chips, the level picker —
  takes the row's full width under its label. Every control, refusal and save behaves as
  the row always did.

## Dialog, info tip, toast, empty, skeleton

- `dialog`: centered at every width, max 440, `bg-popover rounded-panel` with a 2px
  `border-border`, padding 28, over a 70% `canvas` scrim; the title in `heading`, 24
  between blocks, the actions side by side at the foot with the main one at the right.
  The pause dialog lists the drill's keys between a hairline and its actions — only in
  keys mode. The leave dialog, asked when a link or Back would leave a round under way,
  is the pause dialog's recipe with its own title ("leave the round?"), the resume hint,
  "leave" in place of "stop" and no key list. Focus is trapped and waits on "continue",
  which Escape presses. The talk's W4 and settings' retest confirmation take the same
  frame, and so does deleting a card from a talk: "keep" is the main action, at the
  right, first focus and Esc; "delete" removes the card and its progress and goes on to
  the next card.
- `info-tip`: a 44 hit area around a 16 ⓘ glyph beside a section title; pressing it
  opens one muted `caption` line under the title in place (`aria-expanded`); hover
  `text-foreground`. For a definition someone needs once.
- `toast`: bottom centre of the viewport, 24 up — in the shell, centred on the content
  area; max 440, `bg-raised rounded-control` with a 2px `border-border`, padding 14 /
  16, the notice glyph 12 before a `text-foreground` line. Gone after 4 s
  (`TUNING.toastMs`), shown again for each new failure; it takes no press
  (`pointer-events-none`) and speaks through a `role="status"` region that stays
  mounted. Never red. No success toast, ever. `apps/web/src/drill/toast.tsx` is this
  recipe.
- `empty-state`: a `bg-card rounded-panel` panel with a 2px `border-border`, a
  `heading`, at most one muted line and one `secondary` button. A path with no screen is
  this panel alone, centred in the window with no navigation, its button a link home
  that Space and Enter press (`apps/web/src/not-found.tsx`); a drill error is the same
  panel centred on the focus stage.
- `skeleton`: after 300 ms of home's loading, `bg-raised` blocks the size of the panels,
  each with its part's radius, and no navigation. No text, no spinner, no pulsing.

## Landing

`/` for a visitor who is not signed in, with nothing read from the API and no
navigation. From `pc`: two columns of 6 inside max 1120, vertically centred; below it,
one column with the sample card under the steps.

- Left: the brand in `font-display text-figure-sm`, the app's name in `heading`, the
  drill's three moves — a Japanese prompt, said in English before the timer runs out,
  flipped and graded ○ / × — as numbered steps ("1" in `figure-sm font-display`, the
  move in `body`), then "sign in" as the one `primary`, a link (`Button asChild`) to the
  API's sign-in redirect, led on by → with its Space hint.
- Right: a static sample `drill-card` front — topic line, a prompt, a timer bar part run
  — `aria-hidden`: the product's own face is the hero. No illustration, no feature
  paragraphs, no second action.

## Confetti layer

For a streak that grew and a milestone only (the behavior reference's celebration rows).

- 30 code-native pieces — bars, dots, squares and triangles, 6 to 12 across — in
  `energy`, `energy-lip` and `good`, burst from the streak figure and landing around it
  within the hero, never over the cards or the actions. 2.5 s, ease-out; then the layer
  is gone.
- An absolutely positioned layer inside the hero, `pointer-events-none` and
  `aria-hidden`, clipped to the hero so it never overlaps what follows. Drawn with CSS
  transforms on plain elements: no canvas, no library, no image.
- Under reduced motion it never mounts. It never plays on a re-read summary or a later
  round the same day.
