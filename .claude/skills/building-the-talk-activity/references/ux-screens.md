# Talk practice: screens

The flows, cross-cutting behavior and decisions are in [ux-flows.md](ux-flows.md).

- **Input:** [requirements.md](requirements.md) (settled). It is the source of truth for
  what the feature does; this file covers only the screens and flows. Copy and details
  may be adjusted to designing-ui.
- **Foundation:** `designing-ui` (the "instrument" rules, components and behavior) and
  `building-web-screens`.
  - Rules for color, type, spacing, motion, keys and accessibility belong to those
    skills and are not repeated here.
  - What is decided here is only what is new, and which existing components are used
    where.
- **Premise:** a single phone-width column (390 × 844). On a PC it fits the column
  designing-ui sets, at most 420 wide and 720 high.
- **How to read the wireframes:** the right-hand border is left off (Japanese widths
  break it). Text to the right of "←" is an annotation.

## 1. Screen list

| #   | Screen                                            | Requirement served          | States                                               |
| --- | ------------------------------------------------- | --------------------------- | ---------------------------------------------------- |
| W1  | Bottom tabs (four)                                | §3.1 entry                  | —                                                    |
| W2  | The talk start screen (the 「会話」 ("talk") tab) | §3.1                        | before start / preparing / could not start           |
| W3  | The talk screen                                   | §3.1 to 3.4                 | W3a to W3h (the bottom panel changes with each step) |
| W4  | Leave-confirmation sheet                          | §3.1 ending midway          | 1 or more turns / 0 turns                            |
| T   | Failure notice (toast)                            | edge cases of §3.1 and §3.3 | disappears after 4 seconds                           |

- The route is `/talk`. W2 and W3 are two states of the same route. Reloading during a
  talk does not keep that talk (as the requirements say).
- The history list, settings and the voice screen are not in the first version.

## 2. Wireframes

### W1 Bottom tabs

```
├──────────┬──────────┬──────────┬──────────
│  [家]    │ [吹出し] │  [棒]    │  [歯車]
│  ホーム  │   会話   │   記録   │   設定
└──────────┴──────────┴──────────┴──────────
```

- Three equal cells become four. The other rules (the current-tab mark, color,
  height 49) stay as in designing-ui's tab bar.
- A new glyph for 「会話」 (a speech-bubble line drawing, 20) is added.
- Pressing a tab during a talk opens W4 (treated the same as the drill's leave sheet).

### W2 The talk start screen

```
┌──────────────────────────────────────
│ 会話                                    ← eyebrow
│
│
│                 6                       ← the figure (number-xl)
│               ターン                    ← mono-sm, muted
│
│
│ ┌────────────────────────────────
│ │ 場面はおまかせ                        ← panel (home-panel build). One line, muted
│ │ [              始める              ]  ← primary
│ └────────────────────────────────
├──────────┬──────────┬──────────┬──────────
│  ホーム  │  会話 ▔  │   記録   │   設定
└──────────┴──────────┴──────────┴──────────
```

| State           | Panel contents                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------- |
| Before start    | 「場面はおまかせ」 ("scene is up to us") and 「始める」 ("start")                               |
| Preparing       | 「始める」 cannot be pressed and the text becomes 「用意しています」 ("preparing"). No spinner  |
| Could not start | Heading 「始められませんでした」 ("could not start") and 「もう一度」 ("once more") (secondary) |

- What is prepared is the scene and the partner's first line (one LLM call). When it is
  ready the screen moves to W3.

### W3 The talk screen (basic shape)

```
┌──────────────────────────────────────
│ ━━ ━━ ━━ ── ── ──                      ← 6 ticks. Done: white / now: grey / to come: line
│ ✕               3 / 6                  ← top bar. End (✕), progress (mono-sm, muted)
├──────────────────────────────────────
│ 場面                                    ← eyebrow
│ 近所のカフェ。顔なじみの店員が、           ← muted, 1 to 2 lines of Japanese
│ 会計のあとに話しかけてくる。
│ ────────
│ 相手                                    ← the speaker's eyebrow
│ Haven't seen you in a while.           ← English line (the English typeface)
│ あなた
│ 仕事が詰まってて                         ← Japanese (muted)
│ I was very busy with work.             ← English
│ 先生
│ （お手本と要点。W3e の並び）
│ ────────                               ← turn divider
│ 相手                                    ← the current turn is white, earlier turns are muted
│ Oh no. What kept you so busy?
├──────────────────────────────────────
│ （手ごとの欄。W3a〜W3h）                 ← where the thumb reaches
├──────────┬──────────┬──────────┬──────────
│  ホーム  │  会話 ▔  │   記録   │   設定
└──────────┴──────────┴──────────┴──────────
```

- The top bar and the bottom panel are fixed. Only the conversation between them
  scrolls, and it is carried to the bottom edge when a new line appears.
- The speaker is shown by an eyebrow. No bubbles or frames; turns are separated by a
  hairline (the rule: lines, not frames).
- The current turn is white; earlier turns drop to muted.
- The teacher's words appear in the layout of the drill's answer face (back-self). This
  sets them visually apart from the partner's lines.
- While the keyboard is open, the bottom panel sits on top of the keyboard. How this
  behaves on iOS Safari is settled in §5.

### W3a The Japanese step (step 2)

```
├──────────────────────────────────────
│ 日本語で                                ← eyebrow (the current step)
│ 1 つのことを、短く                       ← guide text for the field (placeholder, muted)
│ ──────────────────────────────         ← field (underline only, no border; answer-field build)
│ [              送る              ]      ← primary. Cannot be pressed while empty
```

### W3b The English step (step 3)

```
├──────────────────────────────────────
│ 英語で                                  ← eyebrow. This heading carries the requirement's 「では英語で」
│ 言える語で言い切る                        ← guide text. A nudge to rephrase
│ ──────────────────────────────
│ ［字形］英語で入力してください             ← only when Japanese characters were entered. Grey, no red
│ [  わからない  ]  [     送る     ]        ← secondary / primary
```

- Giving up with 「わからない」 ("I don't know") goes through W3c (waiting for the
  teacher) to W3e. W3e shows no English row for 「あなた」 ("you").

### W3c Waiting

```
│ 先生                                    ← eyebrow of whoever speaks next
│ …                                       ← a still 「…」 (muted)
├──────────────────────────────────────
│                                          ← the bottom panel is empty. Nothing pressable shows
```

- The same shape is used when waiting for the teacher (after the English is sent) and
  when waiting for the partner (after the ○, after 「言えた」).
- No spinner, blinking or skeleton (rule).

### W3d ○ (nothing worth fixing)

```
│ あなた
│ 仕事が詰まってて
│ I was swamped with work.  ○            ← the English turns accent and gains a ○. The tick lights up too
│ 相手
│ …                                       ← goes straight to waiting for the partner (W3c)
```

- No praise in words. There is nothing to press; it moves straight on to the partner.
- It changes the way the drill's ○ does (to accent in 160 ms; instantly when reduced
  motion is on).

### W3e Model answer and points (step 4)

```
│ 先生
│ あなた  I was very busy with work.      ← label + the learner's own English (muted). Absent when the learner gave up
│ I've been swamped with work.           ← model answer (white). At most 2 sentences
│ 要点  「詰まってて」→ swamped             ← white label + one line (muted)
├──────────────────────────────────────
│ [            隠して言う            ]     ← primary
```

### W3f After hiding (step 5)

```
│ 先生
│ 声に出して                              ← eyebrow
│ 仕事が詰まってて                         ← the learner's own Japanese is kept as a cue (muted)
│ ───── ──── ── ─────                    ← where the model answer was. Hidden lines
│ 要点  「詰まってて」→ swamped             ← the point stays
├──────────────────────────────────────
│ [ もう一度見る ]  [     言えた     ]      ← secondary / primary
```

- 「もう一度見る」 ("look again") returns to W3e. The number of presses is recorded.
- 「言えた」 ("I said it") goes on to wait for the partner (W3c). Nothing is checked.

### W3g The partner's reply does not arrive

```
│ 相手
│ ［字形］返事を受け取れませんでした         ← muted. No red
├──────────────────────────────────────
│ [            もう一度            ]       ← secondary
```

### W3h The end

```
│ 相手
│ Good to see you. Have a nice weekend.  ← closing line of turn 6
│ ──────── おわり ────────                ← an eyebrow between lines
├──────────────────────────────────────
│ [            新しい会話            ]     ← primary. Pressing it goes to W2's 「用意しています」
```

- Ending with 「終える」 ("end"), or a talk the server no longer takes (ux-flows §4.4),
  gives the same shape (no closing line; it starts from 「おわり」("the end")).
- The ✕ in the top bar goes away. After the end, the learner can leave straight from a
  tab (nothing is lost).
- The conversation stays on this screen. No control is added for reading it back.

### W4 Leave-confirmation sheet

```
┌──────────────────────────────────────
│ （会話の画面に、70% の幕）
├──────────────────────────────────────
│ 会話を終えますか                         ← heading
│ ここまでの 2 ターンは残ります              ← one line. With 0 turns: 「この会話は残りません」
│ [             終える             ]       ← secondary
│ [             続ける             ]       ← the main action. First focus. Esc also means 「続ける」
└──────────────────────────────────────
```

- It opens from ✕, a tab, or the browser's back (built like the drill's leave sheet).
- Where 「終える」 goes depends on what opened the sheet.
  - From ✕, to W3h.
  - From a tab or back, to that destination.
- With 1 or more turns, the talk is saved to the history.
- Closing the page or reloading does not ask (no confirmation is shown). That talk is
  not kept.

### T Failure notice (toast)

```
│ ［字形］判定できなかったので、先へ進みます   ← bg-raised. Disappears after 4 seconds. Not pressable
```

- No success notices are shown (rule). The wording is in §4.4.
