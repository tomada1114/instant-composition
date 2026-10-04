import {
  copyFileSync,
  cpSync,
  symlinkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hashes,
  manifest,
  recordRelease,
  smokeRelease,
  trustRun,
  bundleRelease,
  checkoutSha,
  isCurrentMain,
} from "../scripts/lib/release.mjs";
import {
  digest,
  metadata,
  ReleaseError,
  releaseHandler,
  verifyFiles,
} from "../scripts/lib/release-runtime.mjs";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn(() => "a".repeat(40)) }));
import { main } from "../scripts/release.mjs";
import { mainChecks } from "../scripts/lib/release-checks.mjs";
const SHA = "a".repeat(40);
const REPOSITORY = "tomada1114/instant-composition";
const roots: string[] = [];
function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}
function successfulChecks(): { total_count: number; check_runs: object[] } {
  const check_runs = [
    "Static checks",
    "Test (ubuntu-latest)",
    "Spell check code and docs",
  ].map((name) => ({
    name,
    head_sha: SHA,
    app: { slug: "github-actions" },
    status: "completed",
    conclusion: "success",
  }));
  return { total_count: check_runs.length, check_runs };
}
function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "release-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function trusted(): object {
  return {
    action: "completed",
    workflow_run: {
      status: "completed",
      conclusion: "success",
      event: "push",
      head_branch: "main",
      head_sha: SHA,
      path: ".github/workflows/ci.yml",
      head_repository: { full_name: REPOSITORY },
    },
  };
}
describe("trusted release", () => {
  it("accepts the successful trusted CI completion for this exact main SHA", () => {
    expect(() => trustRun(trusted(), SHA, REPOSITORY)).not.toThrow();
  });
  it.each([
    ["conclusion", "failure"],
    ["conclusion", "cancelled"],
    ["status", "in_progress"],
    ["conclusion", null],
    ["head_sha", "b".repeat(40)],
    ["event", "pull_request"],
    ["head_branch", "feature"],
    ["path", ".github/workflows/other.yml"],
    ["head_repository", { full_name: "fork/repo" }],
  ])("refuses CI with %s=%j", (key, value) => {
    const event = {
      ...trusted(),
      workflow_run: {
        status: "completed",
        conclusion: "success",
        event: "push",
        head_branch: "main",
        head_sha: SHA,
        path: ".github/workflows/ci.yml",
        head_repository: { full_name: REPOSITORY },
        [key]: value,
      },
    };
    expect(() => trustRun(event, SHA, REPOSITORY)).toThrow(ReleaseError);
  });
  it.each([
    undefined,
    {},
    { sha: "bad", files: {} },
    { sha: SHA, files: {} },
    { sha: SHA, files: { "../index": "a".repeat(64) } },
    { sha: SHA, files: { index: "bad" } },
  ])("rejects invalid release metadata %j", (value) => {
    expect(() => metadata(value)).toThrow(ReleaseError);
  });
  it("refuses component identity disagreements", () => {
    const part = { sha: SHA, files: { index: digest("bytes") } };
    expect(() =>
      manifest({ ...part, api: part, web: { ...part, sha: "b".repeat(40) } }),
    ).toThrow(ReleaseError);
  });
  it("detects changed packaged artifacts before serving even the health endpoint", () => {
    const root = fixture();
    writeFileSync(path.join(root, "index.mjs"), "original");
    const release = { sha: SHA, files: hashes(root) };
    verifyFiles(root, release);
    writeFileSync(path.join(root, "release.json"), JSON.stringify(release));
    writeFileSync(path.join(root, "index.mjs"), "changed");
    expect(() => releaseHandler(root, () => Promise.resolve(null))).toThrow(
      ReleaseError,
    );
  });
  it("serves release health without invoking the app and forwards other methods and paths", async () => {
    const root = fixture();
    writeFileSync(path.join(root, "index.mjs"), "original");
    const release = { sha: SHA, files: hashes(root) };
    writeFileSync(path.join(root, "release.json"), JSON.stringify(release));
    const next = vi.fn(() => Promise.resolve("app"));
    const serve = releaseHandler(root, next);
    expect(
      await serve({
        rawPath: "/api/release",
        requestContext: { http: { method: "GET" } },
      }),
    ).toMatchObject({ statusCode: 200, body: JSON.stringify(release) });
    expect(next).not.toHaveBeenCalled();
    expect(
      await serve({
        rawPath: "/api/v1/home",
        requestContext: { http: { method: "GET" } },
      }),
    ).toBe("app");
    expect(
      await serve({
        rawPath: "/api/release",
        requestContext: { http: { method: "POST" } },
      }),
    ).toBe("app");
  });
});

function smokeFixture() {
  const web = {
    "index.html": "<!doctype html>",
    "assets/app.js": "export {};",
    "release.json": JSON.stringify({ sha: SHA }),
  };
  const api = {
    sha: SHA,
    files: { "index.mjs": digest("api"), "catalog/en/ja.json": digest("catalog") },
  };
  const release = manifest({
    sha: SHA,
    files: { assembly: digest("assembly") },
    web: {
      sha: SHA,
      files: Object.fromEntries(
        Object.entries(web).map(([name, bytes]) => [name, digest(bytes)]),
      ),
    },
    api,
  });
  const bodies: Record<string, string> = {
    ...web,
    records: web["index.html"],
    "api/release": JSON.stringify(api),
    "api/v1/home": JSON.stringify({
      error: { code: "ERR_UNAUTHENTICATED", message: "Sign in" },
    }),
  };
  const request = vi.fn<typeof fetch>((input) => {
    const name = new URL(input instanceof Request ? input.url : input).pathname.slice(
      1,
    );
    return Promise.resolve(
      new Response(bodies[name], { status: name === "api/v1/home" ? 401 : 200 }),
    );
  });
  return { release, bodies, request };
}
describe("CloudFront release smoke", () => {
  it("checks SPA routes, assets, API health and the unauthenticated contract with GET only", async () => {
    const { release, request } = smokeFixture();
    await smokeRelease("https://example.cloudfront.net", release, request);
    expect(
      request.mock.calls.map(
        ([url]) => new URL(url instanceof Request ? url.url : url).pathname,
      ),
    ).toEqual([
      "/index.html",
      "/assets/app.js",
      "/release.json",
      "/records",
      "/api/release",
      "/api/v1/home",
    ]);
    expect(request.mock.calls.every(([, init]) => init?.method === undefined)).toBe(
      true,
    );
  });
  it.each([
    "index.html",
    "assets/app.js",
    "release.json",
    "records",
    "api/release",
    "api/v1/home",
  ])("fails for mismatched %s", async (name) => {
    const { release, bodies, request } = smokeFixture();
    bodies[name] =
      name === "api/release"
        ? JSON.stringify({ sha: "b".repeat(40), files: release.api.files })
        : "{}";
    await expect(
      smokeRelease("https://example.cloudfront.net", release, request),
    ).rejects.toBeInstanceOf(ReleaseError);
  });
  it("fails for unavailable HTTP responses", async () => {
    const { release } = smokeFixture();
    await expect(
      smokeRelease("https://example.cloudfront.net", release, () =>
        Promise.resolve(new Response(null, { status: 503 })),
      ),
    ).rejects.toBeInstanceOf(ReleaseError);
  });
  it("propagates network failure", async () => {
    const { release } = smokeFixture();
    await expect(
      smokeRelease("https://example.cloudfront.net", release, () =>
        Promise.reject(new Error("network")),
      ),
    ).rejects.toThrow();
  });
  it.each([
    "http://example.test",
    "https://example.test/path",
    "https://example.test?key=value",
  ])("refuses unsafe origin %s", async (origin) => {
    const { release, request } = smokeFixture();
    await expect(smokeRelease(origin, release, request)).rejects.toBeInstanceOf(
      ReleaseError,
    );
    expect(request).not.toHaveBeenCalled();
  });
});

describe("packaged release manifest", () => {
  function assemblyFixture() {
    const root = fixture();
    mkdirSync(path.join(root, "scripts/lib"), { recursive: true });
    for (const name of ["release-runtime.mjs", "json.mjs"])
      copyFileSync(
        new URL(`../scripts/lib/${name}`, import.meta.url),
        path.join(root, "scripts/lib", name),
      );
    const assembly = path.join(root, "assembly");
    const bundle = path.join(assembly, "asset.api");
    mkdirSync(path.join(bundle, "catalog/en"), { recursive: true });
    writeFileSync(path.join(bundle, "index.mjs"), "export const handler = () => null;");
    writeFileSync(path.join(bundle, "catalog/en/ja.json"), "{}");
    bundleRelease(root, bundle);
    const web = path.join(root, "apps/web/dist");
    mkdirSync(web, { recursive: true });
    writeFileSync(path.join(web, "index.html"), "<!doctype html>");
    writeFileSync(path.join(web, "release.json"), JSON.stringify({ sha: SHA }));
    cpSync(web, path.join(assembly, "asset.web"), { recursive: true });
    return { root, assembly, bundle, web };
  }
  it("records the exact checkout, assembled API and catalog hashes, and web build", () => {
    const { root, assembly, bundle } = assemblyFixture();
    const release = recordRelease(root, assembly, SHA);
    expect(checkoutSha(root)).toBe(SHA);
    expect(release.sha).toBe(SHA);
    expect(release.api.files["catalog/en/ja.json"]).toBe(digest("{}"));
    expect(release.api.files["release.mjs"]).toBe(
      digest(readFileSync(path.join(bundle, "release.mjs"))),
    );
    verifyFiles(assembly, release);
  });
  it("can regenerate release metadata in the same bundle directory without hashing itself", () => {
    const { root, bundle } = assemblyFixture();
    const first: unknown = JSON.parse(
      readFileSync(path.join(bundle, "release.json"), "utf8"),
    );
    bundleRelease(root, bundle);
    const second: unknown = JSON.parse(
      readFileSync(path.join(bundle, "release.json"), "utf8"),
    );
    const release = metadata(second);
    expect(second).toEqual(first);
    expect(release.files).not.toHaveProperty("release.json");
    verifyFiles(bundle, release);
  });
  it("rejects web bytes which differ from the assembled upload", () => {
    const { root, assembly, web } = assemblyFixture();
    writeFileSync(path.join(web, "index.html"), "different");
    expect(() => recordRelease(root, assembly, SHA)).toThrow(ReleaseError);
  });
  it("rejects symbolic links in artifacts", () => {
    const root = fixture();
    symlinkSync("/tmp", path.join(root, "outside"));
    expect(() => hashes(root)).toThrow(ReleaseError);
  });
  it("runs the release CLI commands through one manifest and preserves failures", async () => {
    const { root, assembly, bundle, web } = assemblyFixture();
    mkdirSync(path.join(root, "dist"));
    await main(["web", SHA], root);
    await main(["record", assembly, SHA], root);
    await main(["verify", assembly, SHA], root);
    const event = path.join(root, "event.json");
    writeFileSync(event, JSON.stringify(trusted()));
    await main(["trust", event, SHA, REPOSITORY], root);
    await expect(
      main(["verify", assembly, "b".repeat(40)], root),
    ).rejects.toBeInstanceOf(ReleaseError);
    await expect(main(["web", "bad"], root)).rejects.toBeInstanceOf(ReleaseError);
    const packaged = path.join(root, "other");
    mkdirSync(packaged);
    writeFileSync(path.join(packaged, "index.mjs"), "other");
    await main(["bundle", root, packaged], root);
    expect(readFileSync(path.join(packaged, "release.json"), "utf8")).toContain(SHA);
    const outputs = path.join(root, "outputs.json");
    writeFileSync(
      outputs,
      JSON.stringify({
        "instant-composition-dev-app": { WebUrl: "https://example.cloudfront.net" },
      }),
    );
    const packagedApi = metadata(
      JSON.parse(readFileSync(path.join(bundle, "release.json"), "utf8")),
    );
    const request: typeof fetch = (input) => {
      const name = new URL(input instanceof Request ? input.url : input).pathname.slice(
        1,
      );
      const body =
        name === "api/release"
          ? JSON.stringify(packagedApi)
          : name === "api/v1/home"
            ? JSON.stringify({ error: { code: "ERR_UNAUTHENTICATED" } })
            : readFileSync(path.join(web, name === "records" ? "index.html" : name));
      return Promise.resolve(
        new Response(body, { status: name === "api/v1/home" ? 401 : 200 }),
      );
    };
    await main(["smoke", outputs], root, request);
    writeFileSync(outputs, "{}");
    await expect(main(["smoke", outputs], root, request)).rejects.toBeInstanceOf(
      ReleaseError,
    );
    await expect(main([], root)).rejects.toBeInstanceOf(ReleaseError);
  });
  it("refuses files added to an assembly after its release was recorded", async () => {
    const { root, assembly, bundle } = assemblyFixture();
    mkdirSync(path.join(root, "dist"));
    await main(["record", assembly, SHA], root);
    writeFileSync(path.join(bundle, "extra.mjs"), "unrecorded");
    await expect(main(["verify", assembly, SHA], root)).rejects.toBeInstanceOf(
      ReleaseError,
    );
  });
  it("refuses a recorded file replaced by a link to identical bytes outside the assembly", async () => {
    const { root, assembly, bundle } = assemblyFixture();
    mkdirSync(path.join(root, "dist"));
    await main(["record", assembly, SHA], root);
    const original = path.join(bundle, "index.mjs");
    const outside = path.join(root, "outside.mjs");
    renameSync(original, outside);
    symlinkSync(outside, original);
    await expect(main(["verify", assembly, SHA], root)).rejects.toBeInstanceOf(
      ReleaseError,
    );
  });
  it("rejects a checkout different from the selected CI SHA", () => {
    const { root, assembly } = assemblyFixture();
    expect(() => recordRelease(root, assembly, "b".repeat(40))).toThrow(ReleaseError);
  });
  it("rejects web identity disagreement", () => {
    const { root, assembly, web } = assemblyFixture();
    writeFileSync(
      path.join(web, "release.json"),
      JSON.stringify({ sha: "b".repeat(40) }),
    );
    expect(() => recordRelease(root, assembly, SHA)).toThrow(ReleaseError);
  });
  it("rejects API identity disagreement", () => {
    const { root, assembly, bundle } = assemblyFixture();
    writeFileSync(
      path.join(bundle, "release.json"),
      JSON.stringify({ sha: "b".repeat(40), files: { "index.mjs": digest("api") } }),
    );
    expect(() => recordRelease(root, assembly, SHA)).toThrow(ReleaseError);
  });
  it("rejects an assembly without exactly one API release bundle", () => {
    const root = fixture();
    expect(() => recordRelease(root, root, SHA)).toThrow(ReleaseError);
  });
});

describe("superseded main guard", () => {
  it.each([
    [SHA, true],
    ["b".repeat(40), false],
  ])("deploys only when current main is %s", async (current, expected) => {
    expect(
      await isCurrentMain(REPOSITORY, SHA, "test", () =>
        Promise.resolve(Response.json({ object: { sha: current } })),
      ),
    ).toBe(expected);
  });
  it("fails closed when GitHub does not answer", async () => {
    await expect(
      isCurrentMain(REPOSITORY, SHA, "test", () =>
        Promise.resolve(new Response(null, { status: 403 })),
      ),
    ).rejects.toBeInstanceOf(ReleaseError);
  });
  it("fails closed for a malformed GitHub response", async () => {
    await expect(
      isCurrentMain(REPOSITORY, SHA, "test", () =>
        Promise.resolve(Response.json({ object: {} })),
      ),
    ).rejects.toBeInstanceOf(ReleaseError);
  });
  it.each([
    ["invalid", "test"],
    [REPOSITORY, ""],
  ])("rejects invalid guard configuration", async (repository, token) => {
    await expect(isCurrentMain(repository, SHA, token)).rejects.toBeInstanceOf(
      ReleaseError,
    );
  });
});

describe("current main CLI output", () => {
  it("waits for the separate spell check before enabling deployment", async () => {
    const output = path.join(fixture(), "output");
    vi.stubEnv("GITHUB_TOKEN", "test");
    vi.stubEnv("GITHUB_OUTPUT", output);
    let calls = 0;
    const wait = vi.fn(() => Promise.resolve());
    await main(
      ["current", REPOSITORY, SHA],
      fixture(),
      (url) => {
        const body = successfulChecks();
        if (requestUrl(url).includes("/check-runs?")) {
          if (calls++ === 0)
            body.check_runs[2] = {
              ...body.check_runs[2],
              status: "in_progress",
              conclusion: null,
            };
          return Promise.resolve(Response.json(body));
        }
        return Promise.resolve(Response.json({ object: { sha: SHA } }));
      },
      wait,
    );
    expect(wait).toHaveBeenCalledOnce();
    expect(calls).toBe(2);
    expect(readFileSync(output, "utf8")).toBe("deploy=true\n");
  });
  it("skips a main advance while waiting for a required check", async () => {
    const output = path.join(fixture(), "output");
    vi.stubEnv("GITHUB_TOKEN", "test");
    vi.stubEnv("GITHUB_OUTPUT", output);
    let current = SHA;
    await main(
      ["current", REPOSITORY, SHA],
      fixture(),
      (url) => {
        if (requestUrl(url).includes("/check-runs?"))
          return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
        return Promise.resolve(Response.json({ object: { sha: current } }));
      },
      () => {
        current = "b".repeat(40);
        return Promise.resolve();
      },
    );
    expect(readFileSync(output, "utf8")).toBe("deploy=false\n");
  });
  it.each([
    [SHA, "true"],
    ["b".repeat(40), "false"],
  ])("records eligibility for main %s", async (sha, eligible) => {
    const output = path.join(fixture(), "output");
    vi.stubEnv("GITHUB_TOKEN", "test");
    vi.stubEnv("GITHUB_OUTPUT", output);
    await main(["current", REPOSITORY, SHA], fixture(), (url) =>
      Promise.resolve(
        Response.json(
          requestUrl(url).includes("/check-runs?")
            ? successfulChecks()
            : { object: { sha } },
        ),
      ),
    );
    expect(readFileSync(output, "utf8")).toBe(`deploy=${eligible}\n`);
  });
  it("requires GitHub step output", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test");
    vi.stubEnv("GITHUB_OUTPUT", undefined);
    await expect(
      main(["current", REPOSITORY, SHA], fixture(), (url) =>
        Promise.resolve(
          Response.json(
            requestUrl(url).includes("/check-runs?")
              ? successfulChecks()
              : { object: { sha: SHA } },
          ),
        ),
      ),
    ).rejects.toBeInstanceOf(ReleaseError);
  });
});

describe("required main check gate", () => {
  it.each([
    ["invalid", SHA, "test"],
    [REPOSITORY, "bad", "test"],
    [REPOSITORY, SHA, ""],
  ])("refuses invalid configuration %s/%s", async (repository, sha, token) => {
    await expect(mainChecks(repository, sha, token)).rejects.toBeInstanceOf(
      ReleaseError,
    );
  });
  it("includes the separate spell workflow for the exact release SHA", async () => {
    expect(
      await mainChecks(REPOSITORY, SHA, "test", () =>
        Promise.resolve(Response.json(successfulChecks())),
      ),
    ).toBe(true);
  });
  it.each([
    { status: "queued", conclusion: null },
    { status: "in_progress", conclusion: null },
    { head_sha: "b".repeat(40) },
    { app: { slug: "another-app" } },
  ])("waits when the required spell result is not ready: %j", async (change) => {
    const body = successfulChecks();
    body.check_runs[2] = { ...body.check_runs[2], ...change };
    expect(
      await mainChecks(REPOSITORY, SHA, "test", () =>
        Promise.resolve(Response.json(body)),
      ),
    ).toBe(false);
  });
  it.each(["failure", "cancelled", "skipped", null])(
    "refuses a non-successful required spell result: %s",
    async (conclusion) => {
      const body = successfulChecks();
      body.check_runs[2] = { ...body.check_runs[2], conclusion };
      await expect(
        mainChecks(REPOSITORY, SHA, "test", () => Promise.resolve(Response.json(body))),
      ).rejects.toBeInstanceOf(ReleaseError);
    },
  );
  it.each([{}, { total_count: 4, check_runs: [] }])(
    "refuses incomplete or malformed check pages: %j",
    async (body) => {
      await expect(
        mainChecks(REPOSITORY, SHA, "test", () => Promise.resolve(Response.json(body))),
      ).rejects.toBeInstanceOf(ReleaseError);
    },
  );
  it("refuses a failed GitHub lookup", async () => {
    await expect(
      mainChecks(REPOSITORY, SHA, "test", () =>
        Promise.resolve(new Response(null, { status: 403 })),
      ),
    ).rejects.toBeInstanceOf(ReleaseError);
  });
});
