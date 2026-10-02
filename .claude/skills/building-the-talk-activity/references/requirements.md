# Talk practice — requirements

## Context

- **Platform and structure:**
  - A web app, used mainly from a PC (laptop) browser.
  - It is added to this repository as a new activity. It builds on the repository's
    structure: a Vite + React SPA, a Hono API on Lambda, DynamoDB, Cognito and CDK.
  - The language model's target provider is Bedrock Converse, called directly. Until the
    dev account can call it, OpenRouter stands in ([design.md](design.md)).
  - It runs in the dev environment (AWS) from the first version.
- **Priorities for the first version:**
  - The top priorities are that the whole flow works end to end, and that it is built to
    the end as a feature with a language model inside it.
  - To lower the technical hurdle, it is text only and the progression is fixed.
  - It is known that this helps little with the learner's English difficulties,
    especially the amount they say aloud.

## 1. Overview

- **What it is:** Practice for talking in English with a partner in a scene. The learner
  first types what they want to say in Japanese, then types it again in English. If the
  English is worth correcting, the teacher gives a short model answer and a one-line
  point. The learner recites it aloud on the spot, then returns to the talk.
- **For whom, and why:**
  - The target is a learner of English whose native language is Japanese. The first user
    is the owner alone.
  - The difficulties it addresses:
    - The learner has something to say in Japanese but cannot put it into English. They
      water the content down to what they can say.
    - They always say things the same way.
    - When they try to explain at length, their sentences fall apart.
- **Core interaction:** A 6-step round trip in one turn (§3.1). If this does not turn
  smoothly, nothing else improves.
- **Guiding idea:** Learn it on the spot. Do not rely on rereading for review later.

## 2. Scope

### First version (MVP)

- The talk: preparing a scene, the 6-step turn, and how it ends (§3.1)
- The partner (§3.2)
- The teacher: prompting for English, judging whether a correction is worth it, the
  model answer and point, and the recital (§3.3)
- Text input and display (§3.4)
- Saving the record of a talk (§3.5). There is no list screen.
- Cards at the end: words, phrasal verbs and phrases the learner could not say, offered
  as vocabulary card candidates under 「おわり」 for the learner to pick; the picked
  ones join the vocabulary activity (#374 §3.7, [design.md](design.md)).

**Exit:** There is no measured condition. Whether to build further or stop is decided by
the owner's own sense of the app.

### Later (future features)

Future features are added in an order decided as the app is used. The order of the table
below is not a priority order.

| Feature                                                                                                                                          | Why it waits                                                                                                               | Condition to bring it forward                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Read-aloud of the partner's lines and the model answer                                                                                           | Voice output carries technical uncertainty; voice input came first (#395)                                                  | When read-aloud is wanted                                                                                         |
| Server-side transcription (OpenRouter's `/api/v1/audio/transcriptions`, `gpt-4o-mini-transcribe`, Amazon Transcribe)                             | Chrome's recognition costs nothing and needs no endpoint (#395 D1)                                                         | When Chrome's recognition proves too inaccurate for the owner's English, or a browser other than Chrome is needed |
| On-device recognition (Chrome's `processLocally`)                                                                                                | A language pack of about 60 MB each; whether `ja-JP` is offered on-device is unverified (#395 D10)                         | When sending audio to Google becomes unacceptable                                                                 |
| A list of records (date and scene; opening one shows its turns), and deleting a record                                                           | The first version needs only to save                                                                                       | After the flow runs                                                                                               |
| Checking the recital (if it is far off, try once more)                                                                                           | It needs a standard for the check, and adds model calls                                                                    | When self-report feels too lenient                                                                                |
| A target for waiting time                                                                                                                        | First run it, then look at the actual waits                                                                                | When the wait bothers the learner                                                                                 |
| Automatic carry-over into the next talk. Example: on a second round of the same scene, the partner creates a chance to use the last model answer | There is no material until records accumulate                                                                              | Decided as the app is used                                                                                        |
| A personal instant-composition drill built from phrases the learner could not say in a talk                                                      | The instant-composition drill needs a change on its side too                                                               | Decided as the app is used                                                                                        |
| Choosing the scene: scenes that follow a roadmap, multiple-choice scenes                                                                         | The first version checks whether random is enough                                                                          | When random does not keep the learner going                                                                       |
| Detecting "the same phrasing every time" across talks, and a coach that builds practice from weak points                                         | It waits for accumulated records. A candidate for a design where the model chooses its own next step (an agent, AgentCore) | Decided as the app is used                                                                                        |
| A path and metrics (such as an IELTS Speaking guide)                                                                                             | How to measure is not decided                                                                                              | Decided as the app is used                                                                                        |
| Switching the native language (other than Japanese)                                                                                              | The first user speaks only Japanese                                                                                        | When others use the app                                                                                           |

### Out of scope

- **A summary to read at the end of a scene.** Reading a batch of feedback has a poor
  tempo and does not last. The card candidates at the end are not one: they are a picker
  of words to add, not feedback to read.
- **Review that assumes rereading the talk.** If the learner would reread, they should
  talk again.
- **Feedback that opens on a tap.** Tapping, expanding and waiting are all a chore, and
  it does not train correcting on the spot.
- **Pointing out errors that are only articles or prepositions.** The effect on being
  understood is small. When a model answer is given, those are corrected in it too.
- **The partner commenting on the quality of the learner's English.** The teacher and
  the partner stay separate.
- **A score or grade for the whole talk.** The app focuses on correcting on the spot.
- **Real-time full-duplex voice conversation (interruptions, backchannels while
  speaking).** Even when voice is added, alternating turns are enough.
- **An iOS app.** Too high a hurdle; phones use the app in Safari or Chrome (#398).
- **Pronunciation assessment.** The app focuses on practice in putting what the learner
  wants to say into English.

## 3. Features

### 3.1 The talk

#### Overview

- **Purpose:** Exchange several turns with a partner in one scene.
- **Entry:** On the bottom tab 「会話」 ("Talk") screen, the learner
  taps 「始める」 ("Start"). The tabs are Home, Talk, Record and
  Settings: 「ホーム」, 「会話」, 「記録」, 「設定」.

#### Specification

| Item                           | Specification                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scene                          | The model picks one at random                                                                                                                                                                                                                                                                                                                                            |
| Scene mix                      | About 2/3 scenes where the learner talks about themselves, about 1/3 scenes with an errand or a small problem                                                                                                                                                                                                                                                            |
| How a scene is shown           | In 1–2 lines of Japanese: who the partner is, where they are, and how they are related                                                                                                                                                                                                                                                                                   |
| Scene difficulty               | Everyday talk only. Avoid specialized topics, heavy topics (politics, religion, medicine and the like), and problems that force a long explanation                                                                                                                                                                                                                       |
| Phrasing of the Japanese       | Step 2 prompts with 「1 ターンで 1 つのことを、短く」 ("One thing per turn, keep it short")                                                                                                                                                                                                                                                                              |
| Flow of one turn               | 1. The partner speaks in English<br>2. The learner types in Japanese<br>3. The teacher prompts for English, and the learner types in English<br>4. If it is worth correcting, the teacher gives a model answer and a point<br>5. The learner hides the model answer and recites it aloud<br>6. The partner returns to the talk (this doubles as step 1 of the next turn) |
| When steps 4 and 5 are skipped | When the teacher judges "not worth correcting". The learner's English gets the ○ mark, and the talk moves to step 6                                                                                                                                                                                                                                                      |
| How it ends                    | After 6 turns, the partner closes naturally, staying in role                                                                                                                                                                                                                                                                                                             |
| Ending early                   | The learner can end at any time with 「終わる」 ("End"). The turns so far are saved as the record                                                                                                                                                                                                                                                                        |

#### Screen behavior

- On start, the scene description and the partner's first line appear.
- At each step, it is clear at a glance what to do now (in Japanese / in English /
  recite).
- The partner's lines, the learner's input and the teacher's words appear in order as a
  flow of talk.
- While waiting for the model, the screen shows that it is waiting.

#### Edge cases

- **The model fails or times out:**
  - If the teacher's judgment fails, skip the judgment and go on to the partner.
  - If the partner's reply fails, show a button to try again.
- **The connection drops:**
  - Before the start, tell the learner that the talk cannot start.
  - Midway, treat it like a model failure (try again).
- **The page reloads or the device discards a tab:** The same browser resumes its open
  talk while the server still holds it (24 hours). Kept turns and feedback return; the
  interrupted recital is skipped. Continue at the next Japanese input, retry a missing
  partner reply, or show the end after a closing reply. This uses one local talk id, not
  a home entry or resume on another device. A missing, expired or closed talk returns
  quietly to the start screen; storage that throws disables resume.
- **The learner explicitly ends the talk:** Its turns are kept, or it is discarded when
  empty; the local id is removed and a later visit starts fresh.

### 3.2 The partner

#### Overview

- **Purpose:** As a person in the scene, get the learner to say a lot.
- **Character:** A friendly local who is interested in the learner.

#### Rules

- A turn is 1–2 sentences. It is never 3 sentences.
- The partner does not ask a question every time. Sometimes it replies with only a short
  reaction, such as "Oh, nice."
- It asks only one question. It does not join two questions with "and" or "or".
- After it tells something about itself, it stops there. It does not add a question
  after its own story.
- It stays 2–3 exchanges on the previous remark and digs into it. When it changes the
  topic, it starts from what the learner said.
- It does not point out input mistakes (typos, or errors from the keyboard's voice
  input). It guesses what the learner meant and responds, and it does not ask to
  confirm.
- It does not comment on the quality of the learner's English.
- It responds to the meaning the learner said in Japanese. Even if the English is
  broken, it goes on as if the meaning got through.
- It speaks in a conversational tone. It uses no bullets, headings, emoji or labels (so
  that the text can be read aloud as it is once voice is added).

### 3.3 The teacher

#### Overview

- **Purpose:** Correct on the spot, and have the learner say it again on the spot.
- **Entry:** Automatic. When the learner sends Japanese, the teacher prompts for
  English. When the learner sends English, the teacher judges it.

#### Specification

| Item                                   | Specification                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt for English                     | After the Japanese is sent, the teacher prompts with 「では英語で」 ("Now in English") and the flow moves to English input                                                                                                                                                                                           |
| Judging whether it is worth correcting | "Worth correcting" if any of these holds<br>- A meaning from the Japanese was dropped in the English<br>- It is unnatural<br>- The sentence fell apart<br>If the only errors are articles or prepositions, it is "not worth correcting"                                                                              |
| When not worth correcting              | The learner's English gets the ○ mark, and the talk goes back to the partner. The app does not praise in words (a design rule of the app)                                                                                                                                                                            |
| Model answer                           | A natural way to say it, meeting these conditions<br>- Short enough to recite: at most 2 sentences, and at most 15 words per sentence<br>- It does not lose the meaning of the Japanese<br>- Long content is split into sentences<br>- It keeps the learner's own phrasing and does not over-replace with hard words |
| When the Japanese is long              | Prioritize the central meaning and fit it into 2 sentences. The point touches in one line on what was dropped                                                                                                                                                                                                        |
| Point                                  | One line, in Japanese, showing the key expression (example: 「詰まってて」 → too much work). Same form when the learner gives up                                                                                                                                                                                     |
| Recital                                | The model answer is shown. It is hidden when the learner taps 「隠して言う」 ("Hide and say"). The learner says it aloud and taps 「言えた」 ("I said it") to return to the partner. 「もう一度見る」 ("Look again") shows the model answer again                                                                    |
| Checking the recital                   | None. Whether the learner said it is left to their own report                                                                                                                                                                                                                                                        |
| Look                                   | The teacher's words look different from the partner's lines                                                                                                                                                                                                                                                          |
| When the learner is stuck              | At the English step, the teacher always prompts: "If you cannot say a word, say it with words you can, and finish the sentence." If it is truly impossible, the learner can give up with the 「わからない」 ("I don't know") button                                                                                  |
| When the learner gives up              | The teacher gives the model answer and the point from the Japanese alone, without the learner's English, and starts the recital (show, then hide). Then the talk goes back to the partner                                                                                                                            |

#### Edge cases

- **The learner types Japanese, not English, at step 3:** Prompt them to type in English
  again.
- **The teacher's judgment fails:** Skip the judgment and go on to the partner.

### 3.4 Input and display

| Item                            | Specification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input                           | Typing, or speech at steps 2 and 3 through the browser's Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`), in Chrome on a PC. No read-aloud                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| When the learner wants to speak | 「話す」, or Space in an empty field, starts one recognition session in the step's language — `ja-JP` at step 2, `en-US` at step 3, nothing to switch. The text heard so far fills the field; 2 s with nothing new heard (`TUNING.speechSilenceMs`) sends it as 「送る」 does, and Space, Enter, 「送る」 or 「聞いています」 send at once. Esc cancels and puts the field back without opening W4. Nothing heard within 10 s (`TUNING.speechNoInputMs`), or `no-speech`, stops quietly. Heard text is appended to typed text (one space in English, none in Japanese), capped at 300 characters, and still meets "no Japanese characters" at step 3. A refused, missing or failed microphone shows one muted line; typing still works. A browser without the API shows no 「話す」. On a phone (#404), Chrome on Android and Safari on iOS behave the same, started by a tap; the 2 s and 10 s rules end a session whether or not Safari does, and Chrome, Firefox and Edge on iOS (`CriOS`, `FxiOS`, `EdgiOS`) show no 「話す」, since their API never starts. Other browsers, tablets as a tuned target, language detection, voice commands and a voice setting are non-goals (#395, #404) |
| Moving on                       | The learner sends with 「送る」 ("Send") in the input field. Steps 2 and 3 are each sent once                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Input length                    | Up to 300 characters at a time. A guard against cost and accidental sends                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Read-aloud                      | None (later)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### 3.5 The record of a talk

| Item                 | Specification                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is kept         | For a talk finished to the end or ended with 「終わる」: the scene, the start and end times, and the content of each turn (the partner's line, the Japanese, the English, the judgment, the model answer, the point, and the number of times 「もう一度見る」 was tapped), and the card candidates its end offered with which were added |
| What is not kept     | An open talk is resumable on this browser until its 24-hour expiry, but is not a permanent record. A talk ended without a single turn is discarded.                                                                                                                                                                                      |
| List                 | Not in the first version (later)                                                                                                                                                                                                                                                                                                         |
| Role of looking back | Looking back is not assumed. The record is material for future features (carry-over into the next talk, cards, a personal instant-composition drill)                                                                                                                                                                                     |
| Retention            | Indefinite                                                                                                                                                                                                                                                                                                                               |
| Deletion             | In the first version, there is no way to delete from the app. It is decided when the list is added                                                                                                                                                                                                                                       |

## 4. Cross-cutting rules

- **Delivery:** The app's dev environment. Used from a PC browser, with the existing
  sign-in.
- **How progression is decided:** The app moves through the 6 steps in order. The model
  answers once per step, as the scene, the partner and the teacher, and once at the end
  for the card candidates. The model is not asked to choose which step comes next.
- **The model:**
  - Call Bedrock Converse directly; OpenRouter stands in until the dev account can
    ([design.md](design.md)).
  - Answer on the spot. Do not queue a request and return the result later.
  - The model is chosen for speed and for understanding Japanese
    ([design.md](design.md)).
  - No target value is set for waiting time.
- **On failure:** Not stopping the talk comes first. The specifics are in each feature's
  "Edge cases".
- **Cost:**
  - Model calls per talk (6 turns) are at most 14: 1 for generating the scene, per turn
    1 for the teacher and 1 for the partner, and 1 at the end for the card candidates of
    a kept talk with a corrected turn. Retries are not counted.
  - The first version sets no cap, because one signed-in user uses it in dev.
- **Language:** The text on screen is Japanese.
- **Settings:** The first version has no settings. Values such as the number of turns
  use defaults.
- **Personal data:** The sentences the learner types are sent to the model's provider:
  Bedrock, or OpenRouter and the model's maker while it stands in. With voice input,
  Chrome's default (server-based) recognition sends the audio to Google's speech
  service; the app records no audio, the API receives only the text, and a spoken turn
  is stored as a typed one is.

## 5. Data

| Entity | Fields                                                                                                                                                                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Talk   | id, learner id, scene (partner, place, relationship, description), start time, end time, how it ended (to the end / ended early with 「終わる」)                                                                                                               |
| Turn   | number, the partner's line (English), the Japanese input, the English input (empty when the learner gave up), whether the learner gave up, the judgment (worth correcting / not), the model answer, the point, the number of times 「もう一度見る」 was tapped |

- **Where it lives:** The app's data store (DynamoDB). How each activity lays out its
  data follows this repository's design ([design.md](design.md)).
- **Unit:** Turns are kept one by one, because they are the material for future features
  (carry-over into the next talk, cards, a personal instant-composition drill).

## 6. Open items

- **A guard against over-building:** Decided once the first version exists.
- Model choice, the provider, and the runtime model-call design are settled in
  [design.md](design.md).
