# Behavior

Motion, sound, keys, accessibility, and the implementation rules a screen cannot express
in a class list.

## Motion

Each card's feedback finishes within 320 ms; then the next front is drawn and its timer
starts. No 3D flip, no confetti, no full-screen flash, no shake.

| Moment                       | Normal                                                                                                                                                    | Reduced motion                               | Sound                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------- |
| Flip (by hand or on timeout) | The front's content slides 8px up and fades out, the back's rises 8px in. 180 ms, ease-out                                                                | Instant swap                                 | none                      |
| ○, normal                    | `shadow-glow` on the card — a 2px accent rim plus a 24px blur at 35% — appears and fades. 240 ms                                                          | The 2px rim alone for 400 ms, no blur        | ○ sound                   |
| ○, fast                      | The rim light, plus `chip/speed` rising 8px as it appears. 320 ms                                                                                         | The rim without blur, the chip shown at once | ○ sound, one step up      |
| Combo +1                     | The figure scales to 1.15 and back in 120 ms                                                                                                              | The figure just changes                      | combo sound               |
| Combo breaks                 | The combo fades out in 120 ms                                                                                                                             | Gone at once                                 | none                      |
| ×                            | The answer's text fades to `text-muted-foreground` over 160 ms, then the next front. Nothing bounces                                                      | Instant                                      | none                      |
| Timeout                      | Flips by itself, as above. The answer stays white: it is there to be read                                                                                 | Instant                                      | none                      |
| Next card                    | Fades in over 120 ms                                                                                                                                      | Instant                                      | none                      |
| Summary screen               | Only values that changed count up, top to bottom, 150 ms apart, each at most 600 ms. A ring's new segment grows over 600 ms. Unchanged values start final | Every value final at once                    | closing sound, once       |
| Difficulty up                | The line glows for 400 ms: a 12px accent blur around the accent text                                                                                      | No glow                                      | part of the closing sound |
| Milestone                    | Each card appears over 200 ms; several are 150 ms apart, streak first                                                                                     | All at once                                  | part of the closing sound |
| "See all" opens or closes    | Height grows over 200 ms, ease-out                                                                                                                        | Instant                                      | none                      |
| Re-reading today's summary   | No count-up; every value final; this session's accent stays                                                                                               | Same                                         | none                      |
| Page hidden                  | Stop the timer, hide the front, show the pause sheet; it is still there when the page returns                                                             | Same                                         | none                      |

- "Fast" is a ○ flipped within half the time limit — a starting value, kept in
  configuration.
- The timer bar is information, so it keeps shrinking under reduced motion (stepping
  once a second is fine). It carries `data-motion="essential"`, the one exemption from
  the global reduced-motion rule in `globals.css`.
- A motion library, if one is added, goes through the same reduced-motion branch.

## Sound

| Sound   | When                                                                        | Length  |
| ------- | --------------------------------------------------------------------------- | ------- |
| ○       | The moment ○ is pressed (one step higher when fast)                         | ~80 ms  |
| Combo   | The moment the combo reaches 2 or more — replacing the ○ sound, not layered | ~100 ms |
| Closing | The moment the summary screen appears                                       | ~600 ms |

Three sounds only; nothing for ×, timeout or an error. On by default, switched off in
settings or with the start screen's speaker. Short single electronic tones — no voice,
no applause. Browsers block autoplay, so the first "start" press unlocks audio.

## Keys

| Key   | Front                        | Back (flipped by hand)                         | Back (timed out) | Elsewhere                                                                                                                                                                                   |
| ----- | ---------------------------- | ---------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space | flip                         | —                                              | next             | The screen's primary action on the start and summary screens                                                                                                                                |
| Enter | flip                         | —                                              | next             | Same                                                                                                                                                                                        |
| → / J | —                            | ○ said it                                      | next             | —                                                                                                                                                                                           |
| ← / F | —                            | × couldn't say it                              | —                | —                                                                                                                                                                                           |
| ↑ / ↓ | —                            | scroll inside the card, only when it overflows | same             | The browser's page scroll                                                                                                                                                                   |
| Esc   | open the pause sheet         | same                                           | same             | Close a sheet (on the pause sheet: continue). Back on record, settings and the re-read summary; cancel on the difficulty re-test confirmation; nothing on the not-enough-cards start screen |
| Tab   | moves focus, on every screen |                                                |                  |                                                                                                                                                                                             |

- Seconds to flip run from the moment the front is drawn to the flip key or click.
- Space on a back does nothing: a grade cannot be skipped.
- For 150 ms after a back appears, ○/× keys are ignored, so the flip's momentum cannot
  grade the card.
- ←/→ are grades and never scroll.

## Accessibility

| Item               | Floor              | Here                                                                                                                                                                                                                      |
| ------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text contrast      | 4.5:1              | All body text, labels and figures — measured in the foundations reference                                                                                                                                                 |
| Non-text contrast  | 3:1                | Button borders, ring and bar fills, week dots, the focus outline                                                                                                                                                          |
| Focus              | visible            | White 2px outline, 2px offset — global in `globals.css`. Never the accent                                                                                                                                                 |
| Keyboard           | everything         | The keys above; first run through settings without a mouse                                                                                                                                                                |
| Reduced motion     | the OS setting     | The reduced column above. No in-app toggle                                                                                                                                                                                |
| Not by color alone | —                  | The foundations reference                                                                                                                                                                                                 |
| Announcements      | state changes      | `aria-live="polite"`: on a front, "front, the prompt, n seconds"; on timeout, "timed out, to review"; on ○, "said it"; on ×, "to review". Never the seconds ticking                                                       |
| Names              | every glyph button | Sound: "on"/"off" with `aria-pressed`. ✕: "pause" on card screens, "close" on summaries. "See all" and the record breakdowns use `aria-expanded`. After a break, read "day 1 from today, longest n days" — never "0 days" |
| Hit targets        | 44 × 44            | Buttons are 56 tall                                                                                                                                                                                                       |

Screen specifics:

- The pause sheet traps focus and lands it on "continue", including when the page
  returns from hidden.
- Summary screens put focus on the heading, announce only final values (never the
  count-up), and read several milestones in the order they appear.
- A back that overflows makes its scroll area focusable, moved with ↑/↓.
- A chip disabled by the two-subtopic limit announces why.

A stated limitation: the time limit is the core of the drill, so there is no setting
that extends it for screen-reader users.

## Implementation rules

- No box shadow except `shadow-glow`, shown for a moment on a ○.
- Start the timer from when the front was actually drawn, so a render delay is not
  counted against the learner.
- On `visibilitychange` to `hidden`, stop the timer and show the pause sheet. Coming
  back to `visible` does not resume: the sheet waits for "continue". A window `blur`
  with the page still visible does not pause.
- A session belongs to the day it started. The day turns over at 04:00; a session that
  crosses it still counts toward the day it began — today's set, the streak, and the
  "different day" rule for mastery.
- Load the whole day's set, and the backs a retry round needs, when "start" is pressed.
  No loading state between cards: it would distort the timer.
- Starting values tuned by use live in configuration, never in a component: the time
  limit formula, the "fast" threshold, ring milestones, streak milestones, milestone
  names, and the minutes-per-card estimate on the start screen.
- Errors are words and a glyph, never red: a failed save is a toast and is retried with
  the next answer; practice never stops for it.
