import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  symlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  decodeStorageRecord,
  encodeStorageValue,
  STORAGE_SCHEMA_VERSION,
} from "@instant-composition/adapters";
import {
  assertStorageCompatibility,
  assertStorageArtifact,
  certifyStorageFixtures,
  preflightStorageRelease,
  storagePolicy,
  storageReleaseMetadata,
  StorageCompatibilityError,
} from "../scripts/lib/storage-compatibility.mjs";
import { main } from "../scripts/storage-release.mjs";
import { parseJson, readKey } from "../scripts/lib/json.mjs";

const root = path.resolve(import.meta.dirname, "..");
const policy = () =>
  storagePolicy(
    parseJson(readFileSync(path.join(root, "storage-release-policy.json"), "utf8")),
  );
const temporary: string[] = [];
afterEach(() => {
  for (const folder of temporary.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

describe("storage release and rollback preflight", () => {
  it("certifies the guarded writer's fixtures and runtime implementation before deployment", () => {
    expect(preflightStorageRelease(root).current).toBe(policy().current);
    const metadata = storageReleaseMetadata(root);
    expect(metadata.contract).toBe(policy().current);
    expect(() =>
      assertStorageArtifact(policy(), { sha: "fixture-assembly", storage: metadata }),
    ).not.toThrow();
  });
  it("allows an older guarded release only while its fixtures certify lossless reads and writes", () => {
    const current = policy();
    const release = current.releases[0];
    if (release === undefined) throw new TypeError("Release required.");
    const compatible = {
      ...current,
      releases: [...current.releases, { ...release, id: "previous-guarded-fixture" }],
    };
    expect(() =>
      assertStorageCompatibility(compatible, "previous-guarded-fixture"),
    ).not.toThrow();
    expect(() =>
      assertStorageArtifact(compatible, {
        storage: {
          contract: "previous-guarded-fixture",
          schemaFingerprint: release.schemaFingerprint,
        },
      }),
    ).not.toThrow();
  });
  it.each(["preguard-45892b3", "unknown-old-api", "unreviewed-future-writer"])(
    "refuses %s before data writes or AWS credentials",
    async (candidate) => {
      await expect(main([candidate], root)).rejects.toBeInstanceOf(
        StorageCompatibilityError,
      );
    },
  );
  it("rejects an old writer that can read a new schema but deletes a field on its next write", () => {
    const current = policy();
    const release = current.releases[0];
    if (release === undefined) throw new TypeError("Release required.");
    const unsafe = {
      ...current,
      emittedSchemas: [...current.emittedSchemas, STORAGE_SCHEMA_VERSION + 1],
      releases: [{ ...release, reads: [...release.reads, STORAGE_SCHEMA_VERSION + 1] }],
    };
    expect(() => assertStorageCompatibility(unsafe, current.current)).toThrow(
      StorageCompatibilityError,
    );
  });
  it("detects a field-dropping old writer by executing its subsequent write fixture", async () => {
    const data = parseJson(
      readFileSync(path.join(root, "tests/fixtures/storage-v1.json"), "utf8"),
    );
    const fixtures = readKey(data, "fixtures");
    await expect(
      certifyStorageFixtures(
        fixtures,
        (row) => {
          return Promise.resolve().then(() => {
            const decoded = decodeStorageRecord(row);
            const value = encodeStorageValue(decoded.type, decoded.value);
            if (
              readKey(row, "type") === "item" &&
              typeof value === "object" &&
              value !== null
            ) {
              const oldKnownFields = Object.fromEntries(
                Object.entries(value).filter(([key]) => key !== "revision"),
              );
              return { schemaVersion: 1, value: oldKnownFields };
            }
            return { schemaVersion: 1, value };
          });
        },
        1,
      ),
    ).rejects.toBeInstanceOf(StorageCompatibilityError);
  });
  it("rejects an observed future schema even if the candidate is named in the ledger", () => {
    expect(() => assertStorageCompatibility(policy(), policy().current, [9])).toThrow(
      StorageCompatibilityError,
    );
  });
  it("certifies the declared writer schema and rejects an emitter that still writes one", async () => {
    const fixture = { row: { version: 1 }, expected: { retained: "supported" } };
    await expect(
      certifyStorageFixtures(
        [fixture],
        () => Promise.resolve({ schemaVersion: 2, value: fixture.expected }),
        2,
      ),
    ).resolves.toBeUndefined();
    await expect(
      certifyStorageFixtures(
        [fixture],
        () => Promise.resolve({ schemaVersion: 1, value: fixture.expected }),
        2,
      ),
    ).rejects.toBeInstanceOf(StorageCompatibilityError);
  });
  it("executes archived rows against the current decoder and rejects a falsely declared future emitter", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "storage-declared-emitter-"));
    temporary.push(folder);
    const current = policy();
    for (const file of current.runtimeFiles) {
      mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
      copyFileSync(path.join(root, file), path.join(folder, file));
    }
    const release = current.releases[0];
    if (release === undefined) throw new TypeError("A writer release is required.");
    const old = parseJson(readFileSync(path.join(root, release.fixture), "utf8"));
    if (typeof old !== "object" || old === null)
      throw new TypeError("Fixtures required.");
    const future = STORAGE_SCHEMA_VERSION + 1;
    const contract = "storage-unreviewed-future";
    const bytes = JSON.stringify({ ...old, contract, schemaVersion: future });
    current.current = contract;
    current.emittedSchemas = [...current.emittedSchemas, future];
    Object.assign(release, {
      id: contract,
      writes: future,
      reads: [...release.reads, future],
      preserves: [...release.preserves, future],
      fixture: "tests/fixtures/storage-unreviewed-future.json",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    mkdirSync(path.join(folder, "tests/fixtures"), { recursive: true });
    writeFileSync(path.join(folder, release.fixture), bytes);
    writeFileSync(
      path.join(folder, "storage-release-policy.json"),
      JSON.stringify(current),
    );
    await expect(main(["current"], folder)).rejects.toBeInstanceOf(
      StorageCompatibilityError,
    );
  });
  it.each([
    { sha: "preguard" },
    { storage: { contract: "storage-v1", schemaFingerprint: "uncertified" } },
  ])("refuses a rollback artifact without certified writer evidence %j", (artifact) => {
    expect(() => assertStorageArtifact(policy(), artifact)).toThrow(
      StorageCompatibilityError,
    );
  });
  it("cannot bless modified compatibility fixtures by retaining a stale ledger", () => {
    const folder = mkdtempSync(path.join(tmpdir(), "storage-release-"));
    temporary.push(folder);
    const current = policy();
    writeFileSync(
      path.join(folder, "storage-release-policy.json"),
      JSON.stringify(current),
    );
    mkdirSync(path.join(folder, "tests/fixtures"), { recursive: true });
    writeFileSync(
      path.join(folder, current.releases[0]?.fixture ?? "missing"),
      "tampered fixture",
    );
    expect(() => preflightStorageRelease(folder)).toThrow(StorageCompatibilityError);
  });
  it.each([
    "unlisted source",
    "omitted entry",
    "missing file",
    "duplicate entry",
    "same-byte symlink",
  ])("requires the complete actual runtime inventory: %s", (mutation) => {
    const folder = mkdtempSync(path.join(tmpdir(), "storage-runtime-inventory-"));
    temporary.push(folder);
    const current = policy();
    for (const file of [
      ...current.runtimeFiles,
      current.releases[0]?.fixture ?? "missing",
    ]) {
      mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
      copyFileSync(path.join(root, file), path.join(folder, file));
    }
    if (mutation === "unlisted source") {
      mkdirSync(path.join(folder, "packages/adapters/src/new-runtime"));
      writeFileSync(
        path.join(folder, "packages/adapters/src/new-runtime/writer.ts"),
        "export const writer = 1;\n",
      );
    }
    if (mutation === "omitted entry")
      current.runtimeFiles = current.runtimeFiles.filter(
        (file) => file !== "packages/adapters/src/declared.ts",
      );
    if (mutation === "duplicate entry")
      current.runtimeFiles.push("packages/adapters/src/declared.ts");
    const hash = createHash("sha256");
    for (const file of [...current.runtimeFiles].sort())
      hash
        .update(file)
        .update("\0")
        .update(readFileSync(path.join(folder, file)))
        .update("\0");
    const digest = hash.digest("hex");
    for (const release of current.releases) release.schemaFingerprint = digest;
    if (mutation === "missing file") rmSync(path.join(folder, "apps/api/src/index.ts"));
    if (mutation === "same-byte symlink") {
      copyFileSync(
        path.join(folder, "apps/api/src/index.ts"),
        path.join(folder, "preserved-input.ts"),
      );
      rmSync(path.join(folder, "apps/api/src/index.ts"));
      symlinkSync(
        path.join(folder, "preserved-input.ts"),
        path.join(folder, "apps/api/src/index.ts"),
      );
    }
    writeFileSync(
      path.join(folder, "storage-release-policy.json"),
      JSON.stringify(current),
    );
    expect(() => preflightStorageRelease(folder)).toThrow(StorageCompatibilityError);
  });
  it("CLI rejects an unguarded release without loading an API or an AWS credential", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/storage-release.mjs", "preguard-45892b3"],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ERR_STORAGE_RELEASE_UNSAFE");
    expect(result.stdout).toBe("");
  });
  it("places storage preflight before the credentials action and every deploy", () => {
    const workflow = readFileSync(
      path.join(root, ".github/workflows/deploy-dev.yml"),
      "utf8",
    );
    const guard = workflow.indexOf("node scripts/storage-release.mjs current");
    expect(guard).toBeGreaterThan(0);
    expect(
      workflow.indexOf("node scripts/storage-transition.mjs budget 45"),
    ).toBeGreaterThan(workflow.indexOf("node-version-file: .node-version"));
    expect(guard).toBeLessThan(
      workflow.indexOf("aws-actions/configure-aws-credentials"),
    );
    for (const command of [
      'node scripts/storage-transition.mjs stack "$RELEASE_ASSEMBLY" "$RELEASE_SHA" foundation',
      'node scripts/storage-transition.mjs stack "$RELEASE_ASSEMBLY" "$RELEASE_SHA" edge',
      'node scripts/storage-transition.mjs deploy "$RELEASE_ASSEMBLY"',
    ]) {
      expect(workflow.indexOf(command)).toBeGreaterThan(guard);
    }
  });
});

it("refuses the archived v1 binary before it can discard cap2 round adoption state", async () => {
  const current = policy();
  const previous = current.releases.find((release) => release.id === "storage-v1");
  if (previous === undefined) throw new TypeError("Archived v1 certificate required.");
  expect(previous.reads).toStrictEqual([0, 1]);
  expect(previous.preserves).toStrictEqual([0, 1]);
  expect(() =>
    assertStorageArtifact(current, {
      storage: { contract: previous.id, schemaFingerprint: previous.schemaFingerprint },
    }),
  ).toThrow(StorageCompatibilityError);
  await expect(main([previous.id], root)).rejects.toBeInstanceOf(
    StorageCompatibilityError,
  );
});

it("refuses the archived v2 binary before it can discard cap3 model claims", async () => {
  const current = policy();
  const previous = current.releases.find((release) => release.id === "storage-v2");
  if (previous === undefined) throw new TypeError("Archived v2 certificate required.");
  expect(previous.reads).toStrictEqual([0, 1, 2]);
  expect(previous.preserves).toStrictEqual([0, 1, 2]);
  expect(previous.schemaFingerprint).toBe(
    "38bc539f80947b14fe2167ed3b8f8c12863ab96e76c0a965195b2dedbe3b87fe",
  );
  expect(() =>
    assertStorageArtifact(current, {
      storage: { contract: previous.id, schemaFingerprint: previous.schemaFingerprint },
    }),
  ).toThrow(StorageCompatibilityError);
  await expect(main([previous.id], root)).rejects.toBeInstanceOf(
    StorageCompatibilityError,
  );
});
