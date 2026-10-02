# Behavior

Motion, celebration, sound, keys, accessibility, and the implementation rules a screen
cannot express in a class list.

## Motion

Each card's feedback finishes within 320 ms; then the next front is drawn and its timer
starts. No 3D flip, no full-screen flash, no shake, and nothing moves on a miss.
Confetti belongs to the celebration below and to nothing else.

| Moment                       | Normal                                                                                                                                                                                                                      | Reduced motion                 | Sound                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------- |
| Flip (by hand or on timeout) | The front's content slides 8px up and fades out, the back's rises 8px in. 180 ms, ease-out                                                                                                                                  | Instant swap                   | none                            |
| ○, normal                    | The answer turns `text-good-ink` over 160 ms and the progress bar's fill grows by one card; both hold through the feedback                                                                                                  | The same colors, no transition | ○ sound                         |
| ○, fast                      | The same, plus "fast n.n s" rising 8px as it appears. 320 ms                                                                                                                                                                | The mark shown at once         | ○ sound, one step up            |
| Combo +1                     | The chip scales to 1.15 and back in 120 ms                                                                                                                                                                                  | The figure just changes        | combo sound                     |
| Combo breaks                 | The chip fades out in 120 ms                                                                                                                                                                                                | Gone at once                   | none                            |
| △                            | The answer stays `ink`, and the progress bar's fill grows by one card on a first pass                                                                                                                                       | The same, no transition        | ○ sound                         |
| ×                            | The answer's text fades to `text-muted-foreground` over 160 ms, then the next front. Nothing bounces                                                                                                                        | Instant                        | none                            |
| Timeout                      | Flips by itself, as above, onto the `grade-trio`. The answer stays `ink`: it is there to be read                                                                                                                            | Instant                        | none                            |
| Next card                    | Fades in over 120 ms                                                                                                                                                                                                        | Instant                        | none                            |
| A button pressed             | The face drops 4px onto its lip while held (`translate-y-1`), 60 ms; it rises on release                                                                                                                                    | The same, no transition        | none                            |
| A round finished             | Only values that changed count up, top to bottom, 150 ms apart, each at most 600 ms; a grown segment grows over 600 ms; "+N pt" pops in (500 ms, an overshoot ease). Unchanged values start final                           | Every value final at once      | `closing`                       |
| A streak that grew           | The day's first finished round: a confetti burst from the streak figure (the components reference's confetti layer), 2.5 s ease-out; the figure pops (600 ms) with the flame (800 ms); today's week disc checks in (500 ms) | No confetti; everything final  | `fanfare` in place of `closing` |
| A milestone                  | Each card appears over 200 ms, 150 ms apart, streak first; and the burst, when the streak did not already burst                                                                                                             | Cards at once; no confetti     | `fanfare`, once per screen      |
| Difficulty up                | The line is set in `text-good-ink`                                                                                                                                                                                          | Same                           | part of the round's sound       |
| "See all" opens or closes    | Height grows over 200 ms, ease-out                                                                                                                                                                                          | Instant                        | none                            |
| Re-reading today's summary   | No count-up, no pop, no confetti; every value final; this session's growth marks stay                                                                                                                                       | Same                           | none                            |
| Page hidden                  | Stop the timer, hide the front, show the pause dialog; it is still there when the page returns                                                                                                                              | Same                           | none                            |
| Back or a link mid-round     | Stop the timer, hide the front, show the leave dialog; "continue" restarts the timer where it stopped, "leave" goes where Back or the link pointed                                                                          | Same                           | none                            |

- "Fast" is a ○ flipped within half the card's pace, derived from the model answer's
  length, never within half the time limit the learner chose — a 30-second limit would
  make almost every ○ fast. Both are starting values, kept in configuration.
- A streak grows once a day: a later round the same day finishes as "a round finished" —
  no confetti, `closing` — and so does a round that grew nothing.
- The timer bar is information, so it keeps shrinking under reduced motion (stepping
  once a second is fine). It carries `data-motion="essential"`, the one exemption from
  the global reduced-motion rule in `globals.css`. Every celebration has the still form
  in the table: the values and the marks are the same, only the movement goes.
- A hover changes a fill or a colour at once; it never animates position or size.
- A motion library, if one is added, goes through the same reduced-motion branch.

## Sound

| Sound     | When                                                                                                                           | Length  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ | ------- |
| ○         | The moment ○ or △ is pressed (one step higher when fast); in vocabulary too                                                    | ~80 ms  |
| Combo     | The moment the combo reaches 2 or more — replacing the ○ sound, not layered                                                    | ~100 ms |
| ○ (talk)  | The moment the talk marks a turn ○ (nothing worth fixing) — the drill's ○ sound, never the fast one                            | ~80 ms  |
| `closing` | The moment the round's summary appears: E5, G5, C6, 0.2 s each                                                                 | ~600 ms |
| `fanfare` | In place of `closing` when the streak grew or a milestone was reached: `closing`'s three notes, then E6 (1318.51 Hz) for 0.3 s | ~900 ms |

Four sounds only — the talk reuses the ○, and `fanfare` replaces `closing` rather than
playing on top of it, at most once per screen; nothing for ×, timeout or an error, and
nothing on re-reading a summary. All are short tones in the same triangle wave — no
voice, no applause. On by default, switched off in settings or with home's speaker.
Browsers block autoplay, so the first "start" press unlocks audio.

## Keys

| Key                                | Front                        | Back (flipped by hand)                         | Back (timed out) | Elsewhere                                                                                                                                                                  | Talk session                                                                                               |
| ---------------------------------- | ---------------------------- | ---------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Space                              | flip                         | —                                              | —                | The screen's primary action on the start and summary screens                                                                                                               | Starts voice input in an empty W3a/W3b field; sends during a voice session                                 |
| Enter                              | flip                         | —                                              | —                | Same                                                                                                                                                                       | Sends inside a field and during a voice session; "hide and say it" in W3e, "said it" in W3f                |
| × key (← / 1 / J / D until chosen) | —                            | × forgot (忘れた)                              | same             | —                                                                                                                                                                          | — (no self-grading)                                                                                        |
| △ key (2 until chosen)             | —                            | △ unsure (微妙)                                | same             | —                                                                                                                                                                          | — (no self-grading)                                                                                        |
| ○ key (→ / 3 / K / F until chosen) | —                            | ○ remembered (覚えてた)                        | same             | —                                                                                                                                                                          | — (no self-grading)                                                                                        |
| ↑ / ↓                              | —                            | scroll inside the card, only when it overflows | same             | The browser's page scroll                                                                                                                                                  | The browser's page scroll                                                                                  |
| Esc                                | open the pause dialog        | same                                           | same             | Close a dialog (pause, leave: continue). Home on records, settings, and a re-read summary; cancel on the retest confirmation; nothing on the not-enough-cards start screen | Cancels a voice session, restoring the field; otherwise opens the leave dialog (W4); inside it, "continue" |
| ?                                  | open the pause dialog        | same                                           | same             | —                                                                                                                                                                          | —                                                                                                          |
| ✕ (focus strip, click or Enter)    | open the pause dialog        | same                                           | same             | Home at once on the drill's start screen, a summary and a recap                                                                                                            | Opens the leave dialog (W4)                                                                                |
| The browser's Back                 | the leave dialog             | same                                           | same             | Leaves at once — nothing is in progress                                                                                                                                    | Opens the leave dialog (W4)                                                                                |
| Tab                                | moves focus, on every screen |                                                |                  | The skip link first on a shell page                                                                                                                                        | moves focus                                                                                                |

- Seconds to flip run from the moment the front is drawn to the flip key or click.
- Space and Enter on any back do nothing, the timed-out one included: a grade cannot be
  skipped. The vocabulary session takes the same keys, without a timer.
- For 150 ms after a back appears, all three grade keys are ignored, so the flip's
  momentum cannot grade the card.
- The ×, △ and ○ keys are the learner's, set in settings' app section and stored on the
  server beside the sound, as `KeyboardEvent.code` values so a choice holds on any
  layout or input method. Until three are chosen they are ← and 1 for ×, 2 for △, → and
  3 for ○, with J/D and K/F grading × and ○ from the home row while the default is kept;
  chosen keys grade alone. Only ↑ ↓ ← →, 0–9 and A–Z can be chosen, so Space, Enter, Esc
  and `?` stay the drill's, and no two grades share a key — the picker refuses the rest
  on the press, and the server refuses it too. A stored pair maps to × and ○, and △
  takes `Digit2`, or `KeyS` if the pair holds it, then `ArrowDown`.
- A grade key never scrolls. With ↑ or ↓ chosen as one it grades, and the card scrolls
  with the other arrow, a swipe or the wheel.
- On records and settings ←/→ do nothing, except that a grade key button waiting for a
  key takes whatever comes next (Esc gives up and stays on the page).

### Key hints

Hints are for whoever uses keys, and nobody else. `apps/web/src/lib/key-mode.tsx`
listens for the first key press on any screen (modifiers and Tab do not count), sets
`data-keys` on `<html>` and remembers it in local storage, so from then on every `Kbd`
shows at its control's edge and the pause dialog lists the drill's keys — the learner's
own ×, △ and ○ keys among them. A learner who only uses the mouse or touch never sees
one. `?` opens the pause dialog from any drill face, so the list is one key away for
someone who wonders.

## Accessibility

| Item               | Floor               | Here                                                                                                                                                                                                                                                                                     |
| ------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text contrast      | 4.5:1               | All body text, labels and figures, in both themes — measured in the foundations reference                                                                                                                                                                                                |
| Non-text contrast  | 3:1                 | Control borders, bar and ring fills, week discs, a figure's outline, the focus outline, in both themes                                                                                                                                                                                   |
| Focus              | visible             | A 2px outline in `focus` (`ink`), 2px offset — global in `globals.css`. Never a colour                                                                                                                                                                                                   |
| Keyboard           | everything          | The keys above; first run through settings without a mouse. Mouse and keyboard are equal                                                                                                                                                                                                 |
| Hover              | never alone         | Every control's hover is a fill or a colour; nothing is reachable only by hovering                                                                                                                                                                                                       |
| Reduced motion     | the OS setting      | The reduced column above. No in-app toggle                                                                                                                                                                                                                                               |
| Theme              | the OS setting      | Light or dark from `prefers-color-scheme`. No in-app switch                                                                                                                                                                                                                              |
| Not by color alone | —                   | The foundations reference                                                                                                                                                                                                                                                                |
| Landmarks          | one each            | A skip link first, then one `nav` ("menu") before one `main` on a shell page; a focus page has `main` alone                                                                                                                                                                              |
| Announcements      | state changes       | `aria-live="polite"`: on a front, "front, the prompt, n seconds"; on timeout, "timed out"; each grade by its name ("forgot", "unsure", "remembered"); a re-ask front with "again" first; a vocabulary front as "front" and its definition. Never the seconds ticking; never the confetti |
| Names              | every glyph button  | Sound: "on"/"off" with `aria-pressed`. ✕ by what it does ("pause", "close", "end"), the navigation's links by their own names (glyph-only below 640). "See all", ⓘ and the record breakdowns use `aria-expanded`. After a break, "day 1 from today, longest n days"                      |
| Voice input        | the talk's 「話す」 | The label changes to 「聞いています」 while listening, announced by a polite status; no `aria-pressed`. Esc's cancel is announced 「取り消しました」; the microphone error line is a `role="status"`                                                                                     |
| Hit targets        | 44 × 44             | Buttons are 52 tall; icon buttons and navigation items 44                                                                                                                                                                                                                                |

Screen specifics:

- The pause and leave dialogs trap focus and land it on "continue", including when the
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

- One box shadow, the lip (`shadow-lip`); nothing else casts one.
- Start the timer from when the front was actually drawn, so a render delay is not
  counted against the learner.
- On `visibilitychange` to `hidden`, stop the timer and show the pause dialog. Coming
  back to `visible` does not resume: the dialog waits for "continue". A window `blur`
  with the page still visible does not pause.
- From a round's first front until it closes, every navigation away — a link, Back —
  goes through the router's navigation blocker (`useBlocker`,
  `apps/web/src/drill/use-leave-guard.ts`): the drill pauses and the leave dialog asks.
  The pause dialog's "stop" navigates with `ignoreBlocker`, having asked already. A
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
- The viewport meta is `width=device-width, initial-scale=1` and nothing else.
- A text field is at least 16 (`text-body`), so a phone's browser never zooms the page
  in on focus — a zoom it keeps after blur. Never `maximum-scale` or `user-scalable` in
  the viewport instead: they take pinch zoom away too.
