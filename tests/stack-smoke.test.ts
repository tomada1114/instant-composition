import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteLearnerTable, localDynamoDbClient } from "@instant-composition/adapters";
import { historySchema, roundPayloadSchema } from "@instant-composition/contracts";

import { buildCatalog } from "../scripts/catalog/build.mjs";
import { coreHash } from "../scripts/cards/schema.mjs";
import { compareIds } from "../scripts/cards/store.mjs";
import {
  makeCard,
  makeContentRoot,
  removeContentRoots,
  writeCards,
} from "./cards-fixture";
import { DYNAMODB_LOCAL_ENDPOINT } from "./dynamodb-local";

// The only suite that asks the whole stack a question over HTTP. Every other
// test drives one layer through its own surface — the API app with
// `new Request()`, a screen under jsdom against a stand-in `fetch` — so nothing
// else notices when the seams between them come apart: a bundle that builds
// but links no stylesheet, a Vite proxy that no longer reaches the API, an API
// entry (`apps/api/src/main.ts`) that fails to wire what its parts test fine
// alone. This serves the built client with `vite preview`, whose `/api` proxy
// is the dev server's, in front of the API started exactly as `pnpm api`
// starts it, on DynamoDB local — and asserts only what a client outside the
// processes can see.
//
// No browser and no E2E harness, deliberately: two servers plus `fetch` need
// neither, and issue #12's decision to take on neither still stands.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const webRoot = path.join(repoRoot, "apps", "web");

/** The bundle `pnpm web:build` writes, which `vite preview` serves. */
const builtIndex = path.join(webRoot, "dist", "index.html");

/** Vite's CLI, run on this process's own Node rather than through a shell. */
const viteCli = path.join(webRoot, "node_modules", "vite", "bin", "vite.js");

/** How long a server gets to accept its first connection. */
const READY_TIMEOUT_MS = 60_000;

const POLL_INTERVAL_MS = 100;

/** How long a `SIGTERM`ed server gets to exit before it is killed outright. */
const SHUTDOWN_GRACE_MS = 5_000;

/**
 * Everything `pnpm web:build` reads that changes what the served client does.
 *
 * @remarks
 * Compared against `dist/index.html`'s timestamp, which is why this list is
 * paths rather than a glob: it is walked, not matched. The build writes nothing
 * under any of them, so a source newer than the build means the build is not
 * of that source.
 */
const BUILD_INPUTS = [
  "apps/web/src",
  "apps/web/index.html",
  "apps/web/vite.config.ts",
  "apps/web/package.json",
  "messages",
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** The most recent modification time anywhere under a repository-relative path. */
function newestMtimeMs(target: string): number {
  const absolute = path.join(repoRoot, target);
  const root = statSync(absolute);
  if (!root.isDirectory()) return root.mtimeMs;
  // Directories count too: adding or removing a file changes only the
  // directory's own timestamp.
  let newest = root.mtimeMs;
  for (const entry of readdirSync(absolute, { recursive: true, withFileTypes: true })) {
    newest = Math.max(
      newest,
      statSync(path.join(entry.parentPath, entry.name)).mtimeMs,
    );
  }
  return newest;
}

/**
 * Fail unless `apps/web/dist` holds a build of the source on disk right now.
 *
 * @remarks
 * The suite runs after `pnpm web:build`, never instead of it — `check:source`
 * and ci.yml's `static` job each build once and then call `pnpm run
 * test:smoke`. A `dist/` from an earlier commit would answer every assertion
 * below happily, about code that is no longer here.
 */
function assertFreshBuild(): void {
  if (!existsSync(builtIndex)) {
    throw new Error(
      "This suite serves the output of `pnpm web:build`, which is missing. Run `pnpm web:build` first, or `pnpm run check:source`, which builds before it smoke-tests.",
    );
  }
  const builtAtMs = statSync(builtIndex).mtimeMs;
  const changed = BUILD_INPUTS.filter((input) => newestMtimeMs(input) > builtAtMs);
  if (changed.length > 0) {
    throw new Error(
      `This suite serves the output of \`pnpm web:build\`, and ${changed.join(", ")} changed after that build was written. Run \`pnpm web:build\` again.`,
    );
  }
}

/** Fail with what to run when DynamoDB local is not answering. */
async function assertDynamoDbLocal(): Promise<void> {
  try {
    await fetch(DYNAMODB_LOCAL_ENDPOINT);
  } catch (error) {
    throw new Error(
      `DynamoDB local is not answering on ${DYNAMODB_LOCAL_ENDPOINT}. Start it with \`pnpm db:up\`, then rerun \`pnpm test:smoke\`.`,
      { cause: error },
    );
  }
}

/**
 * A TCP port nothing is listening on, asked of the operating system so two
 * checkouts — or a developer's own `pnpm dev` — can run beside this suite.
 */
async function reserveEphemeralPort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (address === null || typeof address === "string") {
    throw new TypeError("the probe server reported no TCP address to read a port from");
  }
  probe.close();
  await once(probe, "close");
  return address.port;
}

/** A card id `ID_PATTERN` accepts, distinct for every `n` below 8⁴·23⁴. */
function cardId(n: number): string {
  const digits = "23456789";
  const letters = "abcdefghjkmnpqrstuvwxyz";
  let rest = n;
  let id = "c_";
  for (let pair = 0; pair < 4; pair += 1) {
    id += `${digits[rest % 8] ?? "2"}${letters[Math.floor(rest / 8) % 23] ?? "a"}`;
    rest = Math.floor(rest / 184);
  }
  return id;
}

/**
 * A content root of reviewed cards — two per level in each fixture cell — so
 * the assertions below hold whatever the checkout's own content/ holds.
 */
function writeReviewedCards(root: string): void {
  let n = 0;
  const cells = [
    ["work/meetings.json", "work", "meetings"],
    ["work/requests.json", "work", "requests"],
    ["daily/home.json", "daily", "home"],
  ] as const;
  for (const [file, topic, subtopic] of cells) {
    const cards = Array.from({ length: 20 }, (_, index): Record<string, unknown> => {
      n += 1;
      const card = makeCard(cardId(n), {
        topic,
        subtopic,
        level: Math.floor(index / 2) + 1,
        ja: `${subtopic} の文 ${String(index + 1)}`,
        en: `This is sentence ${String(index + 1)} about ${subtopic}.`,
      });
      const hash = coreHash(card as unknown as Parameters<typeof coreHash>[0]);
      return {
        ...card,
        stamps: { core: { hash, perspectivesVersion: 2, at: "2026-09-22" } },
      };
    }).sort((left, right) => compareIds(String(left["id"]), String(right["id"])));
    writeCards(root, file, cards);
  }
}

/**
 * One server of the stack, spawned in a process group of its own.
 *
 * @remarks
 * `detached: true` makes the group killable as a whole, but also takes the
 * child out of the terminal's foreground group, so a Ctrl-C during a run never
 * reaches it; {@link Server.stop} is registered on the interrupt signals too.
 */
interface Server {
  readonly child: ChildProcess;
  readonly output: () => string;
  readonly spawnFailure: () => Error | undefined;
  readonly stop: () => Promise<void>;
}

/** The signals a run is interrupted with, rather than finished by. */
const INTERRUPT_SIGNALS = ["SIGINT", "SIGTERM"] as const;

function startServer(
  name: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Server {
  const child = spawn(process.execPath, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  const collect = (chunk: Buffer): void => {
    output += chunk.toString("utf8");
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  // An `error` nobody listens to is thrown as an uncaught exception, which on a
  // loaded runner would kill this worker with an opaque stack.
  let failure: Error | undefined;
  child.on("error", (error: Error) => {
    failure = error;
  });

  function signalGroup(signal: NodeJS.Signals): void {
    const { pid } = child;
    if (pid === undefined) return;
    try {
      process.kill(-pid, signal);
    } catch {
      // The group is already gone, or the platform refused the negative pid.
      child.kill(signal);
    }
  }

  // Re-raising is conditional on this being the only listener for that
  // signal: adding one suppresses Node's default termination, so with no other
  // listener the run would hang on Ctrl-C, and with one — Vitest's own —
  // re-raising would drive it twice.
  const handlers = INTERRUPT_SIGNALS.map((signal) => {
    const wasAlreadyHandled = process.listenerCount(signal) > 0;
    const handler = (): void => {
      removeHandlers();
      signalGroup("SIGKILL");
      if (!wasAlreadyHandled) process.kill(process.pid, signal);
    };
    process.on(signal, handler);
    return { signal, handler };
  });
  function removeHandlers(): void {
    for (const { signal, handler } of handlers) process.off(signal, handler);
  }

  return {
    child,
    output: () => `[${name}]\n${output}`,
    spawnFailure: () => failure,
    async stop() {
      removeHandlers();
      if (
        child.pid === undefined ||
        child.exitCode !== null ||
        child.signalCode !== null
      ) {
        return;
      }
      const closed = once(child, "close");
      signalGroup("SIGTERM");
      const outcome = await Promise.race([
        closed.then(() => "closed" as const),
        delay(SHUTDOWN_GRACE_MS).then(() => "still running" as const),
      ]);
      if (outcome === "still running") {
        signalGroup("SIGKILL");
        await closed;
      }
    },
  };
}

/**
 * Wait until `server` — and not merely something on that port — is answering.
 *
 * @remarks
 * A poll with a deadline rather than a fixed wait. The child's own report of
 * the address it bound gates the first `fetch`, because the port was released
 * by {@link reserveEphemeralPort} before the child took it: something else
 * winning that race would otherwise satisfy a bare `fetch`. When what the CLI
 * prints changes, the failure carries the output it did print.
 */
async function waitUntilServing(
  server: Server,
  bound: string,
  probe: string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const failure = server.spawnFailure();
    if (failure !== undefined) {
      throw new Error(`could not be spawned (${failure.message}):\n${server.output()}`);
    }
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
      throw new Error(`exited before it accepted a connection:\n${server.output()}`);
    }
    if (server.output().includes(bound)) {
      try {
        await fetch(probe, { redirect: "manual" });
        return;
      } catch {
        // Announced, not yet accepting.
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `did not serve ${bound} within ${String(READY_TIMEOUT_MS)}ms:\n${server.output()}`,
      );
    }
    await delay(POLL_INTERVAL_MS);
  }
}

const servers: Server[] = [];
const scratch: string[] = [];
/** The learner table this run's API creates; DynamoDB local keeps it until deleted. */
const tableName = `smoke-${randomUUID()}`;
let baseUrl = "";

beforeAll(async () => {
  assertFreshBuild();
  await assertDynamoDbLocal();

  const contentRoot = makeContentRoot();
  writeReviewedCards(contentRoot);
  const out = mkdtempSync(path.join(tmpdir(), "smoke-catalog-"));
  scratch.push(out);
  buildCatalog({ root: contentRoot, out });

  const apiPort = await reserveEphemeralPort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Vite prints the port it bound in bold when colour is on, which splits
    // the address `waitUntilServing` looks for; `NO_COLOR` wins over any
    // `FORCE_COLOR` the runner exports.
    NO_COLOR: "1",
    API_PORT: String(apiPort),
    API_TABLE_NAME: tableName,
    API_CATALOG_PATH: path.join(out, "en", "ja.json"),
  };
  // Exactly the command `pnpm api` runs.
  const api = startServer(
    "api",
    ["--import", "./scripts/ts-hooks.mjs", "apps/api/src/main.ts"],
    { cwd: repoRoot, env },
  );
  servers.push(api);
  await waitUntilServing(
    api,
    `"url":"http://127.0.0.1:${String(apiPort)}/api"`,
    `http://127.0.0.1:${String(apiPort)}/`,
  );

  const webPort = await reserveEphemeralPort();
  baseUrl = `http://127.0.0.1:${String(webPort)}`;
  const web = startServer("web", [viteCli, "preview", "--port", String(webPort)], {
    cwd: webRoot,
    env,
  });
  servers.push(web);
  await waitUntilServing(web, `127.0.0.1:${String(webPort)}`, baseUrl);
});

afterAll(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  const client = localDynamoDbClient(DYNAMODB_LOCAL_ENDPOINT);
  try {
    await deleteLearnerTable(client, tableName);
  } catch {
    // Never created: the API failed before its first start-up step.
  } finally {
    client.destroy();
  }
  removeContentRoots();
  for (const directory of scratch.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("the built web client, served by `vite preview`", () => {
  it("serves the document, dark-only and in Japanese", async () => {
    const response = await fetch(baseUrl);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const document = await response.text();
    expect(document).toMatch(/<html[^>]*\slang="ja"/u);
    expect(document).toMatch(/<meta name="color-scheme" content="dark"\s*\/?>/u);
    expect(document).toContain('<div id="root"></div>');
  });

  // Every route is the client's: the host answers any path with the same
  // document, and the router decides what it shows — a page it does not know
  // included.
  it.each(["/records", "/drill", "/no-such-page"])(
    "answers the client route %s with the same document",
    async (route) => {
      const response = await fetch(`${baseUrl}${route}`);

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<div id="root"></div>');
    },
  );

  // The only check that sees Tailwind's output at all: a component test
  // renders `className="p-8"` into the DOM whether or not a stylesheet was
  // ever generated.
  it("links a stylesheet carrying a utility the client uses", async () => {
    const document = await (await fetch(baseUrl)).text();
    const href = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/u.exec(document)?.[1];
    if (href === undefined) {
      throw new Error(`the document linked no stylesheet:\n${document}`);
    }
    const stylesheet = await fetch(new URL(href, baseUrl));

    expect(stylesheet.status).toBe(200);
    expect(stylesheet.headers.get("content-type")).toContain("text/css");
    await expect(stylesheet.text()).resolves.toMatch(/\.p-8\s*\{[^}]*padding:/u);
  });
});

describe("the API behind the client's own origin", () => {
  async function send(
    route: string,
    method: string,
    body?: unknown,
  ): Promise<Response> {
    return fetch(`${baseUrl}/api${route}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
          }),
    });
  }

  // One test on purpose: each step needs the state the one before it left in
  // the table.
  it("saves settings, starts a placement round, records an answer and reports the history", async () => {
    const saved = await send("/v1/settings", "PATCH", { topics: ["work", "daily"] });
    expect(saved.status).toBe(200);

    const started = await send("/v1/rounds", "POST", {
      roundId: "smoke",
      kind: "placement",
    });
    expect(started.status).toBe(200);
    const round = roundPayloadSchema.parse(await started.json());
    const first = round.deck[0];
    if (first === undefined) throw new Error("the placement round dealt no card");

    const answered = await send(`/v1/rounds/${round.id}/answers`, "POST", {
      answers: [
        { id: "smoke-1", cardId: first, pass: "first", result: "ok", elapsedMs: 2_000 },
      ],
    });
    expect(answered.status).toBe(204);

    const history = await send("/v1/history", "GET");
    expect(history.status).toBe(200);
    expect(historySchema.parse(await history.json())).toMatchObject({
      seenIds: [first],
      topics: ["work", "daily"],
    });
  });

  it("refuses a malformed body with the documented code", async () => {
    const response = await send("/v1/rounds", "POST", {
      roundId: "bad",
      kind: "bonus",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "ERR_BAD_REQUEST" } });
  });

  it("answers a path no route matches with a bare 404", async () => {
    const response = await send("/v1/no-such-route", "GET");

    expect(response.status).toBe(404);
  });
});
