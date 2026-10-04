import { readKey, readString } from "./json.mjs";
import { ReleaseError } from "./release-runtime.mjs";

/** These are the required jobs that also run on main pushes. */
const required = ["Static checks", "Test (ubuntu-latest)", "Spell check code and docs"];

/** @param {string} repository @param {string} sha @param {string} token @param {typeof fetch} request @returns {Promise<boolean>} */
export async function mainChecks(repository, sha, token, request = globalThis.fetch) {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    token === ""
  )
    throw new ReleaseError("main check configuration");
  const response = await request(
    `https://api.github.com/repos/${repository}/commits/${sha}/check-runs?filter=latest&per_page=100`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  if (response.status !== 200) throw new ReleaseError("main check lookup");
  /** @type {unknown} */
  const body = await response.json();
  const checks = readKey(body, "check_runs");
  const count = readKey(body, "total_count");
  if (!Array.isArray(checks) || count !== checks.length || checks.length > 100)
    throw new ReleaseError("main check response");
  let ready = true;
  for (const name of required) {
    const matches = checks.filter(
      (check) =>
        readString(check, "name") === name &&
        readString(check, "head_sha") === sha &&
        readString(readKey(check, "app"), "slug") === "github-actions",
    );
    if (matches.length !== 1) {
      ready = false;
      continue;
    }
    /** @type {unknown} */
    const check = matches[0];
    const status = readString(check, "status");
    if (status === "queued" || status === "in_progress") ready = false;
    else if (status !== "completed" || readString(check, "conclusion") !== "success")
      throw new ReleaseError(`required main check ${name}`);
  }
  return ready;
}
