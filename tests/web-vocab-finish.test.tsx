import { act, renderHook } from "@testing-library/react";
import { beforeAll, beforeEach, expect, it } from "vitest";
import {
  beginVisit,
  createPagedOutbox,
  createQueryClient,
  QueryClientProvider,
  useVocabFinish,
  type VocabPage,
} from "@instant-composition/web";
import { outboxLocks, outboxAnswer } from "./paged-outbox-harness";
import { fakeApi, fakeTimers, settle, warmUp } from "./web-harness";
import { vocabSummary } from "./web-vocab-fixtures";
beforeAll(warmUp);
beforeEach(fakeTimers);
it("retains a fresh concurrent grade and checkpoint when finish ACK races another document's append", async () => {
  beginVisit();
  const key = "vocab-outbox:session-1",
    locks = outboxLocks();
  const queue = createPagedOutbox({
    key,
    storage: localStorage,
    locks,
    send: () => Promise.resolve("sent" as const),
  });
  const other = createPagedOutbox({
    key,
    storage: localStorage,
    locks,
    send: () => Promise.resolve("sent" as const),
  });
  let close: (value: Response) => void = () => undefined;
  const calls = fakeApi((call) =>
    call.url.endsWith("/finish")
      ? new Promise<Response>((resolve) => {
          close = resolve;
        })
      : undefined,
  );
  sessionStorage.setItem("vocab-checkpoint:session-1", "private checkpoint");
  const page: VocabPage = {
    sessionId: "session-1",
    generation: 1,
    page: 0,
    kind: "today",
    category: null,
    day: "2026-10-02",
    cards: [],
    answered: [],
    retained: [],
    total: 0,
    continuation: null,
  };
  const client = createQueryClient();
  const { result } = renderHook(() => useVocabFinish(page, queue, true), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await settle();
  expect(calls).toHaveLength(1);
  expect(await other.append(outboxAnswer(0))).toBe(true);
  const pending = localStorage.getItem(`${key}:page:0`),
    meta = localStorage.getItem(key),
    owner = localStorage.getItem(`${key}:owner`);
  act(() => {
    close(Response.json({ ...vocabSummary(), againCount: 0 }));
  });
  await settle();
  expect(result.current.failed).toBe(true);
  expect(result.current.summary).toBeUndefined();
  expect(localStorage.getItem(`${key}:page:0`)).toBe(pending);
  expect(localStorage.getItem(key)).toBe(meta);
  expect(localStorage.getItem(`${key}:owner`)).toBe(owner);
  expect(sessionStorage.getItem("vocab-checkpoint:session-1")).toBe(
    "private checkpoint",
  );
  expect(other.count()).toBe(1);
});
