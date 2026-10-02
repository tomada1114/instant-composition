# Behavior

Motion, sound, keys, accessibility, and the implementation rules a screen cannot express
in a class list.

## Motion

Each card's feedback finishes within 320 ms; then the next front is drawn and its timer
starts. No 3D flip, no confetti, no full-screen flash, no shake.

| Moment                       | Normal                                                                                                                                                    | Reduced motion                 | Sound                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------- |
| Flip (by hand or on timeout) | The front's content slides 8px up and fades out, the back's rises 8px in. 180 ms, ease-out                                                                | Instant swap                   | none                      |
| ○, normal                    | The answer turns `text-accent` over 160 ms and the current tick lights; both hold through the feedback                                                    | The same colors, no transition | ○ sound                   |
| ○, fast                      | The same, plus "fast n.n s" rising 8px as it appears. 320 ms                                                                                              | The mark shown at once         | ○ sound, one step up      |
| Combo +1                     | The figure scales to 1.15 and back in 120 ms                                                                                                              | The figure just changes        | combo sound               |
| Combo breaks                 | The combo fades out in 120 ms                                                                                                                             | Gone at once                   | none                      |
| ×                            | The answer's text fades to `text-muted-foreground` over 160 ms, then the next front. Nothing bounces                                                      | Instant                        | none                      |
| Timeout                      | Flips by itself, as above. The answer stays white: it is there to be read                                                                                 | Instant                        | none                      |
| Next card                    | Fades in over 120 ms                                                                                                                                      | Instant                        | none                      |
| Summary screen               | Only values that changed count up, top to bottom, 150 ms apart, each at most 600 ms. A ring's new segment grows over 600 ms. Unchanged values start final | Every value final at once      | closing sound, once       |
| Difficulty up                | The line is set in the accent                                                                                                                             | Same                           | part of the closing sound |
| Milestone                    | Each card appears over 200 ms; several are 150 ms apart, streak first                                                                                     | All at once                    | part of the closing sound |
| "See all" opens or closes    | Height grows over 200 ms, ease-out                                                                                                                        | Instant                        | none                      |
| Re-reading today's summary   | No count-up; every value final; this session's accent stays                                                                                               | Same                           | none                      |
| Page hidden                  | Stop the timer, hide the front, show the pause sheet; it is still there when the page returns                                                             | Same                           | none                      |
| A tab or Back mid-round      | Stop the timer, hide the front, show the leave sheet; "continue" restarts the timer where it stopped, "leave" goes where the tab or Back pointed          | Same                           | none                      |

- "Fast" is a ○ flipped within half the card's pace, derived from the model answer's
  length, never within half the time limit the learner chose — a 30-second limit would
  make almost every ○ fast. Both are starting values, kept in configuration.
- The timer bar is information, so it keeps shrinking under reduced motion (stepping
  once a second is fine). It carries `data-motion="essential"`, the one exemption from
  the global reduced-motion rule in `globals.css`.
- A motion library, if one is added, goes through the same reduced-motion branch.

## Sound

| Sound    | When                                                                                                | Length  |
| -------- | --------------------------------------------------------------------------------------------------- | ------- |
| ○        | The moment ○ is pressed (one step higher when fast)                                                 | ~80 ms  |
| Combo    | The moment the combo reaches 2 or more — replacing the ○ sound, not layered                         | ~100 ms |
| ○ (talk) | The moment the talk marks a turn ○ (nothing worth fixing) — the drill's ○ sound, never the fast one | ~80 ms  |
| Closing  | The moment the summary screen appears                                                               | ~600 ms |

Three sounds only — the talk reuses the ○; nothing for ×, timeout or an error. On by
default, switched off in settings or with the start screen's speaker. Short single
electronic tones — no voice, no applause. Browsers block autoplay, so the first "start"
press unlocks audio.

## Keys

| Key                            | Front                        | Back (flipped by hand)                         | Back (timed out) | Elsewhere                                                                                                                                                                                   | Talk screen                                                      |
| ------------------------------ | ---------------------------- | ---------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Space                          | flip                         | —                                              | next             | The screen's primary action on the start and summary screens                                                                                                                                | —                                                                |
| Enter                          | flip                         | —                                              | next             | Same                                                                                                                                                                                        | Sends inside a field; "hide and say it" in W3e, "said it" in W3f |
| ○ key (→ / K / F until chosen) | —                            | ○ said it                                      | next             | —                                                                                                                                                                                           | — (no self-grading)                                              |
| × key (← / J / D until chosen) | —                            | × couldn't say it                              | —                | —                                                                                                                                                                                           | — (no self-grading)                                              |
| ↑ / ↓                          | —                            | scroll inside the card, only when it overflows | same             | The browser's page scroll                                                                                                                                                                   | The browser's page scroll                                        |
| Esc                            | open the pause sheet         | same                                           | same             | Close a sheet (pause, leave sheet: continue). Home on records, settings, and a re-read summary; cancel on the difficulty re-test confirmation; nothing on the not-enough-cards start screen | Opens the leave sheet (W4); inside it, "continue"                |
| ?                              | open the pause sheet         | same                                           | same             | —                                                                                                                                                                                           | —                                                                |
| Tab                            | moves focus, on every screen |                                                |                  |                                                                                                                                                                                             | moves focus                                                      |

- Seconds to flip run from the moment the front is drawn to the flip key or click.
- Space on a back does nothing: a grade cannot be skipped.
- For 150 ms after a back appears, ○/× keys are ignored, so the flip's momentum cannot
  grade the card.
- The ○ and × keys are the learner's, set on settings' "app" tab and stored on the
  server beside the sound, as `KeyboardEvent.code` values so a choice holds on any
  layout or input method. Until a pair is chosen they are → and ←, with K/F and J/D
  grading the same way from the home row; a chosen pair grades alone (→/← chosen again
  brings the letters back). Only ↑ ↓ ← →, 0–9 and A–Z can be chosen, so Space, Enter,
  Esc and `?` stay the drill's, and the two grades never share a key — the picker
  refuses the rest on the press, and the server refuses it too.
- A grade key never scrolls. With ↑ or ↓ chosen as one it grades, and the card scrolls
  with the other arrow, a swipe or the wheel.
- On records and settings, ←/→ move between the in-page `tabs` while one of them has
  focus, and Home/End go to the first and last; nowhere else on those screens do they do
  anything, except that a grade key button waiting for a key takes whatever comes next
  (Esc gives up and stays on the screen).

### Key hints

Hints are for whoever uses keys, and nobody else. `apps/web/src/lib/key-mode.tsx`
listens for the first key press on any screen (modifiers and Tab do not count), sets
`data-keys` on `<html>` and remembers it in local storage, so from then on every `Kbd`
shows at its control's edge and the pause sheet lists the drill's keys — the learner's
own ○ and × keys among them. A learner who only touches the screen never sees one. `?`
opens the pause sheet from any drill face, so the list is one key away for someone who
wonders.

## Accessibility

| Item               | Floor              | Here                                                                                                                                                                                                                                                                            |
| ------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text contrast      | 4.5:1              | All body text, labels and figures — measured in the foundations reference                                                                                                                                                                                                       |
| Non-text contrast  | 3:1                | Button borders, ring and bar fills, week dots, the focus outline                                                                                                                                                                                                                |
| Focus              | visible            | White 2px outline, 2px offset — global in `globals.css`. Never the accent                                                                                                                                                                                                       |
| Keyboard           | everything         | The keys above; first run through settings without a mouse                                                                                                                                                                                                                      |
| Reduced motion     | the OS setting     | The reduced column above. No in-app toggle                                                                                                                                                                                                                                      |
| Not by color alone | —                  | The foundations reference                                                                                                                                                                                                                                                       |
| Announcements      | state changes      | `aria-live="polite"`: on a front, "front, the prompt, n seconds"; on timeout, "timed out, to review"; on ○, "said it"; on ×, "to review". Never the seconds ticking                                                                                                             |
| Names              | every glyph button | Sound: "on"/"off" with `aria-pressed`. Pause (Ⅱ) on card screens, ✕ "close" on summaries, ← "back", the tab bar's links by their own names. "See all", ⓘ and the record breakdowns use `aria-expanded`. After a break, read "day 1 from today, longest n days" — never "0 days" |
| Hit targets        | 44 × 44            | Buttons are 60 tall; icon tiles 44                                                                                                                                                                                                                                              |

Screen specifics:

- The pause and leave sheets trap focus and land it on "continue", including when the
  page returns from hidden.
- Summary screens put focus on the heading, announce only final values (never the
  count-up), and read several milestones in the order they appear.
- A back that overflows makes its scroll area focusable, moved with ↑/↓.
- A chip disabled by the two-subtopic limit sits under a heading that reads "2 / 2".
- The last topic kept is `aria-disabled` rather than disabled, so it stays focusable and
  its refusal is announced through a `status` line when pressed.

The time limit is the learner's own setting, from 15 to 60 seconds and 30 by default, so
a screen-reader user who needs longer chooses it there like anyone else. A stated
limitation: nothing extends it past the longest choice, because the limit is the core of
the drill.

## Implementation rules

- No box shadow at all; there is no shadow token.
- Start the timer from when the front was actually drawn, so a render delay is not
  counted against the learner.
- On `visibilitychange` to `hidden`, stop the timer and show the pause sheet. Coming
  back to `visible` does not resume: the sheet waits for "continue". A window `blur`
  with the page still visible does not pause.
- From a round's first front until it closes, every navigation away — a tab, a link,
  Back — goes through the router's navigation blocker (`useBlocker`,
  `apps/web/src/drill/use-leave-guard.ts`): the drill pauses and the leave sheet asks.
  The pause sheet's "stop" navigates with `ignoreBlocker`, having asked already. A
  reload or a closed tab is not asked about (no `beforeunload` prompt): the round
  resumes after either.
- A session belongs to the day it started. The day turns over at 04:00; a session that
  crosses it still counts toward the day it began — today's set, the streak, and the
  "different day" rule for mastery.
- Load the whole day's set, and the backs a retry round needs, when "start" is pressed.
  No loading state between cards: it would distort the timer.
- Starting values tuned by use live in configuration, never in a component: the time
  limits on offer and their default, the pace formula, the "fast" threshold, ring
  milestones, streak milestones and milestone names. The start screen's minutes estimate
  has no value of its own: it counts each card at the learner's chosen limit.
- Errors are words and a glyph, never red: a failed save is a toast and is retried with
  the next answer; practice never stops for it.
- iOS Safari never resizes the layout for its keyboard, so a screen sized from
  `--column-height` sits under it. While a talk field has focus and the visual viewport
  (`visualViewport.height`) is shorter than the layout one (the root's `clientHeight`;
  iOS's `innerHeight` follows the visual one) by a keyboard (more than 100), the talk
  screen fills what is left visible instead: `useKeyboardLift` (`apps/web/src/talk/`)
  writes `visualViewport`'s offset and height onto its `main` as `--visible-top` and
  `--visible-height`, the tab bar hides, the bottom panel rests on the keyboard, and the
  conversation scrolls in the height left, kept at its bottom. A button pressed there
  keeps the field's focus, so the screen does not drop between the press and its click.
  On blur the tab bar returns. A desktop, and Android under `index.html`'s
  `interactive-widget=resizes-content`, resize the layout viewport themselves, so the
  two viewports agree and nothing changes. The drill has no field.
- A text field is at least 16 (`text-alt` for `answer-field`), so iOS Safari never zooms
  the page in on focus — a zoom it keeps after blur, and which pushes the column past
  the screen's edges. Never `maximum-scale` or `user-scalable` in the viewport instead:
  they take pinch zoom away too.
