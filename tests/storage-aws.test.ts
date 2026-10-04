import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bundleStorageGuard } from "../scripts/storage-bundle.mjs";
import {
  awsStorageTransition,
  type StorageCommands,
} from "../scripts/lib/storage-aws.mjs";
import {
  guardMetadata,
  storageDigest,
  StorageTransitionError,
} from "../scripts/lib/storage-runtime.mjs";
import { storagePolicy } from "../scripts/lib/storage-compatibility.mjs";
import { parseJson } from "../scripts/lib/json.mjs";
import { storedZip } from "./storage-zip-fixture";
import { transitionStorageWriters } from "../scripts/lib/storage-transition.mjs";
import { storageConfigurationHash } from "../scripts/lib/storage-configuration.mjs";
import { deployedStorageZip } from "../scripts/lib/storage-aws-transport.mjs";

vi.mock("node:timers", () => ({
  setTimeout: (callback: () => void, ms: number) => globalThis.setTimeout(callback, ms),
  clearTimeout: (timer: ReturnType<typeof setTimeout>) =>
    globalThis.clearTimeout(timer),
}));

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});
function fixture() {
  const root = path.resolve(import.meta.dirname, ".."),
    directory = mkdtempSync(path.join(tmpdir(), "storage-aws-"));
  folders.push(directory);
  writeFileSync(
    path.join(directory, "index.mjs"),
    "export async function handler() {}\n",
  );
  bundleStorageGuard(root, directory);
  const metadataBytes = readFileSync(path.join(directory, "storage-release.json")),
    release = guardMetadata(parseJson(metadataBytes.toString("utf8"))),
    files = Object.fromEntries(
      Object.keys(release.files).map((name) => [
        name,
        readFileSync(path.join(directory, name)),
      ]),
    );
  files["storage-release.json"] = metadataBytes;
  let zip = storedZip(files),
    reserved: number | undefined = 0,
    handler = "storage.handler",
    state = "Active",
    update = "Successful",
    stackStatus = "UPDATE_COMPLETE",
    revision = "revision1",
    account = "123456789012",
    revisionCounter = 1,
    accountLimit = 1000;
  let configExtras: Record<string, unknown> = {};
  let duringMutation: () => void = () => undefined;
  let duringDownload: () => void = () => undefined;
  const logicalId = "ApiFunctionABC123",
    physical = `instant-composition-dev-app-${logicalId}-owned`,
    arn = `arn:aws:lambda:ap-northeast-1:123456789012:function:${physical}`;
  const calls: string[][] = [];
  const cdkCalls: string[][] = [];
  const bootstrap: boolean[] = [];
  const configuration = () => ({
    ...configExtras,
    FunctionArn: arn,
    State: state,
    LastUpdateStatus: update,
    Timeout: 25,
    RevisionId: revision,
    CodeSha256: Buffer.from(storageDigest(zip), "hex").toString("base64"),
    Handler: handler,
  });
  const commands: StorageCommands = {
    aws(args, env) {
      calls.push(args);
      bootstrap.push(env["AWS_ACCESS_KEY_ID"] === "fixture-access");
      switch (args.slice(0, 2).join(" ")) {
        case "sts get-caller-identity":
          return { Account: account };
        case "sts assume-role":
          return {
            Credentials: {
              AccessKeyId: "fixture-access",
              SecretAccessKey: "fixture-secret",
              SessionToken: "fixture-session",
            },
          };
        case "cloudformation list-stack-resources":
          return {
            StackResourceSummaries: [
              {
                ResourceType: "AWS::Lambda::Function",
                LogicalResourceId: logicalId,
                PhysicalResourceId: physical,
              },
            ],
          };
        case "cloudformation describe-stacks":
          return {
            Stacks: [
              {
                StackStatus: stackStatus,
                StackId: `arn:aws:cloudformation:ap-northeast-1:${account}:stack/instant-composition-dev-app/fixture`,
              },
            ],
          };
        case "cloudformation get-template":
          return {
            TemplateBody: {
              Resources: {
                [logicalId]: {
                  Type: "AWS::Lambda::Function",
                  Properties: { ReservedConcurrentExecutions: 0 },
                },
              },
            },
          };
        case "lambda get-account-settings":
          return {
            AccountLimit: {
              ConcurrentExecutions: accountLimit,
              UnreservedConcurrentExecutions: accountLimit - (reserved ?? 0),
            },
          };
        case "lambda get-function-configuration":
          return configuration();
        case "lambda get-function":
          return {
            Configuration: configuration(),
            Code: {
              Location: "https://owned.s3.ap-northeast-1.amazonaws.com/private-fixture",
            },
          };
        case "lambda get-function-concurrency":
          return reserved === undefined
            ? {}
            : { ReservedConcurrentExecutions: reserved };
        case "lambda put-function-concurrency":
          reserved = Number(args.at(-1));
          revision = `revision${String(++revisionCounter)}`;
          duringMutation();
          return { ReservedConcurrentExecutions: reserved };
        case "lambda delete-function-concurrency":
          reserved = undefined;
          revision = `revision${String(++revisionCounter)}`;
          duringMutation();
          return {};
        default:
          throw new TypeError("Unexpected fixture command.");
      }
    },
    cdk: (args) => {
      return Promise.resolve().then(() => {
        cdkCalls.push(args);
      });
    },
    zip: () => {
      duringDownload();
      return Promise.resolve(zip);
    },
    probe: () => Promise.resolve(reserved === 0),
    invoke: () =>
      Promise.resolve({
        complete: true,
        phase: "verification",
        checkpoint: null,
        rows: 0,
        learners: 0,
      }),
  };
  const options = {
    root: directory,
    assembly: path.join(directory, "assembly"),
    sha: release.sha,
    roleArn: "arn:aws:iam::123456789012:role/instant-composition-dev-deploy",
    policy: storagePolicy(
      parseJson(readFileSync(path.join(root, "storage-release-policy.json"), "utf8")),
    ),
    planned: [{ logicalId, capacity: null, timeout: 25, release }],
    current: () => Promise.resolve(true),
  };
  const port = (deadline?: number) =>
    awsStorageTransition(
      { ...options, ...(deadline === undefined ? {} : { deadline }) },
      commands,
    );
  return {
    port,
    commands,
    downloadBytes: () => Buffer.from(zip),
    options,
    calls,
    cdkCalls,
    bootstrap,
    configuration,
    onMutation: (action: () => void) => {
      duringMutation = action;
    },
    onDownload: (action: () => void) => {
      duringDownload = action;
    },
    limit: (value: number) => {
      accountLimit = value;
    },
    reserve: (value: number | undefined) => {
      reserved = value;
    },
    extras: (values: Record<string, unknown>) => {
      configExtras = values;
    },
    mutate: (values: {
      handler?: string;
      state?: string;
      update?: string;
      stackStatus?: string;
      revision?: string;
      account?: string;
      zip?: Buffer;
    }) => {
      handler = values.handler ?? handler;
      state = values.state ?? state;
      update = values.update ?? update;
      stackStatus = values.stackStatus ?? stackStatus;
      revision = values.revision ?? revision;
      account = values.account ?? account;
      zip = values.zip ?? zip;
    },
  };
}

describe("storage transition AWS command boundary", () => {
  it.each([
    ["unchanged", undefined],
    ["changed", "download-race"],
  ])(
    "revalidates a %s writer across a real retried ZIP download",
    async (_label, revision) => {
      vi.useFakeTimers();
      try {
        const test = fixture();
        const request = vi
          .fn<typeof fetch>()
          .mockRejectedValueOnce(
            Object.assign(new TypeError("private-signed-url"), {
              cause: { code: "ECONNRESET" },
            }),
          )
          .mockImplementationOnce(() => {
            test.mutate(revision === undefined ? {} : { revision });
            return Promise.resolve(new Response(new Uint8Array(test.downloadBytes())));
          });
        vi.stubGlobal("fetch", request);
        const port = awsStorageTransition(test.options, {
          ...test.commands,
          zip: deployedStorageZip,
        });
        await port.extendAccess(await port.discover());
        const [writer] = await port.discover();
        if (writer === undefined) throw new Error("Writer required.");
        const result = port.verify(writer).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(100);
        expect(await result).toEqual(
          revision === undefined
            ? writer
            : expect.objectContaining({
                code: "ERR_STORAGE_TRANSITION",
                part: "download revision race",
              }),
        );
        expect(request).toHaveBeenCalledTimes(2);
        expect(
          test.calls.some((args) => args[1] === "delete-function-concurrency"),
        ).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("refuses an initial drain that cannot fit and keeps expired admission closed while cleanup can still pause", async () => {
    let now = 1000000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const test = fixture(),
      port = test.port(now + 1000);
    expect(() => port.assertWorkTime(900000)).toThrow("transition work deadline");
    await port.extendAccess(await port.discover());
    const writer = (await port.discover())[0];
    if (!writer) throw new Error("Writer required.");
    now += 1000;
    await expect(port.restore(writer)).rejects.toThrow("transition work deadline");
    await expect(port.deploy()).rejects.toThrow("transition work deadline");
    expect(test.calls.some((args) => args[1] === "delete-function-concurrency")).toBe(
      false,
    );
    port.beginCleanup();
    const receipt = await port.pause(writer);
    expect(await port.isPaused(receipt)).toBe(true);
    await expect(port.restore(receipt)).rejects.toThrow("transition work deadline");
    now += 6 * 60000;
    await expect(port.pause(receipt)).rejects.toThrow("transition work deadline");
    await expect(port.drain(900000)).rejects.toThrow("cleanup drain deadline");
  });
  it.each([
    [1000, null, 0, true],
    [1000, 1, 0, true],
    [10, null, 0, true],
    [10, 1, 0, false],
    [101, 1, undefined, true],
    [101, 2, undefined, false],
  ])(
    "with account limit %i, a planned reservation of %s over a current %s fits: %s",
    async (limit, capacity, current, fits) => {
      const { port, limit: setLimit, reserve, options } = fixture();
      setLimit(limit);
      reserve(current);
      const owned = port();
      const writers = await owned.discover();
      expect(
        await owned.capacityAvailable(
          writers.map((writer) => ({ ...writer, capacity })),
        ),
      ).toBe(fits);
      expect(options.planned).toHaveLength(1);
    },
  );
  it("completes the actual AWS adapter transition when its own concurrency calls change revisions", async () => {
    const test = fixture(),
      port = test.port();
    port.wait = () => Promise.resolve();
    await expect(transitionStorageWriters(port)).resolves.toBeUndefined();
    const checkpoint = readFileSync(
      path.join(test.options.root, "dist/storage-transition.json"),
      "utf8",
    );
    expect(checkpoint).toContain('"phase":"resumed"');
    expect(checkpoint).toContain('"revision":"revision3"');
    expect(checkpoint).not.toContain("fixture-secret");
    expect(checkpoint).not.toContain("private-fixture-location");
  });
  it("rejects a pre-restore revision race before opening admission but still closes on pause", async () => {
    const test = fixture(),
      port = test.port();
    await port.extendAccess(await port.discover());
    const writer = (await port.discover())[0];
    if (writer === undefined) throw new TypeError("Writer required.");
    test.mutate({ revision: "external-revision" });
    await expect(port.restore(writer)).rejects.toThrow("capacity admission identity");
    expect(test.calls.some((args) => args[1] === "delete-function-concurrency")).toBe(
      false,
    );
    await expect(port.pause(writer)).rejects.toThrow("capacity configuration race");
    expect(test.calls.some((args) => args[1] === "put-function-concurrency")).toBe(
      true,
    );
    expect(await port.isPaused(writer)).toBe(true);
  });
  it.each([
    { Role: "different-role" },
    { MemorySize: 256 },
    { Runtime: "changed-runtime" },
    { Environment: { Variables: { API_SECRET: "private-fixture-value" } } },
    { Layers: [{ Arn: "second" }, { Arn: "first" }] },
    { NewServiceField: "changed" },
  ])(
    "refuses semantic configuration drift during capacity restoration: %j",
    async (change) => {
      const test = fixture(),
        port = test.port();
      await port.extendAccess(await port.discover());
      const writer = (await port.discover())[0];
      if (writer === undefined) throw new TypeError("Writer required.");
      test.onMutation(() => test.extras(change));
      await expect(port.restore(writer)).rejects.toThrow("capacity configuration race");
    },
  );
  it("rejects a revision changed while downloading the certified ZIP", async () => {
    const test = fixture(),
      port = test.port();
    await port.extendAccess(await port.discover());
    const writer = (await port.discover())[0];
    if (writer === undefined) throw new TypeError("Writer required.");
    test.onDownload(() => test.mutate({ revision: "download-race" }));
    await expect(port.verify(writer)).rejects.toThrow("download revision race");
    expect(await port.certifyPredecessor(writer)).toBeUndefined();
  });
  it("self-updates exact owned ARN access through bootstrap roles before direct Lambda calls", async () => {
    const test = fixture(),
      port = test.port(),
      first = await port.discover();
    expect(first[0]?.revision).toBe("");
    await port.extendAccess(first);
    const [writer] = await port.discover();
    if (writer === undefined) throw new TypeError("Writer required.");
    expect(writer.revision).toBe("revision1");
    const pausedWriter = await port.pause(writer);
    expect(await port.isPaused(writer)).toBe(true);
    expect(await port.probePaused(writer)).toBe(true);
    await port.wait(0);
    expect(await port.current()).toBe(true);
    await port.deploy();
    expect(await port.stable()).toBe(true);
    expect(await port.verify(pausedWriter)).toEqual(pausedWriter);
    expect(await port.certifyPredecessor(pausedWriter)).toEqual(pausedWriter);
    const restored = await port.restore(pausedWriter);
    expect(await port.isPaused(writer)).toBe(false);
    await port.restore({ ...restored, capacity: 1 });
    await port.record({ phase: "fixture-certified", writers: [writer] });
    expect(
      readFileSync(
        path.join(test.options.root, "dist/storage-transition.json"),
        "utf8",
      ),
    ).toContain("fixture-certified");
    expect(test.cdkCalls[0]).toContain(
      `storage-writer-arns=${JSON.stringify([writer.arn])}`,
    );
    expect(test.cdkCalls[1]).toContain("deploy-access");
    expect(test.cdkCalls[2]).toContain(test.options.assembly);
    const ownedIndex = test.calls.findIndex((args) => args[0] === "cloudformation");
    expect(test.bootstrap[ownedIndex]).toBe(true);
    expect(test.calls.some((args) => args.includes("update-function-code"))).toBe(
      false,
    );
  });
  it("refuses a different AWS account before any access-stack update", () => {
    const test = fixture();
    test.mutate({ account: "999999999999" });
    expect(() => test.port()).toThrow(StorageTransitionError);
    expect(test.cdkCalls).toHaveLength(0);
  });
  it.each([{ state: "Pending" }, { update: "InProgress" }])(
    "refuses unsettled Lambda state %j",
    async (change) => {
      const test = fixture(),
        port = test.port(),
        rows = await port.discover();
      await port.extendAccess(rows);
      test.mutate(change);
      await expect(port.discover()).rejects.toBeInstanceOf(StorageTransitionError);
    },
  );
  it("cannot certify a ZIP whose actual handler bypasses the guard", async () => {
    const test = fixture(),
      port = test.port(),
      rows = await port.discover();
    await port.extendAccess(rows);
    const writer = (await port.discover())[0];
    if (writer === undefined) throw new TypeError("Writer required.");
    test.mutate({ handler: "index.handler" });
    await expect(port.verify(writer)).rejects.toBeInstanceOf(StorageTransitionError);
    expect(await port.certifyPredecessor(writer)).toBeUndefined();
  });
  it("keeps failed rollback or an unguarded predecessor uncertified", async () => {
    const test = fixture(),
      port = test.port(),
      rows = await port.discover();
    await port.extendAccess(rows);
    const writer = (await port.discover())[0];
    if (writer === undefined) throw new TypeError("Writer required.");
    test.mutate({
      stackStatus: "UPDATE_ROLLBACK_FAILED",
      zip: storedZip({ "index.mjs": Buffer.from("old API") }),
    });
    expect(await port.stable()).toBe(false);
    expect(await port.certifyPredecessor(writer)).toBeUndefined();
    await expect(port.verify(writer)).rejects.toBeInstanceOf(StorageTransitionError);
  });
});

describe("complete configuration fingerprint", () => {
  it("excludes only top-level revision metadata and canonicalizes object order", () => {
    const first = {
      RevisionId: "r1",
      LastModified: "t1",
      Environment: { Variables: { B: "b", A: "a" } },
      Layers: ["one", "two"],
    };
    const reordered = {
      Layers: ["one", "two"],
      Environment: { Variables: { A: "a", B: "b" } },
      LastModified: "t2",
      RevisionId: "r2",
    };
    expect(storageConfigurationHash(first)).toBe(storageConfigurationHash(reordered));
    expect(storageConfigurationHash({ ...first, Layers: ["two", "one"] })).not.toBe(
      storageConfigurationHash(first),
    );
    expect(storageConfigurationHash({ Nested: { RevisionId: "r1" } })).not.toBe(
      storageConfigurationHash({ Nested: { RevisionId: "r2" } }),
    );
    expect(storageConfigurationHash({ Unknown: null })).not.toBe(
      storageConfigurationHash({}),
    );
  });
  it.each([undefined, null, [], { MemorySize: NaN }, { Nested: undefined }])(
    "refuses non-JSON configuration %j",
    (value) => {
      expect(() => storageConfigurationHash(value)).toThrow(StorageTransitionError);
    },
  );
});
