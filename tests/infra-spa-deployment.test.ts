import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { AppStack, buildApp, WEB_DIST_CONTEXT } from "@instant-composition/infra";
import { Template } from "aws-cdk-lib/assertions";
import { afterAll, describe, expect, it } from "vitest";

import { infraContext } from "./infra-context";

// A stand-in for `pnpm web:build`'s output: the suite must not depend on a
// build having run, and only the directory's shape matters here.
const WEB_DIST = mkdtempSync(path.join(tmpdir(), "infra-spa-deployment-"));
mkdirSync(path.join(WEB_DIST, "assets"));
writeFileSync(path.join(WEB_DIST, "index.html"), "<!doctype html>");
writeFileSync(path.join(WEB_DIST, "assets", "index-3f2a.js"), "export {};");

afterAll(() => {
  rmSync(WEB_DIST, { recursive: true, force: true });
});

function synthesizeApp(context: Record<string, unknown>): Template {
  const stack = buildApp(context).app.node.findChild("app");
  if (!(stack instanceof AppStack)) {
    throw new TypeError("the dev app has no app stack");
  }
  return Template.fromStack(stack);
}

// Synthesized once at collection, outside any test's timeout (#150).
const WITHOUT = synthesizeApp(infraContext("dev"));
const WITH_EMPTY = synthesizeApp({ ...infraContext("dev"), [WEB_DIST_CONTEXT]: "" });
const TEMPLATE = synthesizeApp({
  ...infraContext("dev"),
  [WEB_DIST_CONTEXT]: WEB_DIST,
});

const DEPLOYMENT = "Custom::CDKBucketDeployment";

interface Resource {
  readonly Type: string;
  readonly Properties: Record<string, unknown>;
  readonly DependsOn?: string[];
}

/** BucketDeployment's one handler, a singleton whose logical id carries a fixed uuid. */
function uploadHandlers(template: Template): Resource[] {
  return Object.entries(
    template.findResources("AWS::Lambda::Function") as Record<string, Resource>,
  )
    .filter(([id]) => id.startsWith("CustomCDKBucketDeployment"))
    .map(([, resource]) => resource);
}

function singleId(type: string): string {
  const ids = Object.keys(TEMPLATE.findResources(type));
  if (ids.length !== 1 || ids[0] === undefined) {
    throw new TypeError(`the template has no single ${type}`);
  }
  return ids[0];
}

/** The upload the construct `name` made: its logical id is prefixed with the name. */
function upload(name: string): { id: string; resource: Resource } {
  const [found, ...others] = Object.entries(
    TEMPLATE.findResources(DEPLOYMENT) as Record<string, Resource>,
  ).filter(([id]) => id.startsWith(`${name}CustomResource`));
  if (found === undefined || others.length > 0) {
    throw new TypeError(`the template has no single ${name} upload`);
  }
  return { id: found[0], resource: found[1] };
}

describe("the dev app stack's web upload", () => {
  it.each([
    ["without", WITHOUT],
    ["with an empty", WITH_EMPTY],
  ])(
    "uploads nothing %s web-dist context, so synthesis needs no build",
    (_, template) => {
      expect(template.findResources(DEPLOYMENT)).toStrictEqual({});
      expect(uploadHandlers(template)).toStrictEqual([]);
      expect(template.findResources("AWS::Lambda::LayerVersion")).toStrictEqual({});
    },
  );

  it("uploads the build twice, from the same asset, into the SPA bucket", () => {
    const hashed = upload("SpaAssets").resource.Properties;
    const entry = upload("SpaEntry").resource.Properties;
    expect(Object.keys(TEMPLATE.findResources(DEPLOYMENT))).toHaveLength(2);
    const bucket = { Ref: singleId("AWS::S3::Bucket") };
    expect(hashed["DestinationBucketName"]).toStrictEqual(bucket);
    expect(entry["DestinationBucketName"]).toStrictEqual(bucket);
    expect(hashed["SourceObjectKeys"]).toHaveLength(1);
    expect(entry["SourceObjectKeys"]).toStrictEqual(hashed["SourceObjectKeys"]);
    expect(hashed).not.toHaveProperty("DestinationBucketKeyPrefix");
    expect(entry).not.toHaveProperty("DestinationBucketKeyPrefix");
  });

  // A page loaded before a deploy still fetches the chunks it names.
  it("caches the fingerprinted assets for a year and never prunes them", () => {
    expect(upload("SpaAssets").resource.Properties).toMatchObject({
      Exclude: ["*"],
      Include: ["assets/*"],
      Prune: false,
      SystemMetadata: { "cache-control": "public, max-age=31536000, immutable" },
      OutputObjectKeys: false,
    });
    expect(upload("SpaAssets").resource.Properties).not.toHaveProperty(
      "DistributionId",
    );
  });

  // CachingOptimized would otherwise serve the previous index.html, which
  // names the previous assets, for up to a day after a deploy.
  it("revalidates everything else, prunes it, and invalidates the distribution", () => {
    const { Properties: properties } = upload("SpaEntry").resource;
    expect(properties).toMatchObject({
      Exclude: ["assets/*"],
      Prune: true,
      SystemMetadata: { "cache-control": "no-cache" },
      DistributionId: { Ref: singleId("AWS::CloudFront::Distribution") },
      DistributionPaths: ["/*"],
      WaitForDistributionInvalidation: true,
      OutputObjectKeys: false,
    });
    expect(properties).not.toHaveProperty("Include");
  });

  it("uploads index.html only once the assets it names are in the bucket", () => {
    expect(upload("SpaEntry").resource.DependsOn).toContain(upload("SpaAssets").id);
  });

  it("updates the API before exposing an entry that relies on its additive fields", () => {
    const functions = Object.keys(TEMPLATE.findResources("AWS::Lambda::Function"));
    const handler = functions.find((id) => id.startsWith("ApiFunction"));
    expect(handler).toBeDefined();
    expect(upload("SpaEntry").resource.DependsOn).toContain(handler);
  });

  it("keeps the uploaded files when an upload is removed from the stack", () => {
    for (const name of ["SpaAssets", "SpaEntry"]) {
      expect(upload(name).resource.Properties).not.toHaveProperty("RetainOnDelete");
    }
  });

  it("runs one handler, logging to a group kept for a month", () => {
    const handlers = uploadHandlers(TEMPLATE);
    expect(handlers).toHaveLength(1);
    const logs = Object.entries(TEMPLATE.findResources("AWS::Logs::LogGroup")).find(
      ([id]) => id.startsWith("SpaDeploymentLogs"),
    );
    expect(logs?.[1]).toMatchObject({ Properties: { RetentionInDays: 30 } });
    expect(handlers[0]?.Properties["LoggingConfig"]).toStrictEqual({
      LogGroup: { Ref: logs?.[0] },
    });
  });

  it("lets the handler write only to the SPA bucket", () => {
    const bucketArn = { "Fn::GetAtt": [singleId("AWS::S3::Bucket"), "Arn"] };
    const policies = Object.values(TEMPLATE.findResources("AWS::IAM::Policy")).map(
      (policy) =>
        (policy as Resource).Properties["PolicyDocument"] as {
          Statement: { Action: string | string[]; Resource: unknown }[];
        },
    );
    const writes = policies
      .flatMap(({ Statement }) => Statement)
      .filter(({ Action }) =>
        [Action].flat().some((action) => /^s3:(Put|Delete)/.test(action)),
      );
    expect(writes).toHaveLength(1);
    expect(writes[0]?.Resource).toStrictEqual([
      bucketArn,
      { "Fn::Join": ["", [bucketArn, "/*"]] },
    ]);
  });

  it("refuses to synthesize from a build directory that does not exist", () => {
    expect(() =>
      synthesizeApp({
        ...infraContext("dev"),
        [WEB_DIST_CONTEXT]: path.join(WEB_DIST, "missing"),
      }),
    ).toThrow(/missing/);
  });
});

describe("release health routing through the deployed origin", () => {
  it("forwards the API namespace through CloudFront to the same HTTP API catch-all Lambda", () => {
    expect(() => {
      TEMPLATE.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          CacheBehaviors: [
            {
              PathPattern: "/api/*",
              AllowedMethods: [
                "GET",
                "HEAD",
                "OPTIONS",
                "PUT",
                "PATCH",
                "POST",
                "DELETE",
              ],
            },
          ],
        },
      });
      TEMPLATE.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: "ANY /{proxy+}",
      });
      TEMPLATE.hasResourceProperties("AWS::Lambda::Function", {
        Handler: "storage.handler",
      });
    }).not.toThrow();
  });
});
