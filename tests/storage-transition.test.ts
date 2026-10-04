import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareStorageReadModels,
  storageBootstrapAnswer,
  storageBootstrapEvidence,
  recordStorageJobBudget,
  storageJobDeadline,
} from "../scripts/lib/storage-bootstrap.mjs";
import { storageAssembly } from "../scripts/lib/storage-assembly.mjs";
import { storagePolicy } from "../scripts/lib/storage-compatibility.mjs";
import { storedZip } from "./storage-zip-fixture";
import { bundleStorageGuard } from "../scripts/storage-bundle.mjs";
import {
  guardMetadata,
  storageDigest,
  storageHandler,
  storageHashes,
  StorageTransitionError,
} from "../scripts/lib/storage-runtime.mjs";
import { storageZipFiles, verifyStorageZip } from "../scripts/lib/storage-zip.mjs";
import {
  transitionStorageWriters,
  type Writer,
  type TransitionPort,
} from "../scripts/lib/storage-transition.mjs";
import {
  ownedStorageWriters,
  storageDeployIdentity,
} from "../scripts/lib/storage-aws.mjs";
import { parseJson } from "../scripts/lib/json.mjs";
import { releaseHandler } from "../scripts/lib/release-runtime.mjs";
import {
  verifyTransitionAssembly,
  currentStorageMain,
} from "../scripts/storage-transition.mjs";

const api: Writer = {
  logicalId: "ApiFunctionABC123",
  arn: "arn:aws:lambda:ap-northeast-1:123456789012:function:instant-composition-dev-app-ApiFunctionABC123-owned",
  capacity: null,
  timeout: 900,
  revision: "old",
  codeHash: "old",
  configurationHash: "configuration",
};
function fixture() {
  let writers = [{ ...api }];
  let cleanupChecks = 0;
  const calls: string[] = [],
    paused = new Set<string>();
  const port: TransitionPort = {
    assertWorkTime: () => undefined,
    beginCleanup: () => undefined,
    drain: (ms) => port.wait(ms),
    cleanupTimeAvailable: () => ++cleanupChecks <= 3,
    discover: () => Promise.resolve(writers.map((writer) => ({ ...writer }))),
    capacityMatches: (writer) => Promise.resolve(!paused.has(writer.arn)),
    extendAccess: (rows) => {
      return Promise.resolve().then(() => {
        calls.push(`access:${String(rows.length)}`);
      });
    },
    pause: (writer) => {
      return Promise.resolve().then(() => {
        calls.push("pause");
        paused.add(writer.arn);
        return { ...writer };
      });
    },
    isPaused: (writer) => Promise.resolve(paused.has(writer.arn)),
    probePaused: () => Promise.resolve(true),
    wait: (ms) => {
      return Promise.resolve().then(() => {
        calls.push(`wait:${String(ms)}`);
      });
    },
    deploy: () => {
      return Promise.resolve().then(() => {
        calls.push("deploy");
        writers = [
          { ...api, revision: "new", codeHash: "new" },
          {
            ...api,
            logicalId: "ReadModelWorkerDEF456",
            arn: "worker",
            capacity: 1,
            timeout: 60,
            revision: "new",
            codeHash: "new",
          },
        ];
        paused.add("worker");
      });
    },
    verify: (writer) => {
      return Promise.resolve().then(() => {
        calls.push("verify");
        return { ...writer };
      });
    },
    current: () => Promise.resolve(true),
    restore: (writer) => {
      return Promise.resolve().then(() => {
        calls.push(`resume:${String(writer.capacity)}`);
        paused.delete(writer.arn);
        return { ...writer };
      });
    },
    certifyPredecessor: () => Promise.resolve(undefined),
    stable: () => Promise.resolve(true),
    prepare: (rows) => {
      return Promise.resolve().then(() => {
        calls.push("prerequisite");
        return rows;
      });
    },
    record: (state) => {
      return Promise.resolve().then(() => {
        calls.push(JSON.stringify(state));
      });
    },
  };
  return { port, calls, paused };
}
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

describe("storage deployment admission", () => {
  it("refuses a drain that cannot fit before changing any writer admission", async () => {
    const { port, calls, paused } = fixture();
    port.assertWorkTime = (required = 0) => {
      if (required > 60000)
        throw new StorageTransitionError("transition work deadline");
    };
    const cleanup = vi.fn();
    port.beginCleanup = cleanup;
    await expect(transitionStorageWriters(port)).rejects.toMatchObject({
      part: "transition work deadline",
    });
    expect(calls).not.toContain("pause");
    expect(calls).not.toContain("deploy");
    expect(paused.size).toBe(0);
    expect(cleanup).not.toHaveBeenCalled();
  });
  it("refuses deployment when the initial drain exhausts work, then closes and drains without reopening", async () => {
    const { port, calls, paused } = fixture();
    let expired = false;
    port.assertWorkTime = () => {
      if (expired) throw new StorageTransitionError("transition work deadline");
    };
    const wait = port.wait;
    port.wait = async (ms) => {
      await wait(ms);
      expired = true;
    };
    const drain = vi.fn(async (ms: number) => {
      await wait(ms);
    });
    port.drain = drain;
    const cleanup = vi.fn();
    port.beginCleanup = cleanup;
    await expect(transitionStorageWriters(port)).rejects.toMatchObject({
      part: "transition work deadline",
    });
    expect(calls).not.toContain("deploy");
    expect(calls.some((call) => call.startsWith("resume:"))).toBe(false);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(drain).toHaveBeenCalledExactlyOnceWith(900000);
    expect(paused.has(api.arn)).toBe(true);
    expect(JSON.parse(calls.at(-1) ?? "{}")).toMatchObject({
      phase: "paused-forward-fix",
      admissionClosed: true,
    });
  });
  it("does not begin certification or resume after deployment reaches the work deadline", async () => {
    const { port, calls, paused } = fixture();
    let expired = false;
    port.assertWorkTime = () => {
      if (expired) throw new StorageTransitionError("transition work deadline");
    };
    const deploy = port.deploy;
    port.deploy = async () => {
      await deploy();
      expired = true;
    };
    await expect(transitionStorageWriters(port)).rejects.toMatchObject({
      part: "transition work deadline",
    });
    expect(calls).not.toContain("verify");
    expect(calls.some((call) => call.startsWith("resume:"))).toBe(false);
    expect(paused.size).toBe(2);
  });
  it.each([
    [new StorageTransitionError("installed file"), "installed file"],
    [new Error("private-provider-response-with-signed-url"), "unexpected failure"],
  ])(
    "retains a safe failure stage without exposing dependency content: %s",
    async (failure, stage) => {
      const { port, paused } = fixture();
      const records: unknown[] = [];
      port.verify = () => Promise.reject(failure);
      port.record = (state) => {
        records.push(state);
        return Promise.resolve();
      };
      await expect(transitionStorageWriters(port)).rejects.toBe(failure);
      expect(records.at(-1)).toMatchObject({
        phase: "paused-forward-fix",
        failure: stage,
      });
      expect(JSON.stringify(records)).not.toContain(
        "private-provider-response-with-signed-url",
      );
      expect(paused.size).toBe(2);
    },
  );
  it("accepts only the revision receipt from its own capacity restoration", async () => {
    const { port, paused } = fixture();
    const revisions = new Map<string, string>();
    const restore = port.restore;
    const discover = port.discover;
    port.discover = async () =>
      (await discover()).map((writer) => ({
        ...writer,
        revision: revisions.get(writer.arn) ?? writer.revision,
      }));
    port.restore = async (writer) => {
      await restore(writer);
      const revision = `${writer.revision}-capacity`;
      revisions.set(writer.arn, revision);
      return { ...writer, revision };
    };
    port.verify = (writer) =>
      Promise.resolve({
        ...writer,
        revision: revisions.get(writer.arn) ?? writer.revision,
      });
    await expect(transitionStorageWriters(port)).resolves.toBeUndefined();
    expect(paused.size).toBe(0);
  });
  it("repauses every writer when a revision changes after its restoration receipt", async () => {
    const { port, paused } = fixture();
    const restored = new Set<string>();
    const restore = port.restore;
    port.restore = async (writer) => {
      const receipt = await restore(writer);
      restored.add(writer.arn);
      return receipt;
    };
    port.verify = (writer) =>
      Promise.resolve({
        ...writer,
        revision: restored.has(writer.arn) ? "external-race" : writer.revision,
      });
    await expect(transitionStorageWriters(port)).rejects.toThrow("code revision race");
    expect(paused.size).toBe(2);
  });
  it("does not lose an earlier resumed writer's race when restoring the next writer", async () => {
    const { port, paused } = fixture();
    let restores = 0;
    const restore = port.restore;
    port.restore = async (writer) => {
      restores++;
      return restore(writer);
    };
    port.verify = (writer) =>
      Promise.resolve({
        ...writer,
        revision:
          restores === 2 && writer.arn === api.arn ? "later-race" : writer.revision,
      });
    await expect(transitionStorageWriters(port)).rejects.toThrow("code revision race");
    expect(paused.size).toBe(2);
  });
  it("attempts remaining writers after a cleanup pause fails and preserves the original error", async () => {
    const { port, paused } = fixture();
    const failure = new Error("original certification failure");
    port.verify = () => Promise.reject(failure);
    const pause = port.pause;
    let calls = 0;
    port.pause = async (writer) => {
      const receipt = await pause(writer);
      if (++calls === 2) throw new Error("first cleanup pause failed");
      return receipt;
    };
    await expect(transitionStorageWriters(port)).rejects.toBe(failure);
    expect(calls).toBe(5);
    expect(paused.size).toBe(2);
  });
  it("re-closes a writer whose cleanup pause was followed by reopened admission", async () => {
    const { port, paused, calls } = fixture();
    const failure = new Error("original certification failure");
    port.verify = () => Promise.reject(failure);
    const pause = port.pause;
    let pauses = 0;
    port.pause = async (writer) => {
      const receipt = await pause(writer);
      if (++pauses === 2) paused.delete(writer.arn);
      return receipt;
    };
    await expect(transitionStorageWriters(port)).rejects.toBe(failure);
    expect(pauses).toBe(5);
    expect(paused.size).toBe(2);
    expect(calls.filter((call) => call === "pause")).toHaveLength(5);
  });
  it("retries a cleanup probe that still admits traffic before starting the drain", async () => {
    const { port, calls, paused } = fixture();
    const failure = new Error("original certification failure");
    port.verify = () => Promise.reject(failure);
    let probes = 0;
    port.probePaused = () => Promise.resolve(++probes !== 4);
    await expect(transitionStorageWriters(port)).rejects.toBe(failure);
    expect(calls.filter((call) => call === "pause")).toHaveLength(6);
    expect(calls.lastIndexOf("pause")).toBeLessThan(
      calls.indexOf("wait:900000", calls.indexOf("deploy")),
    );
    expect(paused.size).toBe(2);
  });
  it("rechecks an earlier closed writer after closing the remaining writer", async () => {
    const { port, paused } = fixture();
    const failure = new Error("original certification failure");
    port.verify = () => Promise.reject(failure);
    const pause = port.pause;
    let pauses = 0;
    port.pause = async (writer) => {
      const receipt = await pause(writer);
      if (++pauses === 3) paused.delete(api.arn);
      return receipt;
    };
    await expect(transitionStorageWriters(port)).rejects.toBe(failure);
    expect(pauses).toBe(5);
    expect(paused.size).toBe(2);
  });
  it("records an unconfirmed barrier at the closing deadline without claiming drain or recovery", async () => {
    const { port, calls } = fixture();
    const failure = new Error("original certification failure");
    const records: unknown[] = [];
    let cleanup = false;
    port.verify = () => {
      cleanup = true;
      return Promise.reject(failure);
    };
    port.probePaused = () => Promise.resolve(!cleanup);
    port.record = (state) => {
      records.push(state);
      return Promise.resolve();
    };
    await expect(transitionStorageWriters(port)).rejects.toBe(failure);
    expect(records.at(-1)).toMatchObject({
      phase: "paused-forward-fix",
      cleanupVerified: false,
      admissionClosed: false,
    });
    expect(calls.slice(calls.indexOf("deploy") + 1)).not.toContain("wait:900000");
    expect(calls.some((call) => call.startsWith("resume:"))).toBe(false);
  });
  it("refuses an API revision change in worker preparation", async () => {
    const { port, paused, calls } = fixture();
    port.prepare = (writers) =>
      Promise.resolve(
        writers.map((writer) => ({
          ...writer,
          revision: writer.arn === api.arn ? "unrelated-api-change" : "worker-receipt",
        })),
      );
    await expect(transitionStorageWriters(port)).rejects.toThrow(
      "prepared writer identity",
    );
    expect(calls.some((call) => call.startsWith("resume:"))).toBe(false);
    expect(paused.size).toBe(2);
  });
  it("keeps the API paused through code update and creates its worker paused before certifying both", async () => {
    const { port, calls, paused } = fixture();
    await transitionStorageWriters(port);
    expect(calls.indexOf("wait:900000")).toBeLessThan(calls.indexOf("deploy"));
    expect(calls.indexOf("deploy")).toBeLessThan(calls.indexOf("resume:null"));
    expect(calls.indexOf("verify")).toBeLessThan(calls.indexOf("resume:null"));
    expect(calls).toContain("access:2");
    expect(calls).toContain("resume:1");
    expect(paused.size).toBe(0);
  });
  it("refuses a barrier that still admits a synchronous invocation", async () => {
    const { port, calls, paused } = fixture();
    port.probePaused = () => Promise.resolve(false);
    await expect(transitionStorageWriters(port)).rejects.toBeInstanceOf(
      StorageTransitionError,
    );
    expect(calls).not.toContain("deploy");
    expect(paused.has(api.arn)).toBe(true);
  });
  it("keeps a failed preguard predecessor paused", async () => {
    const { port, paused } = fixture();
    port.deploy = () => {
      return Promise.resolve().then(() => {
        throw new Error("failed deployment");
      });
    };
    await expect(transitionStorageWriters(port)).rejects.toThrow("failed deployment");
    expect(paused.has(api.arn)).toBe(true);
  });
  it("reports recovery without claiming restored writers remain paused", async () => {
    const { port, paused } = fixture();
    const failure = new StorageTransitionError("deployment");
    const records: unknown[] = [];
    port.deploy = () => Promise.reject(failure);
    port.certifyPredecessor = (writer) => Promise.resolve({ ...writer });
    port.record = (state) => {
      records.push(state);
      return Promise.resolve();
    };
    await expect(transitionStorageWriters(port)).rejects.toBe(failure);
    expect(paused.size).toBe(0);
    expect(records.at(-1)).toMatchObject({
      phase: "recovered-certified-predecessor",
      failure: "deployment",
      admissionClosed: false,
    });
  });
  it("uses cleanup and restore receipts when certifying an unchanged predecessor", async () => {
    const { port, paused } = fixture();
    let currentWriter = { ...api };
    let revision = 0;
    const failure = new StorageTransitionError("deployment");
    const records: unknown[] = [];
    port.discover = () => Promise.resolve([{ ...currentWriter }]);
    port.deploy = () => Promise.reject(failure);
    const pause = port.pause,
      restore = port.restore;
    port.pause = async (writer) => {
      await pause(writer);
      currentWriter = { ...writer, revision: `paused-${String(++revision)}` };
      return { ...currentWriter };
    };
    port.restore = async (writer) => {
      expect(writer).toEqual(currentWriter);
      await restore(writer);
      currentWriter = { ...writer, revision: "recovery-restored" };
      return { ...currentWriter };
    };
    port.certifyPredecessor = () => Promise.resolve({ ...currentWriter });
    port.record = (state) => {
      records.push(state);
      return Promise.resolve();
    };
    await expect(transitionStorageWriters(port)).rejects.toBe(failure);
    expect(paused.size).toBe(0);
    expect(records.at(-1)).toMatchObject({
      phase: "recovered-certified-predecessor",
      writers: [{ revision: "recovery-restored" }],
    });
  });
  it("repauses a recovered predecessor if its post-restore certificate raced", async () => {
    const { port, paused } = fixture();
    const failure = new StorageTransitionError("deployment");
    let restored = false;
    port.deploy = () => Promise.reject(failure);
    const restore = port.restore;
    port.restore = async (writer) => {
      restored = true;
      return restore(writer);
    };
    port.certifyPredecessor = (writer) =>
      Promise.resolve({
        ...writer,
        revision: restored ? "recovery-race" : writer.revision,
      });
    await expect(transitionStorageWriters(port)).rejects.toBe(failure);
    expect(paused.has(api.arn)).toBe(true);
  });
  it("includes newly owned writers in cleanup even when configuration discovery fails", async () => {
    const { port, paused } = fixture();
    const failure = new StorageTransitionError("writer update status");
    let deployed = false;
    const discover = port.discover,
      deploy = port.deploy;
    port.deploy = async () => {
      await deploy();
      deployed = true;
    };
    port.owned = () => discover();
    port.discover = () => (deployed ? Promise.reject(failure) : discover());
    await expect(transitionStorageWriters(port)).rejects.toBe(failure);
    expect(paused.size).toBe(2);
  });
  it("leaves both writers paused after a partial rollout even when the old API was certified", async () => {
    const { port, paused } = fixture();
    port.verify = () => {
      return Promise.resolve().then(() => {
        throw new Error("code mismatch");
      });
    };
    port.certifyPredecessor = (writer) => Promise.resolve({ ...writer });
    await expect(transitionStorageWriters(port)).rejects.toThrow("code mismatch");
    expect(paused.size).toBe(2);
  });
  it.each([false, true])(
    "refuses changed main before resuming (%s)",
    async (afterDeploy) => {
      const { port, calls, paused } = fixture();
      let checks = 0;
      port.current = () => Promise.resolve(++checks < (afterDeploy ? 2 : 1));
      await expect(transitionStorageWriters(port)).rejects.toBeInstanceOf(
        StorageTransitionError,
      );
      expect(calls.some((call) => call.startsWith("resume:"))).toBe(false);
      expect(paused.size).toBe(afterDeploy ? 2 : 1);
    },
  );
  it("detects a code revision race immediately before capacity restoration", async () => {
    const { port, calls, paused } = fixture();
    let checks = 0;
    port.verify = (writer) =>
      Promise.resolve({
        ...writer,
        revision: ++checks > 2 ? "raced" : "new",
      });
    await expect(transitionStorageWriters(port)).rejects.toBeInstanceOf(
      StorageTransitionError,
    );
    expect(calls).not.toContain("resume:null");
    expect(paused.size).toBe(2);
  });
  it("refuses to resume while CloudFormation can still change configurations", async () => {
    const { port, paused } = fixture();
    port.stable = () => Promise.resolve(false);
    await expect(transitionStorageWriters(port)).rejects.toBeInstanceOf(
      StorageTransitionError,
    );
    expect(paused.size).toBe(2);
  });
  it("binds direct permissions to exact owned physical resources and the existing deploy role", () => {
    expect(
      storageDeployIdentity(
        "arn:aws:iam::123456789012:role/instant-composition-dev-deploy",
      ),
    ).toEqual({ account: "123456789012" });
    expect(() => storageDeployIdentity("arn:aws:iam::123456789012:role/admin")).toThrow(
      StorageTransitionError,
    );
    const planned = [
      {
        logicalId: api.logicalId,
        capacity: null,
        timeout: 25,
        release: {
          sha: "a".repeat(40),
          storage: { contract: "storage-v1", schemaFingerprint: "b".repeat(64) },
          files: { "index.mjs": "c".repeat(64), "storage.mjs": "d".repeat(64) },
        },
      },
    ];
    const resource = {
      ResourceType: "AWS::Lambda::Function",
      LogicalResourceId: api.logicalId,
      PhysicalResourceId: api.arn.split(":").at(-1),
    };
    expect(
      ownedStorageWriters(
        { StackResourceSummaries: [resource] },
        "123456789012",
        planned,
      )[0]?.arn,
    ).toBe(api.arn);
    expect(() =>
      ownedStorageWriters(
        {
          StackResourceSummaries: [
            { ...resource, PhysicalResourceId: "someone-elses-function" },
          ],
        },
        "123456789012",
        planned,
      ),
    ).toThrow(StorageTransitionError);
  });
  it("certifies the exact fetched ZIP and all packaged guard bytes without invoking learner code", async () => {
    const output = mkdtempSync(path.join(tmpdir(), "storage-guard-"));
    folders.push(output);
    writeFileSync(
      path.join(output, "index.mjs"),
      "export async function handler() { return 'fixture'; }\n",
    );
    bundleStorageGuard(path.resolve(import.meta.dirname, ".."), output);
    const metadataBytes = readFileSync(path.join(output, "storage-release.json")),
      release = guardMetadata(parseJson(metadataBytes.toString("utf8")));
    const files = Object.fromEntries(
      Object.keys(release.files).map((name) => [
        name,
        readFileSync(path.join(output, name)),
      ]),
    );
    files["storage-release.json"] = metadataBytes;
    const zip = storedZip(files),
      hash = Buffer.from(storageDigest(zip), "hex").toString("base64");
    expect(() => verifyStorageZip(zip, hash, release)).not.toThrow();
    expect(() => verifyStorageZip(zip, "wrong", release)).toThrow(
      StorageTransitionError,
    );
    expect(() => storageZipFiles(storedZip({ "../escape": Buffer.from("x") }))).toThrow(
      StorageTransitionError,
    );
    expect(() =>
      storageZipFiles(storedZip({ "unrecorded/": Buffer.alloc(0) })),
    ).toThrow(StorageTransitionError);
    const next = vi.fn(() => Promise.resolve("learner-route"));
    const guarded = storageHandler(output, next);
    expect(await guarded({ storageReleaseProbe: true })).toEqual(release);
    expect(next).not.toHaveBeenCalled();
    expect(await guarded({})).toBe("learner-route");
    expect(next).toHaveBeenLastCalledWith(
      {},
      { storageRelease: { sha: release.sha, ...release.storage } },
    );
    writeFileSync(path.join(output, "__proto__"), "unrecorded metadata-name file");
    expect(() => storageHandler(output, next)).toThrow(StorageTransitionError);
    unlinkSync(path.join(output, "__proto__"));
    writeFileSync(path.join(output, "index.mjs"), "tampered");
    expect(() => storageHandler(output, next)).toThrow(StorageTransitionError);
  });
  it("composes the exact outer release inventory with the guard and rejects additions, symlinks and outer drift", async () => {
    const output = mkdtempSync(path.join(tmpdir(), "storage-outer-"));
    folders.push(output);
    writeFileSync(
      path.join(output, "index.mjs"),
      "export async function handler() { return 'fixture'; }\n",
    );
    writeFileSync(
      path.join(output, "release.mjs"),
      "export { handler } from './index.mjs';\n",
    );
    writeFileSync(
      path.join(output, "release.json"),
      JSON.stringify({ sha: "stale", files: {} }),
    );
    bundleStorageGuard(path.resolve(import.meta.dirname, ".."), output);
    const release = guardMetadata(
      parseJson(readFileSync(path.join(output, "storage-release.json"), "utf8")),
    );
    expect(release.files).not.toHaveProperty("release.json");
    const inventory = storageHashes(output);
    delete inventory["release.json"];
    const outer = { sha: release.sha, files: inventory };
    writeFileSync(path.join(output, "release.json"), JSON.stringify(outer));
    const next = vi.fn(() => Promise.resolve("learner-route"));
    expect(await storageHandler(output, next)({ storageReleaseProbe: true })).toEqual(
      release,
    );
    expect(next).not.toHaveBeenCalled();
    const zipFiles = Object.fromEntries(
      Object.keys(storageHashes(output)).map((name) => [
        name,
        readFileSync(path.join(output, name)),
      ]),
    );
    const zip = storedZip(zipFiles),
      hash = Buffer.from(storageDigest(zip), "hex").toString("base64");
    expect(() => verifyStorageZip(zip, hash, release)).not.toThrow();
    const linkedZip = Buffer.from(zip);
    const central = linkedZip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    linkedZip.writeUInt32LE((0xa000 << 16) >>> 0, central + 38);
    expect(() =>
      verifyStorageZip(
        linkedZip,
        Buffer.from(storageDigest(linkedZip), "hex").toString("base64"),
        release,
      ),
    ).toThrow(StorageTransitionError);
    writeFileSync(
      path.join(output, "release.json"),
      JSON.stringify({ ...outer, sha: "a".repeat(40) }),
    );
    expect(() => storageHandler(output, next)).toThrow(StorageTransitionError);
    const mismatched = storedZip({
      ...zipFiles,
      "release.json": Buffer.from(JSON.stringify({ ...outer, files: {} })),
    });
    expect(() =>
      verifyStorageZip(
        mismatched,
        Buffer.from(storageDigest(mismatched), "hex").toString("base64"),
        release,
      ),
    ).toThrow(StorageTransitionError);
    writeFileSync(path.join(output, "release.json"), JSON.stringify(outer));
    writeFileSync(path.join(output, "unexpected.mjs"), "unrecorded");
    expect(() => storageHandler(output, next)).toThrow(StorageTransitionError);
    unlinkSync(path.join(output, "unexpected.mjs"));
    symlinkSync("index.mjs", path.join(output, "linked.mjs"));
    expect(() => storageHandler(output, next)).toThrow(StorageTransitionError);
  });
});
it("carries the verified storage identity through the actual release wrapper and preserves Lambda context", async () => {
  const output = mkdtempSync(path.join(tmpdir(), "storage-context-"));
  folders.push(output);
  writeFileSync(
    path.join(output, "index.mjs"),
    "export async function handler() { return 'fixture'; }\n",
  );
  writeFileSync(
    path.join(output, "release.mjs"),
    "export { handler } from './index.mjs';\n",
  );
  bundleStorageGuard(path.resolve(import.meta.dirname, ".."), output);
  const release = guardMetadata(
    parseJson(readFileSync(path.join(output, "storage-release.json"), "utf8")),
  );
  writeFileSync(
    path.join(output, "release.json"),
    JSON.stringify({ sha: release.sha, files: storageHashes(output) }),
  );
  const next = vi.fn((_event: unknown, context?: unknown) => Promise.resolve(context));
  const wrapped = releaseHandler(output, next);
  const event = {
    rawPath: "/api/worker",
    requestContext: { http: { method: "POST" } },
    storageRelease: { sha: "untrusted event" },
  };
  const plain = await wrapped(event);
  expect(plain).toBeUndefined();
  expect(next).toHaveBeenLastCalledWith(event);
  const lambdaContext = {
    awsRequestId: "fixture-request",
    getRemainingTimeInMillis: () => 60000,
    storageRelease: { sha: "untrusted context" },
  };
  const context = await storageHandler(output, (input, supplied) =>
    wrapped(input as typeof event, supplied),
  )(event, lambdaContext);
  expect(context).toMatchObject({
    awsRequestId: "fixture-request",
    storageRelease: { sha: release.sha, ...release.storage },
  });
  expect(next).toHaveBeenLastCalledWith(event, {
    ...lambdaContext,
    storageRelease: { sha: release.sha, ...release.storage },
  });
  expect((context as typeof lambdaContext).getRemainingTimeInMillis()).toBe(60000);
  expect(lambdaContext.storageRelease.sha).toBe("untrusted context");
});

it("binds a paused assembly to its exact writer inventory before credentials", () => {
  const root = path.resolve(import.meta.dirname, ".."),
    assembly = mkdtempSync(path.join(tmpdir(), "storage-assembly-"));
  folders.push(assembly);
  const bundle = path.join(assembly, `asset.${"a".repeat(64)}`);
  mkdirSync(bundle);
  writeFileSync(path.join(bundle, "index.mjs"), "export async function handler() {}\n");
  bundleStorageGuard(root, bundle);
  const release = guardMetadata(
      parseJson(readFileSync(path.join(bundle, "storage-release.json"), "utf8")),
    ),
    policy = storagePolicy(
      parseJson(readFileSync(path.join(root, "storage-release-policy.json"), "utf8")),
    );
  const logicalId = "ApiFunctionABC123",
    resource = {
      Type: "AWS::Lambda::Function",
      Properties: {
        Handler: "storage.handler",
        ReservedConcurrentExecutions: 0,
        Timeout: 25,
      },
      Metadata: {
        "aws:asset:path": path.basename(bundle),
        "instant-composition:storage-capacity": "unreserved",
      },
    };
  writeFileSync(
    path.join(assembly, "manifest.json"),
    JSON.stringify({
      artifacts: {
        app: {
          type: "aws:cloudformation:stack",
          properties: {
            stackName: "instant-composition-dev-app",
            templateFile: "app.template.json",
          },
        },
      },
    }),
  );
  const template = (value: unknown) =>
    writeFileSync(
      path.join(assembly, "app.template.json"),
      JSON.stringify({ Resources: { [logicalId]: value } }),
    );
  template(resource);
  expect(storageAssembly(assembly, release.sha, policy)).toEqual([
    { logicalId, capacity: null, timeout: 25, release },
  ]);
  template({
    ...resource,
    Properties: { ...resource.Properties, ReservedConcurrentExecutions: 1 },
  });
  expect(() => storageAssembly(assembly, release.sha, policy)).toThrow(
    StorageTransitionError,
  );
  template(resource);
  writeFileSync(path.join(bundle, "index.mjs"), "tampered code");
  expect(() => storageAssembly(assembly, release.sha, policy)).toThrow(
    StorageTransitionError,
  );
});

it("prepares an introduced worker with API paused, then closes admission before ordinary resume", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "storage-bootstrap-"));
  folders.push(root);
  mkdirSync(path.join(root, "dist"));
  const { port, calls, paused } = fixture();
  paused.add(api.arn);
  const writer = {
    ...api,
    logicalId: "ReadModelWorkerDEF456",
    arn: "worker",
    capacity: 1,
    timeout: 60,
  };
  let steps = 0;
  await prepareStorageReadModels({
    root,
    sha: "a".repeat(40),
    writer,
    port,
    invoke: (checkpoint) => {
      return Promise.resolve().then(() => {
        expect(paused.has(api.arn)).toBe(true);
        expect(checkpoint).toBe(steps === 0 ? null : "bounded-cursor");
        return ++steps === 1
          ? {
              complete: false,
              phase: "preparation",
              checkpoint: "bounded-cursor",
              rows: 100,
              learners: 1,
            }
          : {
              complete: true,
              phase: "verification",
              checkpoint: null,
              rows: 10,
              learners: 1,
            };
      });
    },
  });
  expect(steps).toBe(2);
  expect(calls).toContain("resume:1");
  expect(calls).not.toContain("resume:null");
  expect(calls).toContain("wait:60000");
  expect(paused.has("worker")).toBe(true);
  expect(
    readFileSync(path.join(root, "dist/storage-bootstrap.json"), "utf8"),
  ).toContain('"complete":true');
  expect(storageBootstrapEvidence(root)).toMatchObject({
    complete: true,
    phase: "verification",
    rows: 10,
    learners: 1,
  });
  expect(storageBootstrapEvidence(root)).not.toHaveProperty("checkpoint");
});

it("persists a bounded bootstrap checkpoint and resumes after a stopped or unknown outcome", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "storage-bootstrap-"));
  folders.push(root);
  mkdirSync(path.join(root, "dist"));
  const { port, paused } = fixture(),
    writer = {
      ...api,
      logicalId: "ReadModelWorkerDEF456",
      arn: "worker",
      capacity: 1,
      timeout: 60,
    };
  await expect(
    prepareStorageReadModels({
      root,
      sha: "a".repeat(40),
      writer,
      port,
      maxSteps: 1,
      invoke: () =>
        Promise.resolve({
          complete: false,
          phase: "discovery",
          checkpoint: "next-page",
          rows: 100,
          learners: 3,
        }),
    }),
  ).rejects.toBeInstanceOf(StorageTransitionError);
  expect(paused.has("worker")).toBe(true);
  await expect(
    prepareStorageReadModels({
      root,
      sha: "a".repeat(40),
      writer,
      port,
      invoke: (checkpoint) => {
        return Promise.resolve().then(() => {
          expect(checkpoint).toBe("next-page");
          throw new Error("unknown invoke outcome");
        });
      },
    }),
  ).rejects.toThrow("unknown invoke outcome");
  expect(paused.has("worker")).toBe(true);
  await prepareStorageReadModels({
    root,
    sha: "a".repeat(40),
    writer,
    port,
    invoke: (checkpoint) => {
      return Promise.resolve().then(() => {
        expect(checkpoint).toBe("next-page");
        return {
          complete: true,
          phase: "verification",
          checkpoint: null,
          rows: 0,
          learners: 3,
        };
      });
    },
  });
});
it("subtracts setup time from work while reserving closing, maximum drain and final evidence", () => {
  const root = mkdtempSync(path.join(tmpdir(), "storage-job-setup-"));
  folders.push(root);
  const startedAt = 1000000;
  const afterSetup = startedAt + 8 * 60000;
  recordStorageJobBudget(root, 45, afterSetup, startedAt);
  const deadline = storageJobDeadline(root, afterSetup);
  expect(deadline - afterSetup).toBe(16 * 60000);
  expect(deadline + (5 + 15 + 1) * 60000).toBe(startedAt + 45 * 60000);
  expect(
    JSON.parse(readFileSync(path.join(root, "dist/storage-job.json"), "utf8")),
  ).toEqual({ startedAt, deadline });
});

it.each([24, 30, 45])("refuses exhausted work after %i minutes of setup", (setup) => {
  const root = mkdtempSync(path.join(tmpdir(), "storage-job-expired-"));
  folders.push(root);
  const startedAt = 1000000;
  expect(() =>
    recordStorageJobBudget(root, 45, startedAt + setup * 60000, startedAt),
  ).toThrow(StorageTransitionError);
  expect(() => readFileSync(path.join(root, "dist/storage-job.json"))).toThrow();
});

it("uses the existing job budget beyond three minutes and still closes worker admission at its deadline", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "storage-job-budget-"));
  folders.push(root);
  const startedAt = 1000000;
  recordStorageJobBudget(root, 45, startedAt);
  const deadline = storageJobDeadline(root, startedAt + 1000);
  expect(deadline).toBe(startedAt + 24 * 60000);
  expect(startedAt + 45 * 60000 - deadline).toBeGreaterThanOrEqual(21 * 60000);
  expect(() => storageJobDeadline(root, deadline)).toThrow(StorageTransitionError);
  const { port, paused } = fixture();
  const writer = {
    ...api,
    logicalId: "ReadModelWorkerDEF456",
    arn: "worker",
    capacity: 1,
    timeout: 60,
  };
  let elapsed = 0,
    pages = 0;
  await prepareStorageReadModels({
    root,
    sha: "a".repeat(40),
    writer,
    port,
    deadline,
    now: () => startedAt + elapsed++ * 60000,
    invoke: () =>
      Promise.resolve(
        ++pages === 5
          ? {
              complete: true,
              phase: "verification",
              checkpoint: null,
              rows: 0,
              learners: 100,
            }
          : {
              complete: false,
              phase: "discovery",
              checkpoint: `page-${String(pages)}`,
              rows: 100,
              learners: 0,
            },
      ),
  });
  expect(pages).toBe(5);
  expect(paused.has("worker")).toBe(true);
  await expect(
    prepareStorageReadModels({
      root,
      sha: "a".repeat(40),
      writer,
      port,
      deadline,
      now: () => deadline - 60000,
      invoke: () => {
        throw new Error("No request may cross the bounded invoke deadline.");
      },
    }),
  ).rejects.toThrow("bootstrap bounded budget");
  expect(paused.has("worker")).toBe(true);
});

it.each([false, true])(
  "returns the exact paused bootstrap receipt and closes admission after unknown invocation outcomes (%s)",
  async (failed) => {
    const root = mkdtempSync(path.join(tmpdir(), "storage-bootstrap-receipt-"));
    folders.push(root);
    mkdirSync(path.join(root, "dist"));
    const { port, paused, calls } = fixture();
    const worker = {
      ...api,
      logicalId: "ReadModelWorkerDEF456",
      arn: "worker",
      capacity: 1,
      timeout: 60,
    };
    let actual: Writer = { ...worker };
    const restore = port.restore,
      pause = port.pause;
    port.verify = () => Promise.resolve({ ...actual });
    port.restore = async (writer) => {
      await restore(writer);
      actual = { ...writer, revision: "worker-admitted" };
      return { ...actual };
    };
    port.pause = async (writer) => {
      expect(writer.revision).toBe("worker-admitted");
      await pause(writer);
      actual = { ...writer, revision: "worker-drained" };
      return { ...actual };
    };
    const failure = new Error("unknown invoke outcome");
    const result = prepareStorageReadModels({
      root,
      sha: "a".repeat(40),
      writer: worker,
      port,
      invoke: () =>
        failed
          ? Promise.reject(failure)
          : Promise.resolve({
              complete: true,
              phase: "verification",
              checkpoint: null,
              rows: 0,
              learners: 0,
            }),
    });
    if (failed) await expect(result).rejects.toBe(failure);
    else expect(await result).toEqual({ ...worker, revision: "worker-drained" });
    expect(paused.has("worker")).toBe(true);
    expect(calls).toContain("wait:60000");
  },
);

it("rejects unverified completion and prevents automatic predecessor recovery after preparation starts", async () => {
  expect(() =>
    storageBootstrapAnswer({
      complete: true,
      phase: "preparation",
      checkpoint: null,
      rows: 0,
      learners: 0,
    }),
  ).toThrow(StorageTransitionError);
  expect(() =>
    storageBootstrapAnswer({
      complete: false,
      phase: "discovery",
      checkpoint: null,
      rows: 0,
      learners: 0,
    }),
  ).toThrow(StorageTransitionError);
  const { port, paused, calls } = fixture();
  port.prepare = () => {
    return Promise.resolve().then(() => {
      throw new Error("read models not ready");
    });
  };
  port.certifyPredecessor = (writer) => Promise.resolve({ ...writer });
  await expect(transitionStorageWriters(port)).rejects.toThrow("read models not ready");
  expect(paused.size).toBe(2);
  expect(calls.some((call) => call.startsWith("resume:"))).toBe(false);
});
it("cannot recover an already guarded worker left paused by an earlier failed bootstrap", async () => {
  const { port, paused, calls } = fixture();
  const worker = {
    ...api,
    logicalId: "ReadModelWorkerDEF456",
    arn: "worker",
    capacity: 1,
    timeout: 60,
  };
  port.discover = () => Promise.resolve([{ ...api }, worker]);
  port.current = () => Promise.resolve(false);
  port.certifyPredecessor = (writer) => Promise.resolve({ ...writer });
  await expect(transitionStorageWriters(port)).rejects.toBeInstanceOf(
    StorageTransitionError,
  );
  expect(paused.size).toBe(2);
  expect(calls.some((call) => call.startsWith("resume:"))).toBe(false);
});
it("checks the full recorded immutable assembly before credentials and refuses added files or same-byte symlinks", () => {
  const root = mkdtempSync(path.join(tmpdir(), "storage-immutable-"));
  folders.push(root);
  const assembly = path.join(root, "assembly");
  mkdirSync(assembly);
  mkdirSync(path.join(root, "dist"));
  writeFileSync(path.join(assembly, "app.json"), "fixture assembly");
  const sha = "a".repeat(40);
  writeFileSync(
    path.join(root, "dist/release.json"),
    JSON.stringify({ sha, files: storageHashes(assembly) }),
  );
  expect(() => verifyTransitionAssembly(root, assembly, sha)).not.toThrow();
  expect(() => verifyTransitionAssembly(root, assembly, "b".repeat(40))).toThrow(
    StorageTransitionError,
  );
  writeFileSync(path.join(assembly, "unrecorded"), "same source");
  expect(() => verifyTransitionAssembly(root, assembly, sha)).toThrow(
    StorageTransitionError,
  );
  unlinkSync(path.join(assembly, "unrecorded"));
  writeFileSync(path.join(assembly, "__proto__"), "undeclared prototype-name input");
  expect(storageHashes(assembly)).toHaveProperty(
    "__proto__",
    storageDigest("undeclared prototype-name input"),
  );
  expect(() => verifyTransitionAssembly(root, assembly, sha)).toThrow(
    StorageTransitionError,
  );
  unlinkSync(path.join(assembly, "__proto__"));
  writeFileSync(path.join(root, "source"), "fixture assembly");
  unlinkSync(path.join(assembly, "app.json"));
  symlinkSync(path.join(root, "source"), path.join(assembly, "app.json"));
  expect(() => verifyTransitionAssembly(root, assembly, sha)).toThrow(
    StorageTransitionError,
  );
});
it("rechecks the trusted current main identity and refuses an untrusted repository before any request", async () => {
  vi.stubEnv("GITHUB_TOKEN", "fixture-token");
  const sha = "a".repeat(40),
    request = vi.fn(() => Promise.resolve(Response.json({ object: { sha } })));
  expect(await currentStorageMain("tomada1114/instant-composition", sha, request)).toBe(
    true,
  );
  expect(
    await currentStorageMain("tomada1114/instant-composition", "b".repeat(40), request),
  ).toBe(false);
  await expect(
    currentStorageMain("untrusted/repository", sha, request),
  ).rejects.toBeInstanceOf(StorageTransitionError);
  expect(request).toHaveBeenCalledTimes(2);
});

it("prints a safe failure stage and neutral recovery guidance on the CLI", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve(import.meta.dirname, "../scripts/storage-transition.mjs"),
      "--invalid",
    ],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(
    "ERR_STORAGE_TRANSITION: Admission refused at arguments.",
  );
  expect(result.stderr).toContain("inspect the recovery checkpoint");
  expect(result.stderr).toContain("writers may remain paused");
  expect(result.stderr).not.toContain("keep writers paused");
});
