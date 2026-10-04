import { describe, expect, it } from "vitest";
import { learnerId } from "@instant-composition/application";
import {
  roundPayloadSchema,
  talkViewSchema,
  vocabSessionSchema,
} from "@instant-composition/contracts";
import {
  beginVisit,
  createAnswerQueue,
  deleteVocabCard,
  requestFinish,
  requestVocabFinish,
  sendAnswer,
  sendVocabAnswer,
  startVocabSession,
} from "@instant-composition/web";
import { makePersonalCard } from "./application-fixtures";
import { fixedCatalog, makeSnapshot, vocabItem } from "./application-harness";
import { makeApi, startedPlacement, type ApiHarnessOptions } from "./api-harness";
import { connectClient, queuedAnswer, queueStorage } from "./critical-flow-harness";

/** Same public client → HTTP → application assertions on each actual backing. */
export function describeCriticalFlows(
  name: string,
  backing: () => Promise<ApiHarnessOptions>,
): void {
  describe(`${name}: critical recovery`, () => {
    it("finishes with the first-pass grade when a same-time retry sorts before it", async () => {
      const card = vocabItem("word", 4, 0);
      const api = makeApi({
        ...(await backing()),
        catalog: fixedCatalog(makeSnapshot({ vocab: [card] })),
      });
      await api.call("GET", "/v1/me");
      await api.prepareVocab();
      const session = await api.call("POST", "/v1/vocab/sessions", {
        sessionId: "s1",
        kind: "today",
      });
      expect(session.status).toBe(200);
      const first = {
        id: "z-first",
        cardId: card.id,
        pass: "first",
        grade: "again",
        elapsedMs: 1000,
      };
      expect(
        (await api.call("POST", "/v1/vocab/sessions/s1/answers", { answers: [first] }))
          .status,
      ).toBe(204);
      expect(
        (
          await api.call("POST", "/v1/vocab/sessions/s1/answers", {
            answers: [{ ...first, id: "a-retry", pass: "retry", grade: "good" }],
          })
        ).status,
      ).toBe(204);
      const finished = await api.call("POST", "/v1/vocab/sessions/s1/finish", {
        answers: [],
      });
      expect(finished.status).toBe(200);
      expect(await finished.json()).toMatchObject({
        answered: 1,
        new: 1,
        again: [{ cardId: card.id }],
      });
    });
    it("recovers an unsent drill grade and a lost acknowledgement across reload, adopting each id once before finish", async () => {
      const api = makeApi(await backing());
      const round = await startedPlacement(api);
      beginVisit();
      const wire = connectClient(api);
      const storage = queueStorage();
      const queue = createAnswerQueue({
        key: "drill-answers:p1",
        storage,
        send: sendAnswer,
      });
      const first = queuedAnswer("p1", round.deck[0] ?? "missing", { grade: "again" });
      wire.failNext("offline");
      expect(await queue.enqueue(first)).toBe(false);
      expect(
        await api.stores.forLearner(learnerId("learner-1")).reviewsOf("p1"),
      ).toStrictEqual([]);
      const reloaded = createAnswerQueue({
        key: "drill-answers:p1",
        storage,
        send: sendAnswer,
      });
      expect(reloaded.pending()).toStrictEqual([first]);
      wire.failNext("lost-response");
      expect(await reloaded.flush()).toBe(false);
      expect(
        await api.stores.forLearner(learnerId("learner-1")).reviewsOf("p1"),
      ).toHaveLength(1);
      expect(await reloaded.flush()).toBe(true);
      const store = api.stores.forLearner(learnerId("learner-1"));
      expect(await store.reviewsOf("p1")).toMatchObject([
        { id: first.id, detail: { result: "ng" } },
      ]);
      wire.failNext("conflict");
      const next = queuedAnswer("p1", round.deck[1] ?? "missing");
      expect(await reloaded.enqueue(next)).toBe(false);
      expect(await reloaded.flush()).toBe(true);
      const rest = round.deck.slice(2).map((id) => queuedAnswer("p1", id));
      const finished = await requestFinish("p1", rest);
      expect(finished.ok).toBe(true);
      expect(await requestFinish("p1", [])).toStrictEqual(finished);
      const before = await store.reviewsOf("p1");
      expect(before).toHaveLength(round.deck.length);
      expect(await sendAnswer(first)).toBe("sent");
      expect(await sendAnswer({ ...first, id: "new-after-finish" })).toBe("rejected");
      expect(await store.reviewsOf("p1")).toStrictEqual(before);
      const read = roundPayloadSchema.parse(
        await (await api.call("GET", "/v1/rounds/p1")).json(),
      );
      expect(read.answered.map(({ id }) => id)).toContain(first.id);
      expect(storage.getItem("drill-answers:p1")).toBeNull();
    });

    it("persists vocab re-asks once, removes a personal card and its unsent grade, and finishes the remaining session", async () => {
      const card = makePersonalCard();
      const catalogCard = vocabItem("word", 4, 0);
      const api = makeApi({
        ...(await backing()),
        catalog: fixedCatalog(makeSnapshot({ vocab: [catalogCard] })),
      });
      await api.call("GET", "/v1/me");
      const store = api.stores.forLearner(learnerId("learner-1"));
      expect(
        (
          await store.commit({
            puts: [{ type: "card", value: card }],
            updates: [],
            expect: [],
          })
        ).ok,
      ).toBe(true);
      await api.prepareVocab();
      beginVisit();
      const wire = connectClient(api);
      const result = await startVocabSession({ sessionId: "s1", kind: "today" });
      expect(result.ok).toBe(true);
      const session = vocabSessionSchema.parse(result.ok && result.value);
      expect(session.cards.map(({ id }) => id).sort()).toStrictEqual(
        [card.id, catalogCard.id].sort(),
      );
      const storage = queueStorage();
      const queue = createAnswerQueue({
        key: "vocab-answers:s1",
        storage,
        send: sendVocabAnswer,
      });
      const first = queuedAnswer("s1", catalogCard.id, { grade: "again" });
      expect(await queue.enqueue(first)).toBe(true);
      api.advance(1000);
      const retry = queuedAnswer("s1", catalogCard.id, {
        id: "retry-1",
        pass: "retry",
        answeredAt: (first.answeredAt ?? 0) + 1000,
      });
      wire.failNext("lost-response");
      expect(await queue.enqueue(retry)).toBe(false);
      const reloaded = createAnswerQueue({
        key: "vocab-answers:s1",
        storage,
        send: sendVocabAnswer,
      });
      expect(await reloaded.flush()).toBe(true);
      wire.failNext("offline");
      expect(await reloaded.enqueue(queuedAnswer("s1", card.id))).toBe(false);
      expect(await deleteVocabCard(card.id)).toStrictEqual({
        ok: true,
        value: undefined,
      });
      reloaded.removeCard(card.id);
      expect(reloaded.pending()).toStrictEqual([]);
      expect(await store.card(card.id)).toBeUndefined();
      const finished = await requestVocabFinish("s1", reloaded.pending());
      expect(finished).toMatchObject({
        ok: true,
        value: {
          answered: 1,
          new: 1,
          tomorrow: 1,
          again: [{ cardId: catalogCard.id }],
        },
      });
      expect(await requestVocabFinish("s1", [])).toStrictEqual(finished);
      expect(await store.vocabReviewsOf("s1")).toMatchObject([
        { id: first.id, grade: "again" },
        { id: retry.id, grade: "good" },
      ]);
      expect(await sendVocabAnswer(retry)).toBe("sent");
      expect(await sendVocabAnswer({ ...retry, id: "closed-new" })).toBe("rejected");
    });

    it("resumes stored talk turns through a fresh API instance, retries duplicates without new model work, then keeps the ended talk", async () => {
      const shared = await backing();
      const api = makeApi(shared);
      expect((await api.call("POST", "/v1/talks", { talkId: "t1" })).status).toBe(200);
      const turn = { turn: 1, japanese: "こんにちは", english: "Hello." };
      const sent = await api.call("POST", "/v1/talks/t1/turns", turn);
      expect(sent.status).toBe(200);
      const value: unknown = await sent.json();
      const calls = api.modelCalls.length;
      expect(
        await (await api.call("POST", "/v1/talks/t1/turns", turn)).json(),
      ).toStrictEqual(value);
      expect(api.modelCalls).toHaveLength(calls);
      const resumed = makeApi({
        ...shared,
        stores: api.stores,
        directory: api.directory,
        standIn: api.model,
      });
      const view = talkViewSchema.parse(
        await (await resumed.call("GET", "/v1/talks/t1")).json(),
      );
      expect(view).toMatchObject({
        status: "open",
        turns: [{ turn: 1, japanese: "こんにちは", english: "Hello." }],
      });
      expect(resumed.modelCalls).toStrictEqual([]);
      expect(
        await (await resumed.call("POST", "/v1/talks/t1/end")).json(),
      ).toStrictEqual({ kept: true });
      expect(
        (await resumed.stores.forLearner(learnerId("learner-1")).talk("t1"))?.value,
      ).toMatchObject({ status: "ended" });
      expect(
        (await resumed.call("POST", "/v1/talks/t1/turns", { ...turn, turn: 2 })).status,
      ).toBe(409);
    });
  });
}
