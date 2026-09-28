import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import {
  buildApp,
  LAMBDA_CATALOG_PATH,
  REPOSITORY_ROOT_CONTEXT,
} from "@instant-composition/infra";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { REPOSITORY_ROOT } from "./infra-context";

// The one suite that bundles the API the way a deploy does: esbuild through
// NodejsFunction, then the catalog build into the same directory. Every other
// infra suite synthesizes with bundling off.
describe("the dev app stack's function bundle", () => {
  let outdir = "";
  let bundle = "";

  beforeAll(() => {
    outdir = mkdtempSync(path.join(tmpdir(), "infra-api-bundle-"));
    vi.stubEnv("CDK_OUTDIR", outdir);
    const assembly = buildApp({
      stage: "dev",
      [REPOSITORY_ROOT_CONTEXT]: REPOSITORY_ROOT,
      "aws:cdk:bundling-stacks": ["app"],
    }).app.synth();
    const template: unknown = assembly.getStackArtifact("app").template;
    // The API's function, not the web client secret writer beside it.
    const [code, ...others] = Object.entries(
      (template as { Resources: Record<string, { Type: string; Properties: unknown }> })
        .Resources,
    )
      .filter(
        ([id, { Type }]) =>
          Type === "AWS::Lambda::Function" && id.startsWith("ApiFunction"),
      )
      .map(([, { Properties }]) => (Properties as { Code: { S3Key: string } }).Code);
    if (code === undefined || others.length > 0) {
      throw new TypeError("the app stack has no single API function");
    }
    const key = code.S3Key;
    bundle = path.join(assembly.directory, `asset.${key.replace(/\.zip$/, "")}`);
  }, 60_000);

  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(outdir, { recursive: true, force: true });
  });

  it("holds the handler module and the catalog snapshot where the function reads it", () => {
    expect(existsSync(path.join(bundle, "index.mjs"))).toBe(true);
    const catalog = path.join(bundle, path.relative("/var/task", LAMBDA_CATALOG_PATH));
    expect(JSON.parse(readFileSync(catalog, "utf8"))).toMatchObject({
      target: "en",
      l1: "ja",
    });
  });

  // The handler loads in a bare Node process as the runtime would load it:
  // every import bundled, and the environment read once at start.
  it("starts with the hosted environment and answers an unknown route with 404", () => {
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const { handler } = await import(${JSON.stringify(path.join(bundle, "index.mjs"))});
const answer = await handler({
  version: "2.0", routeKey: "$default", rawPath: "/api/v1/nowhere", rawQueryString: "",
  headers: { host: "example.cloudfront.net" }, isBase64Encoded: false,
  requestContext: { http: { method: "GET", path: "/api/v1/nowhere", protocol: "HTTP/1.1", sourceIp: "192.0.2.1", userAgent: "test" },
    accountId: "123456789012", apiId: "api", domainName: "example", requestId: "r", routeKey: "$default", stage: "$default", time: "", timeEpoch: 0 },
});
process.stderr.write(JSON.stringify({ status: answer.statusCode }));`,
      ],
      {
        cwd: bundle,
        encoding: "utf8",
        env: {
          PATH: process.env["PATH"] ?? "",
          AWS_REGION: "ap-northeast-1",
          AWS_SESSION_TOKEN: "token",
          API_TABLE_NAME: "learners",
          API_CATALOG_PATH: path.join(bundle, "catalog/en/ja.json"),
          API_COGNITO_USER_POOL_ID: "ap-northeast-1_example",
          API_COGNITO_CLIENT_ID: "client",
          API_COGNITO_DOMAIN: "https://example.auth.ap-northeast-1.amazoncognito.com",
          API_COGNITO_CLIENT_SECRET_PARAMETER:
            "/instant-composition/dev/app/web-client-secret",
          API_WEB_ORIGINS: "https://example.cloudfront.net",
          API_WEB_CALLBACK_URL: "https://example.cloudfront.net/api/v1/auth/callback",
          API_WEB_SIGN_OUT_URL: "https://example.cloudfront.net/",
        },
      },
    );
    expect(child.status).toBe(0);
    expect(child.stderr).toBe(JSON.stringify({ status: 404 }));
  });

  it("refuses to start without the hosted environment", () => {
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(path.join(bundle, "index.mjs"))});`,
      ],
      { cwd: bundle, encoding: "utf8", env: { PATH: process.env["PATH"] ?? "" } },
    );
    expect(child.status).not.toBe(0);
    expect(child.stderr).toContain("ERR_API_ENV_INVALID");
  });
});
