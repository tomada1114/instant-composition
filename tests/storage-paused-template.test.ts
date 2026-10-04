import { describe, expect, it } from "vitest";
import { assertPausedStorageTemplate } from "../scripts/lib/storage-paused-template.mjs";
import { StorageTransitionError } from "../scripts/lib/storage-runtime.mjs";

const apiId = "ApiFunctionABC123";
const workerId = "ReadModelWorkerDEF456";
const literalDigest =
  "8d185b1f37eb135645b2383d902df7081a42184f67010e556d48a9b00e048da8";

function template() {
  return {
    Resources: {
      [apiId]: {
        Type: "AWS::Lambda::Function",
        Properties: { ReservedConcurrentExecutions: 0 },
      },
    },
  };
}

function writer(capacity: unknown = 0) {
  return {
    Type: "AWS::Lambda::Function",
    Properties: { ReservedConcurrentExecutions: capacity },
  };
}

describe("paused predecessor CloudFormation template", () => {
  it.each(["object", "JSON"])(
    "returns only the known canonical digest for a paused %s template",
    (kind) => {
      const value = template();
      expect(
        assertPausedStorageTemplate(
          { TemplateBody: kind === "JSON" ? JSON.stringify(value) : value },
          [apiId],
        ),
      ).toBe(literalDigest);
      expect(value).toEqual(template());
    },
  );

  it("binds both owned storage writers while allowing other stack resources", () => {
    const value = {
      Resources: {
        [apiId]: writer(),
        [workerId]: writer(),
        SecretProviderFunction: { Type: "AWS::Lambda::Function", Properties: {} },
        ApiFunctionLogsABCDEF: { Type: "AWS::Logs::LogGroup" },
        ApiFunctionServiceRoleFEDCBA: { Type: "AWS::IAM::Role" },
        ReadModelWorkerServiceRoleABCDEF: { Type: "AWS::IAM::Role" },
        Distribution: { Type: "AWS::CloudFront::Distribution" },
      },
    };
    expect(
      assertPausedStorageTemplate({ TemplateBody: value }, [apiId, workerId]),
    ).toMatch(/^[a-f0-9]{64}$/);
  });

  it("canonicalizes nested object order and retains all template metadata", () => {
    const value = {
      Metadata: { Z: "last", A: { two: 2, one: 1 } },
      Resources: template().Resources,
    };
    const reordered = {
      Resources: {
        [apiId]: {
          Properties: { ReservedConcurrentExecutions: 0 },
          Type: "AWS::Lambda::Function",
        },
      },
      Metadata: { A: { one: 1, two: 2 }, Z: "last" },
    };
    const digest = assertPausedStorageTemplate({ TemplateBody: value }, [apiId]);
    expect(assertPausedStorageTemplate({ TemplateBody: reordered }, [apiId])).toBe(
      digest,
    );
    expect(
      assertPausedStorageTemplate(
        { TemplateBody: { ...value, RevisionId: "retained-template-metadata" } },
        [apiId],
      ),
    ).not.toBe(digest);
    expect(
      assertPausedStorageTemplate(
        {
          TemplateBody: { ...value, Metadata: { Z: "changed", A: { one: 1, two: 2 } } },
        },
        [apiId],
      ),
    ).not.toBe(digest);
  });

  it("preserves array order in the digest", () => {
    const value = template();
    expect(
      assertPausedStorageTemplate(
        { TemplateBody: { ...value, Metadata: ["one", "two"] } },
        [apiId],
      ),
    ).not.toBe(
      assertPausedStorageTemplate(
        { TemplateBody: { ...value, Metadata: ["two", "one"] } },
        [apiId],
      ),
    );
  });

  it.each([
    { logicalIds: [] },
    { logicalIds: [workerId] },
    { logicalIds: [apiId, apiId] },
    { logicalIds: ["ApiFunctionUnknown"] },
    { logicalIds: ["unowned"] },
  ])("refuses an invalid or API-free owned inventory %j", ({ logicalIds }) => {
    expect(() =>
      assertPausedStorageTemplate({ TemplateBody: template() }, logicalIds),
    ).toThrow(StorageTransitionError);
  });

  it.each([
    undefined,
    null,
    1,
    -1,
    0.5,
    "0",
    false,
    { Ref: "Zero" },
    { "Fn::If": ["Pause", 0, 1] },
  ])("refuses concurrency that is not literal zero: %j", (capacity) => {
    const value = {
      Resources: {
        [apiId]: {
          Type: "AWS::Lambda::Function",
          Properties: { ReservedConcurrentExecutions: capacity },
        },
      },
    };
    expect(() => assertPausedStorageTemplate({ TemplateBody: value }, [apiId])).toThrow(
      StorageTransitionError,
    );
  });

  it.each([
    { Resources: {} },
    { Resources: { [apiId]: writer(), [workerId]: writer() } },
    { Resources: { [apiId]: writer(), ReadModelWorkerUnknown: writer() } },
    {
      Resources: {
        [apiId]: {
          Type: "AWS::S3::Bucket",
          Properties: { ReservedConcurrentExecutions: 0 },
        },
      },
    },
    { Resources: { [apiId]: null } },
    { Resources: { [apiId]: { Type: "AWS::Lambda::Function" } } },
    { Resources: { [apiId]: { Type: "AWS::Lambda::Function", Properties: null } } },
    { Resources: { [apiId]: { Type: "AWS::Lambda::Function", Properties: {} } } },
  ])("refuses missing, unexpected or malformed storage writers %j", (value) => {
    expect(() => assertPausedStorageTemplate({ TemplateBody: value }, [apiId])).toThrow(
      StorageTransitionError,
    );
  });

  it("requires the worker named by the observed predeployment inventory", () => {
    expect(() =>
      assertPausedStorageTemplate({ TemplateBody: template() }, [apiId, workerId]),
    ).toThrow(StorageTransitionError);
  });

  it.each([
    undefined,
    null,
    {},
    { TemplateBody: undefined },
    { TemplateBody: null },
    { TemplateBody: 0 },
    { TemplateBody: [] },
    { TemplateBody: {} },
    { TemplateBody: { Resources: [] } },
    { TemplateBody: "[]" },
    { TemplateBody: '"template"' },
    { TemplateBody: "Resources:\n  ApiFunctionABC123: {}" },
    { TemplateBody: "not JSON" },
  ])("refuses an unsupported response or non-JSON template %j", (response) => {
    expect(() => assertPausedStorageTemplate(response, [apiId])).toThrow(
      StorageTransitionError,
    );
  });

  it.each([undefined, NaN, Infinity, () => "unknown", new Date(0), Symbol("unknown")])(
    "refuses non-JSON metadata rather than discarding it: %s",
    (metadata) => {
      expect(() =>
        assertPausedStorageTemplate(
          { TemplateBody: { ...template(), Metadata: metadata } },
          [apiId],
        ),
      ).toThrow(StorageTransitionError);
    },
  );

  it("does not put private template contents into the refusal", () => {
    const value = {
      Resources: { [apiId]: { ...writer(1), Metadata: "private-fixture-content" } },
    };
    expect(() => assertPausedStorageTemplate({ TemplateBody: value }, [apiId])).toThrow(
      expect.objectContaining({
        code: "ERR_STORAGE_TRANSITION",
        part: "paused predecessor template",
      }),
    );
    expect(() =>
      assertPausedStorageTemplate({ TemplateBody: value }, [apiId]),
    ).not.toThrow(/private-fixture-content/);
  });
});
