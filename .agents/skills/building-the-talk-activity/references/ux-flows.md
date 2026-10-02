# Talk practice: flows

The screen list and wireframes (W1 to W4, T) are in [ux-screens.md](ux-screens.md).

- **Input:** [requirements.md](requirements.md) (settled). It is the source of truth for
  what the feature does; this file covers only the screens and flows. Copy and details
  may be adjusted to designing-ui.
- **Foundation:** `designing-ui` (the "Lemon Arcade" rules, components and behavior) and
  `building-web-screens`.
  - Rules for color, type, spacing, motion, keys and accessibility belong to those
    skills and are not repeated here.
  - What is decided here is only what is new, and which existing components are used
    where.
- **Premise:** a laptop browser first; the layout collapses to one column below 1024. W2
  sits in the shell at most 720 wide; W3 is a column at most 720 wide centred on the
  focus stage.
- **How to read the wireframes:** the right-hand border is left off (Japanese widths
  break it). Text to the right of "←" is an annotation.

## 3. Flows

### F1 Start a talk and end it

1. On the 「会話」 tab (W2), press 「始める」.
2. While 「用意しています」 shows, the scene and the partner's first line are made.
3. The screen moves to W3, showing the scene and the partner's first line.
4. One turn (F2) is repeated 6 times.
5. On turn 6, the partner closes while staying in role. It becomes W3h (the end), and
   the talk is saved.
6. 「新しい会話」 ("new talk") goes back to step 2.

```
[W2 会話のタブ] -> [始める] -> [用意しています] -> [W3 1 ターン目] -> … -> [6 ターン目の締め] -> [W3h おわり] -> [新しい会話]
                                     |                                                          |
                                     v                                                          v
                          [始められませんでした] -> [もう一度]                         [保存に失敗] -> [トースト]
```

### F2 One turn

1. The partner's line appears.
2. In W3a, enter Japanese and send it.
3. In W3b, enter English and send it. If the learner cannot, 「わからない」.
   - If Japanese characters are in the field, it is not sent and the screen stays on
     W3b.
4. Wait for the teacher (W3c). There are three destinations.
   - Nothing worth fixing: W3d (○), then to 5.
   - Worth fixing, or 「わからない」: W3e (model answer and points),
     then 「隠して言う」("hide and say it"), then W3f, then 「言えた」, then
     to 5. 「もう一度見る」 in W3f returns to W3e.
   - Judgment failed: show the toast and go to 5.
5. Wait for the partner (W3c).
   - When it arrives, it becomes 1 of the next turn. On turn 6, the closing line leads
     to W3h.
   - If it does not arrive, W3g, then 「もう一度」.

```
[相手の台詞]
    |
[W3a 日本語] --送る--> [W3b 英語] --送る / わからない--> [W3c 先生 …]
                                                            |
            +-----------------------+-----------------------+
            v                       v                       v
     [W3d ○ 直しなし]      [W3e お手本と要点] <---+     [判定に失敗]
            |                       | 隠して言う   |         | トースト
            |                       v             | もう一度見る
            |               [W3f 隠したあと] -----+         |
            |                       | 言えた                |
            +-----------------------+-----------------------+
                                    v
                             [W3c 相手 …] --届かない--> [W3g] --もう一度--> [W3c 相手 …]
                                    |
                                    v
                       [次のターンの相手の台詞]（6 ターン目なら締めて W3h）
```

### F3 End midway

```
[W3 手の途中] --✕ / タブ / 戻る--> [W4 終えますか] --続ける / Esc--> [元の手]
                                         |
                                         | 終える
                                         v
                       1 ターン以上 → 記録に残す ／ 0 ターン → 残さない
                                         |
                ✕ から → [W3h おわり]　　タブ・戻るから → [その行き先]
```

- Reloading or the device discarding the page leaves the server's talk open until its
  expiry. Returning to `/talk` on the same browser reads it during W2's preparing state,
  restores the kept conversation and continues after the last kept turn; the interrupted
  recital is skipped. No key on another browser means W2 as usual.
- Explicitly ending or discarding removes the local id. A read that finds no open talk
  also clears it, quietly. W4 guards leaving a resumed talk just as a newly opened one.

## 4. Cross-cutting behavior

designing-ui is the source of truth. This section records only what the talk activity
newly decides.

### 4.1 Components

- **Reused:**
  - home-panel (W2)
  - the focus strip and the `talk` progress pills (W3)
  - answer-field (the fields of W3a and W3b)
  - the back-self layout (W3e)
  - the grade pair layout (the two buttons of W3b and W3f; secondary on the left,
    primary on the right)
  - dialog (W4; the leave dialog build)
  - toast, button, eyebrow
  - Note: the drill's typed-answer field and the answer face's 「あなた」 row were
    removed from the code (#317), so the talk screen builds them anew to this document's
    shape: an underline-only field, no border, 300 characters at most, Enter sends.
- **Newly added:** add each to designing-ui's component table first, then build it.
  - The four tabs and the 「会話」 glyph
  - The conversation row (the speaker's eyebrow + body; no frame, separated by a
    hairline)
  - The waiting row (the speaker's eyebrow + a still 「…」)
  - The hidden model answer (the hidden lines of W3f)
  - 「話す」 (voice input at W3a and W3b), its listening look, answer-field's listening
    state, and the voice error line (#395)

### 4.2 Where the accent is used

Only within the four roles the rules name.

- **The one main action of the screen:**
  「始める」, 「送る」, 「隠して言う」, 「言えた」,「新しい会話」
- **The "said it" mark:** the ○ of W3d (the learner's English)
- The model answer is white and failure text is grey. Red is not used.

### 4.3 Waiting display

- Only the eyebrow of whoever speaks next and a still 「…」 are shown (W3c). On W2, only
  the text「用意しています」.
- While waiting, nothing pressable is shown in the bottom panel.
- No target time is set (requirements §4).

### 4.4 Handling failure

| When                                                                                                  | Form             | Text                               | Next                                          |
| ----------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------- | --------------------------------------------- |
| The scene cannot be made (LLM, network)                                                               | W2 panel         | 始められませんでした               | 「もう一度」 (secondary)                      |
| The teacher's judgment fails                                                                          | Toast            | 判定できなかったので、先へ進みます | Waits for the partner automatically           |
| The partner's reply does not arrive (LLM, network)                                                    | The row in W3g   | 返事を受け取れませんでした         | 「もう一度」 (secondary)                      |
| Sending a turn or asking for the reply again finds the talk expired or unknown (`ERR_TALK_NOT_FOUND`) | W3h, and a toast | 記録を保存できませんでした         | None (the talk ends; `endTalk` is not called) |
| Sending a turn or asking for the reply again finds the talk already ended (`ERR_TALK_CLOSED`)         | W3h              | —                                  | None (the talk ends; `endTalk` is not called) |
| Saving the history fails                                                                              | Toast            | 記録を保存できませんでした         | None (the talk ends)                          |

- Any other refusal of those two calls, or no answer, is W3g and its 「もう一度」.
- Shown by text and glyph, with no red (rule).

### 4.5 Input rules

| Field    | Rule                                        | When the rule is broken                                                                                                                        |
| -------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Japanese | 1 to 300 characters                         | 「送る」 cannot be pressed while empty. Input stops at 300 characters                                                                          |
| English  | 1 to 300 characters. No Japanese characters | 「送る」 cannot be pressed while empty. With Japanese characters it is not sent, and one line 「英語で入力してください」 shows under the field |

- Enter sends, except the Enter that confirms an input-method conversion (same as
  answer-field).
- The field grows from one line. No spell checking or auto-correction.
- Speech goes through the same rules: what is sent by voice is what 「送る」 would send
  — at most 300 characters (a session stops and sends the first 300), and at W3b typed
  Japanese plus speech is not sent and shows 「英語で入力してください」.
- Voice input's own failures are one muted line with the notice glyph under the field,
  no red, until the next press of 「話す」 or the end of the
  step: 「マイクが使えません」(`not-allowed`,
  `service-not-allowed`), 「マイクが見つかりません」 (`audio-capture`),「音声入力が使えませんでした」 (`network`).

### 4.6 Keys

Add a row for the talk screen to designing-ui's key table.

| Key   | Talk screen                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Space | In an empty W3a/W3b field, starts voice input. During a session, sends                                                                |
| Enter | Sends inside a field, and during a voice session. In W3e it is 「隠して言う」; in W3f it is 「言えた」                                |
| Esc   | During a voice session, cancels it and restores the field. Otherwise opens the leave confirmation (W4). Inside the dialog, 「続ける」 |
| Tab   | Moves focus                                                                                                                           |

- The ○ and × keys are not used (the talk has no self-grading).
- Key hints (Kbd) show, as the rules say, only to someone who has used the keys.

### 4.7 Accessibility

- When a new line appears, `aria-live="polite"` reads the speaker and the body (for
  example: "相手、Haven't seen you in a while.").
- For the ○, it reads 「○、直しなし」. The waiting 「…」 is not read.
- When the model answer is hidden, it reads 「隠しました」. When shown again, it reads
  the model answer.
- W4 traps focus inside and places it on 「続ける」.
- 「話す」 names its state by a label that changes to 「聞いています」, announced
  politely; a cancelled session is announced as 「取り消しました」; the voice error line
  is a status.
- Other standards (contrast, the 44 touch target, the focus line) stay as in
  designing-ui.

### 4.8 Motion

- A new line appears in 120 ms (the same as the drill's "next card").
- The ○ changes to accent in 160 ms.
- With reduced motion on, both change instantly.
- Nothing stops when the page is hidden (there is no clock to stop).

### 4.9 Copy

- On-screen copy is Japanese. How it goes into the catalog follows localizing-ui.
- The copy in this document is a first draft, and copy and details may be adjusted to
  designing-ui.

## 5. Decisions on the open points

- Four sections: 「会話」 is the navigation's second section (#349 moved the navigation
  to a sidebar and a top bar; designing-ui's ledger row and `sidebar` recipe hold it).
- Phones (#398): phones are served by their browser, Safari on iOS and Chrome on
  Android. The web client keeps no keyboard lift — the owner accepted the keyboard over
  the panel rather than the lift's complexity (#398 D1); below 1024 the layout collapses
  to one column. This supersedes the earlier iOS Safari keyboard decision.
- Teacher and partner calls: sent together when the English (or 「わからない」) is sent;
  the partner's line is held until 「言えた」 or the ○, so neither the ○ path nor the
  recital waits on the partner.
- The ○ plays the drill's existing ○ sound, under the same sound on/off setting;
  designing-ui's sound table gains the row.
