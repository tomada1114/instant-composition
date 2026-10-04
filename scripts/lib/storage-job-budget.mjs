import { readKey, readString } from "./json.mjs";
import { StorageTransitionError } from "./storage-runtime.mjs";

/** @param {unknown} value @returns {boolean} */
function positiveId(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** @param {unknown} value @returns {boolean} */
function decimalId(value) {
  return (
    typeof value === "string" && /^[1-9]\d*$/.test(value) && positiveId(Number(value))
  );
}

/**
 * Read the actual start of the sole deployment job from its exact run attempt.
 * An unavailable or ambiguous lookup never creates a fresh budget anchor.
 * @param {{repository:string,run:string,attempt:string,token:string,now?:number}} options
 * @param {typeof fetch} request
 * @returns {Promise<number>}
 */
export async function storageDeployJobStart(options, request = globalThis.fetch) {
  const { repository, run, attempt, token } = options;
  const now = options.now ?? Date.now();
  if (
    repository !== "tomada1114/instant-composition" ||
    !decimalId(run) ||
    !decimalId(attempt) ||
    typeof token !== "string" ||
    token.trim() === "" ||
    !Number.isSafeInteger(now) ||
    now < 0
  )
    throw new StorageTransitionError("deployment job configuration");

  /** @type {unknown} */
  let body;
  try {
    const response = await request(
      `https://api.github.com/repos/${repository}/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (response.status !== 200)
      throw new StorageTransitionError("deployment job lookup");
    body = await response.json();
  } catch {
    throw new StorageTransitionError("deployment job lookup");
  }

  const jobs = readKey(body, "jobs");
  if (readKey(body, "total_count") !== 1 || !Array.isArray(jobs) || jobs.length !== 1)
    throw new StorageTransitionError("deployment job response");
  /** @type {unknown} */
  const job = jobs[0];
  const started = readString(job, "started_at");
  const startedAt = started === undefined ? NaN : Date.parse(started);
  if (
    readKey(job, "run_id") !== Number(run) ||
    readString(job, "status") !== "in_progress" ||
    !positiveId(readKey(job, "id")) ||
    started === undefined ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(started) ||
    !Number.isSafeInteger(startedAt) ||
    startedAt < 0 ||
    startedAt > now ||
    new Date(startedAt).toISOString() !==
      (started.includes(".") ? started : started.replace("Z", ".000Z"))
  )
    throw new StorageTransitionError("deployment job response");
  return startedAt;
}
