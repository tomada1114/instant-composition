import { expect, it, vi } from "vitest";
import {
  beginVisit,
  createAnswerQueue,
  getHome,
  LOGOUT_URL,
  recordAnswers,
  signOut,
  type AnswerInput,
} from "@instant-composition/web";

it("keeps answers and the established visit when browser locks are unavailable, while allowing native logout", async () => {
  beginVisit();
  const assigned = vi.fn();
  vi.stubGlobal("location", { assign: assigned });
  vi.stubGlobal("fetch", () => Promise.resolve(Response.json({})));
  expect((await getHome()).ok).toBe(true);
  vi.stubGlobal("navigator", {});
  const calls: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    calls.push(url);
    return Promise.resolve(
      Response.json({ error: { code: "ERR_UNAUTHENTICATED" } }, { status: 401 }),
    );
  });
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
    removeItem: (key: string) => {
      saved.delete(key);
    },
  };
  const answer: AnswerInput = {
    id: "retained",
    roundId: "r",
    cardId: "c",
    pass: "first",
    grade: "good",
    timedOut: false,
    elapsedMs: 1000,
  };
  const send = (input: AnswerInput) => recordAnswers(input.roundId, [input]);
  const queue = createAnswerQueue({ key: "unsupported", storage, send });
  expect(await queue.enqueue(answer)).toBe(false);
  expect(
    createAnswerQueue({ key: "unsupported", storage, send }).pending(),
  ).toStrictEqual([answer]);
  expect(await getHome()).toStrictEqual({ ok: false, error: { code: "ERR_NETWORK" } });
  expect(calls).toStrictEqual(["/api/v1/rounds/r/answers", "/api/v1/home"]);
  expect(assigned).not.toHaveBeenCalled();

  const form = document.createElement("form");
  form.method = "post";
  form.action = LOGOUT_URL;
  let notify: () => void = () => undefined;
  const submitted = new Promise<undefined>((resolve) => {
    notify = () => resolve(undefined);
  });
  const submit = vi
    .spyOn(HTMLFormElement.prototype, "submit")
    .mockImplementation(notify);
  const leaving = signOut(form);
  try {
    await submitted;
    expect(submit).toHaveBeenCalledTimes(1);
  } finally {
    window.dispatchEvent(new Event("pagehide"));
    await leaving;
  }
});
