---
name: building-the-talk-activity
description: >
  Covers the talk activity (the Talk tab, /talk): practicing conversation with a model
  playing a partner in a scene and a teacher who corrects on the spot — its
  requirements, screens and flows, the six-step turn, the /v1/talks operations, the
  TALK# item, the scene, teacher and partner prompts, and the LanguageModel port with
  its OpenRouter, stand-in and Bedrock adapters. Use when building, changing or
  reviewing anything in the talk activity, writing or versioning one of its prompts, or
  deciding how the activity behaves when a model call fails.
---

# Building the Talk Activity

**Owns:** what the talk activity is and how it is built — its product rules, its screens
and flows, its operations and data, its model tasks and prompts, and how it calls a
model. **Does not own:** the system map (`mapping-the-architecture`); the shape of
commands, ports and adapters (`designing-application-core`); the HTTP edge, the log line
and the environment (`serving-the-api`); the look and the component recipes
(`designing-ui`); screens and API calls in general (`building-web-screens`); who may
reach whose data (`isolating-learner-data`); stacks and stage settings
(`writing-infrastructure`).

This skill is the activity's context: read it before touching the activity, and change
it in the same pull request as anything that changes what it says. It describes what the
activity is meant to be; once a part has landed, the code and the owning skill are the
record of how.

## What it is

A learner talks in English with a partner in a scene the model makes up. Each turn has
six steps: the partner speaks; the learner says what they want to say in Japanese, then
in English; when the English is worth correcting, the teacher gives a model answer of at
most two sentences and a one-line point; the learner recites it from memory; the partner
goes on. Six turns, then the partner closes the scene. Text only; a learner who wants to
speak uses the device keyboard's voice input.

## Read the reference you need

| When you are working on                                                    | Read                                                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| What the activity does, its edge cases, what is kept, what is out of scope | [requirements.md](references/requirements.md)                                    |
| A screen, a state of W2–W4, copy, keys, motion or accessibility            | [ux-screens.md](references/ux-screens.md), [ux-flows.md](references/ux-flows.md) |
| An operation, the stored talk, a model task or prompt, a provider          | [design.md](references/design.md)                                                |

## Rules that are easy to break

- **The server runs the steps; the model answers once per step.** No model call decides
  what comes next, and a client never computes a step. A change that lets a model pick
  the step is an architecture change (`mapping-the-architecture`).
- **At most 13 model calls per talk:** one scene, then one teacher and one partner call
  per turn, retries aside. Sending the teacher and the partner together is what keeps
  the ○ path and the recital from waiting on the partner.
- **A failed teacher call never stops a talk;** a failed scene or partner call
  offers「もう一度」. Nothing about either failure is shown in red.
- **Never praise in words.** "Not worth correcting" is the ○ mark and the drill's ○
  sound.
- **Learner text is data,** delimited inside user messages, never in a system prompt,
  and never in a log line. The same holds for the model's output.
- **Prompts are versioned.** Any change to a prompt or its output schema bumps the
  task's version, which every stored talk records.
- **The provider is configuration.** OpenRouter stands in until the `dev` account can
  call Bedrock; nothing outside the adapters may know which provider answered.
- **Only finished talks are kept.** An open or discarded talk expires through the
  table's TTL; nothing resumes a talk.

## Keeping this current

The activity is decided with the owner as they use it. When a decision changes the
activity, edit the reference it lives in, in present tense, and keep requirements,
screens and design in step with each other. Run `pnpm agents:sync` afterwards.
**BACKGROUND:** `authoring-skills`.
