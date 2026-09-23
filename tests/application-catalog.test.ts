import { describe, expect, it } from "vitest";

import {
  cardFacts,
  catalogSnapshotOf,
  recordAnswers,
  startRound,
  updateSettings,
  type Catalog,
  type CatalogDocument,
  type CatalogSnapshot,
} from "@instant-composition/application";

import { answersFor, makeHarness, makeSnapshot } from "./application-harness";

// A two-topic document for the pair en/ja, with one item of each kind the
// builder writes: shown, shown without a ja localization, withdrawn and deleted.

function makeDocument(overrides: Partial<CatalogDocument> = {}): CatalogDocument {
  return {
    format: 1,
    version: "sha256:abc",
    target: "en",
    l1: "ja",
    levels: [
      {
        level: 1,
        cefr: "A1+",
        exams: { toeic: "300", ielts: null, toeflIbt: "1.5–2" },
      },
      { level: 2, cefr: "A2", exams: { ielts: null } },
    ],
    concepts: [{ id: "en:grammar/imperatives", names: { ja: "命令文" } }],
    topics: [
      {
        id: "work",
        names: { ja: "仕事" },
        subtopics: [
          { id: "meetings", names: { ja: "会議" } },
          { id: "calls", names: {} },
        ],
      },
      { id: "travel", names: {}, subtopics: [] },
    ],
    items: [
      {
        id: "c_2a",
        target: "en",
        text: "Let's start the  meeting.",
        alternatives: ["Shall we get started?"],
        concepts: ["en:grammar/imperatives"],
        level: 1,
        topic: "work",
        subtopic: "meetings",
        localizations: {
          ja: { prompt: "会議を始めましょう。", explanation: "Let's で誘う" },
        },
      },
      {
        id: "c_3b",
        target: "en",
        text: "Call me back when you can.",
        alternatives: [],
        concepts: [],
        level: 2,
        topic: "work",
        subtopic: "calls",
        localizations: {
          zh: { prompt: "方便时给我回电话。", explanation: "when you can" },
        },
      },
    ],
    withdrawn: [
      { id: "c_4c", topic: "work", subtopic: "meetings", level: 2, words: 9 },
    ],
    tombstones: [
      {
        id: "c_5d",
        topic: "travel",
        subtopic: "hotels",
        level: 3,
        localizations: { ja: { prompt: "削除された文" } },
      },
      {
        id: "c_6e",
        topic: "travel",
        subtopic: "hotels",
        level: 4,
        localizations: {},
      },
    ],
    ...overrides,
  };
}

describe("a snapshot for one first language", () => {
  const snapshot = catalogSnapshotOf(makeDocument(), "ja");

  it("carries the document's version", () => {
    expect(snapshot.version).toBe("sha256:abc");
  });

  it("shows a localized item with its prompt, explanation and word count", () => {
    expect([...snapshot.shown.keys()]).toStrictEqual(["c_2a"]);
    expect(snapshot.shown.get("c_2a")).toStrictEqual({
      id: "c_2a",
      topic: "work",
      subtopic: "meetings",
      level: 1,
      words: 4,
      prompt: "会議を始めましょう。",
      text: "Let's start the  meeting.",
      alternatives: ["Shall we get started?"],
      explanation: "Let's で誘う",
    });
  });

  it("retires an item with no localization for it, keeping its words but no prompt", () => {
    expect(snapshot.retired.get("c_3b")).toStrictEqual({
      id: "c_3b",
      topic: "work",
      subtopic: "calls",
      level: 2,
      words: 6,
      prompt: null,
    });
  });

  it("retires a withdrawn item without any of its text", () => {
    expect(snapshot.retired.get("c_4c")).toStrictEqual({
      id: "c_4c",
      topic: "work",
      subtopic: "meetings",
      level: 2,
      words: 9,
      prompt: null,
    });
  });

  it.each([
    ["with a prompt in this language", "c_5d", "削除された文"],
    ["without one", "c_6e", null],
  ])("retires a deleted item %s, with no words", (_, id, prompt) => {
    expect(snapshot.retired.get(id)).toMatchObject({ id, words: null, prompt });
  });

  it("names topics and subtopics in this language, falling back to their ids", () => {
    expect(snapshot.topics).toStrictEqual([
      {
        id: "work",
        name: "仕事",
        subtopics: [
          { id: "meetings", name: "会議" },
          { id: "calls", name: "calls" },
        ],
      },
      { id: "travel", name: "travel", subtopics: [] },
    ]);
  });

  it("keeps each level's CEFR band beside its TOEIC score, empty when there is none", () => {
    expect(snapshot.levels).toStrictEqual(
      new Map([
        [1, { cefr: "A1+", toeic: "300" }],
        [2, { cefr: "A2", toeic: "" }],
      ]),
    );
  });

  it("shows nothing to a first language no item is localized for", () => {
    const other = catalogSnapshotOf(makeDocument(), "es");
    expect(other.shown.size).toBe(0);
    expect(other.retired.get("c_2a")).toMatchObject({ words: 4, prompt: null });
    expect(other.retired.get("c_5d")).toMatchObject({ prompt: null });
  });
});

describe("the cards an answer may name", () => {
  it("are the shown and the retired ones, a shown card over a retired entry", () => {
    const document = makeDocument({
      tombstones: [
        {
          id: "c_2a",
          topic: "travel",
          subtopic: "hotels",
          level: 9,
          localizations: {},
        },
      ],
    });
    const facts = cardFacts(catalogSnapshotOf(document, "ja"));
    expect([...facts.keys()].sort()).toStrictEqual(["c_2a", "c_3b", "c_4c"]);
    expect(facts.get("c_2a")).toMatchObject({ topic: "work", level: 1, words: 4 });
  });
});

describe("an answer naming a card edited since the round was dealt", () => {
  it("is taken, with no prompt kept for it, and the card leaves the resumed round", async () => {
    let current: CatalogSnapshot = makeSnapshot();
    const catalog: Catalog = {
      snapshot: () => Promise.resolve({ ok: true, value: current }),
    };
    const h = makeHarness(catalog);
    await updateSettings(h.deps, h.context(), { topics: ["work", "travel"] });
    const started = await startRound(h.deps, h.context(), {
      kind: "placement",
      roundId: "p1",
    });
    if (!started.ok) throw new Error(started.error.code);
    const [edited, ...others] = started.value.deck;
    if (edited === undefined) throw new Error("The deck is empty.");

    const card = current.shown.get(edited);
    if (card === undefined) throw new Error("The dealt card is not shown.");
    const shown = new Map(current.shown);
    shown.delete(edited);
    current = {
      ...current,
      shown,
      retired: new Map([
        [
          edited,
          {
            id: edited,
            topic: card.topic,
            subtopic: card.subtopic,
            level: 1,
            words: 8,
            prompt: null,
          },
        ],
      ]),
    };

    const [first] = answersFor(started.value);
    if (first === undefined) throw new Error("No answer was made.");
    const recorded = await recordAnswers(h.deps, h.context(), {
      roundId: "p1",
      answers: [first],
    });
    expect(recorded.ok).toBe(true);
    const reviews = await h.stores.forLearner(h.learner).reviewsOf("p1");
    expect(reviews.map((review) => review.snapshot)).toStrictEqual([
      { topic: card.topic, subtopic: card.subtopic, level: 1, prompt: null },
    ]);

    const resumed = await startRound(h.deps, h.context(), {
      kind: "placement",
      roundId: "p1",
    });
    expect(resumed.ok && Object.keys(resumed.value.cards).sort()).toStrictEqual(
      [...others].sort(),
    );
  });
});
