import { describe, expect, it, vi } from "vitest";
import { storageDeployJobStart } from "../scripts/lib/storage-job-budget.mjs";
import { StorageTransitionError } from "../scripts/lib/storage-runtime.mjs";

const options = {
  repository: "tomada1114/instant-composition",
  run: "123456",
  attempt: "2",
  token: "private-test-token",
  now: Date.parse("2026-10-04T00:10:00Z"),
};
const job = {
  id: 987654,
  run_id: 123456,
  status: "in_progress",
  started_at: "2026-10-04T00:00:00Z",
};

function reply(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(() => Promise.resolve(Response.json(body, { status })));
}

describe("the deployment job start", () => {
  it("uses the exact attempt and private headers to return the actual earlier start after setup", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const request = reply({ total_count: 1, jobs: [job] });
    expect(await storageDeployJobStart(options, request)).toBe(1_791_072_000_000);
    const init = request.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "https://api.github.com/repos/tomada1114/instant-composition/actions/runs/123456/attempts/2/jobs?per_page=100",
      {
        method: "GET",
        headers: {
          authorization: "Bearer private-test-token",
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        },
        redirect: "error",
        signal: init?.signal,
      },
    );
    expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(30_000);
  });

  it("uses the current clock only to reject future starts, preserving millisecond precision", async () => {
    const { now, ...config } = options;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const request = reply({
      total_count: 1,
      jobs: [{ ...job, started_at: "2026-10-04T00:00:00.123Z" }],
    });
    expect(await storageDeployJobStart(config, request)).toBe(1_791_072_000_123);
  });

  it.each([
    ["different repository", { repository: "other/instant-composition" }],
    ["missing run", { run: "" }],
    ["zero run", { run: "0" }],
    ["negative run", { run: "-1" }],
    ["fractional run", { run: "1.5" }],
    ["exponent run", { run: "1e3" }],
    ["padded run", { run: "01" }],
    ["unsafe run", { run: "9007199254740992" }],
    ["path in run", { run: "123/attempts/1" }],
    ["zero attempt", { attempt: "0" }],
    ["unsafe attempt", { attempt: "9007199254740992" }],
    ["missing token", { token: "" }],
    ["blank token", { token: " " }],
    ["nonfinite clock", { now: Infinity }],
    ["negative clock", { now: -1 }],
  ])("refuses %s before HTTP", async (_, patch) => {
    const request = reply({ total_count: 1, jobs: [job] });
    await expect(
      storageDeployJobStart({ ...options, ...patch }, request),
    ).rejects.toMatchObject({
      code: "ERR_STORAGE_TRANSITION",
      part: "deployment job configuration",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ["missing jobs", { total_count: 1 }],
    ["null response", null],
    ["null job", { total_count: 1, jobs: [null] }],
    ["no job", { total_count: 0, jobs: [] }],
    ["multiple jobs", { total_count: 2, jobs: [job, { ...job, id: 987655 }] }],
    ["inconsistent count", { total_count: 2, jobs: [job] }],
    ["malformed count", { total_count: "1", jobs: [job] }],
    ["wrong run", { total_count: 1, jobs: [{ ...job, run_id: 123457 }] }],
    ["string run", { total_count: 1, jobs: [{ ...job, run_id: "123456" }] }],
    ["completed job", { total_count: 1, jobs: [{ ...job, status: "completed" }] }],
    ["queued job", { total_count: 1, jobs: [{ ...job, status: "queued" }] }],
    ["zero id", { total_count: 1, jobs: [{ ...job, id: 0 }] }],
    ["unsafe id", { total_count: 1, jobs: [{ ...job, id: 9007199254740992 }] }],
    ["string id", { total_count: 1, jobs: [{ ...job, id: "987654" }] }],
    ["missing date", { total_count: 1, jobs: [{ ...job, started_at: null }] }],
    [
      "malformed date",
      { total_count: 1, jobs: [{ ...job, started_at: "not a date" }] },
    ],
    [
      "normalized impossible date",
      { total_count: 1, jobs: [{ ...job, started_at: "2026-02-30T00:00:00Z" }] },
    ],
    ["ambiguous date", { total_count: 1, jobs: [{ ...job, started_at: "0" }] }],
    [
      "future date",
      { total_count: 1, jobs: [{ ...job, started_at: "2026-10-04T00:10:01Z" }] },
    ],
  ])("fails closed on %s", async (_, body) => {
    await expect(storageDeployJobStart(options, reply(body))).rejects.toMatchObject({
      code: "ERR_STORAGE_TRANSITION",
      part: "deployment job response",
    });
  });

  it.each([401, 403, 404, 500])(
    "refuses HTTP %s without exposing the provider body",
    async (status) => {
      const request = reply({ message: "private-test-token provider secret" }, status);
      const failure = storageDeployJobStart(options, request);
      await expect(failure).rejects.toBeInstanceOf(StorageTransitionError);
      await expect(failure).rejects.toMatchObject({ part: "deployment job lookup" });
      const error: unknown = await failure.catch((error: unknown) => error);
      expect(String(error)).not.toContain("private-test-token");
      expect(String(error)).not.toContain("provider secret");
    },
  );

  it("sanitizes a transport rejection containing private headers", async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.reject(new Error("Bearer private-test-token")),
    );
    const failure = storageDeployJobStart(options, request);
    await expect(failure).rejects.toBeInstanceOf(StorageTransitionError);
    await expect(failure).rejects.toMatchObject({
      part: "deployment job lookup",
    });
    const error: unknown = await failure.catch((error: unknown) => error);
    expect(String(error)).not.toContain("private-test-token");
    await expect(failure).rejects.not.toHaveProperty("cause");
  });

  it("sanitizes a malformed JSON lookup", async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("private-test-token {")),
    );
    await expect(storageDeployJobStart(options, request)).rejects.toMatchObject({
      part: "deployment job lookup",
    });
  });
});
