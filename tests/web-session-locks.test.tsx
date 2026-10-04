import { expect, it } from "vitest";

it("permits independently named nested locks and releases them after a refused callback", async () => {
  await expect(
    navigator.locks.request("auth", () =>
      navigator.locks.request("vocab", () => {
        throw new Error("fixture refused");
      }),
    ),
  ).rejects.toThrow("fixture refused");
  expect(
    await navigator.locks.request("auth", () =>
      navigator.locks.request("vocab", () => "retried"),
    ),
  ).toBe("retried");
});

it("keeps same-name requests FIFO and blocks them until the earlier owner releases", async () => {
  const events: string[] = [];
  let release: () => void = () => undefined;
  const waiting = new Promise<void>((done) => {
    release = done;
  });
  const first = navigator.locks.request("auth", async () => {
    events.push("first");
    await waiting;
    events.push("released");
  });
  const second = navigator.locks.request("auth", () => {
    events.push("second");
  });
  await navigator.locks.request("vocab", () => {
    events.push("independent");
  });
  expect(events).toStrictEqual(["first", "independent"]);
  release();
  await Promise.all([first, second]);
  expect(events).toStrictEqual(["first", "independent", "released", "second"]);
});
