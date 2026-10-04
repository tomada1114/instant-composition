import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
    account = "123456789012";
  const logicalId = "ApiFunctionABC123",
    physical = `instant-composition-dev-app-${logicalId}-owned`,
    arn = `arn:aws:lambda:ap-northeast-1:123456789012:function:${physical}`;
  const calls: string[][] = [];
  const cdkCalls: string[][] = [];
  const bootstrap: boolean[] = [];
  const configuration = () => ({
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
          return { Stacks: [{ StackStatus: stackStatus }] };
        case "lambda get-function-configuration":
          return configuration();
        case "lambda get-function":
          return {
            Configuration: configuration(),
            Code: { Location: "private-fixture-location" },
          };
        case "lambda get-function-concurrency":
          return reserved === undefined
            ? {}
            : { ReservedConcurrentExecutions: reserved };
        case "lambda put-function-concurrency":
          reserved = Number(args.at(-1));
          return { ReservedConcurrentExecutions: reserved };
        case "lambda delete-function-concurrency":
          reserved = undefined;
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
    zip: () => Promise.resolve(zip),
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
  const port = () => awsStorageTransition(options, commands);
  return {
    port,
    options,
    calls,
    cdkCalls,
    bootstrap,
    configuration,
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
  it("self-updates exact owned ARN access through bootstrap roles before direct Lambda calls", async () => {
    const test = fixture(),
      port = test.port(),
      first = await port.discover();
    expect(first[0]?.revision).toBe("");
    await port.extendAccess(first);
    const [writer] = await port.discover();
    if (writer === undefined) throw new TypeError("Writer required.");
    expect(writer.revision).toBe("revision1");
    await port.pause(writer);
    expect(await port.isPaused(writer)).toBe(true);
    expect(await port.probePaused(writer)).toBe(true);
    await port.wait(0);
    expect(await port.current()).toBe(true);
    await port.deploy();
    expect(await port.stable()).toBe(true);
    expect(await port.verify(writer)).toEqual(writer);
    expect(await port.certifyPredecessor(writer)).toBe(true);
    await port.restore(writer);
    expect(await port.isPaused(writer)).toBe(false);
    await port.restore({ ...writer, capacity: 1 });
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
    expect(await port.certifyPredecessor(writer)).toBe(false);
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
    expect(await port.certifyPredecessor(writer)).toBe(false);
    await expect(port.verify(writer)).rejects.toBeInstanceOf(StorageTransitionError);
  });
});
