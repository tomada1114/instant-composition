import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { parseJson, readKey, readString } from "./json.mjs";
import { createStorageValidator } from "./storage-validator.mjs";

/** @typedef {"ERR_STORAGE_BACKUP_ARGUMENTS" | "ERR_STORAGE_BACKUP_FAILED" | "ERR_STORAGE_BACKUP_MISMATCH" | "ERR_STORAGE_BACKUP_SHAPE" | "ERR_STORAGE_BACKUP_TIMEOUT"} BackupCode */
export class StorageBackupError extends Error {
  /** @param {BackupCode} code */
  constructor(code) {
    super(
      `${code}: Storage backup operation refused. Expected: explicit dev access, available backup and matching runtime-valid tables. Next: inspect access and backup status; keep writers paused and preserve the backup until verification succeeds.`,
    );
    this.name = "StorageBackupError";
    this.code = code;
  }
}
/** @typedef {{command: "create" | "restore" | "verify", table: string, profile?: string, endpoint?: string, backup?: string, restored?: string}} BackupOptions */
/** @param {string[]} args @returns {BackupOptions} */
export function backupOptions(args) {
  const [command, ...rest] = args;
  /** @type {Map<string,string>} */
  const pairs = new Map();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i],
      value = rest[i + 1];
    if (
      !key ||
      !["--table", "--profile", "--endpoint", "--backup", "--restored"].includes(key) ||
      pairs.has(key) ||
      !value ||
      value.startsWith("--")
    )
      throw new StorageBackupError("ERR_STORAGE_BACKUP_ARGUMENTS");
    pairs.set(key, value);
  }
  const table = pairs.get("--table"),
    profile = pairs.get("--profile"),
    endpoint = pairs.get("--endpoint"),
    backup = pairs.get("--backup"),
    restored = pairs.get("--restored");
  if (
    !["create", "restore", "verify"].includes(command ?? "") ||
    typeof table !== "string" ||
    !/^[A-Za-z0-9_.-]{3,200}$/.test(table) ||
    table.includes("-restore-") ||
    /(?:^|[-_.])prod(?:[-_.]|$)/i.test(table) ||
    (profile !== undefined && !/^[A-Za-z0-9_-]+$/.test(profile)) ||
    (endpoint === undefined &&
      (profile === undefined || !table.startsWith("instant-composition-dev-"))) ||
    (endpoint !== undefined &&
      !/^http:\/\/(?:127\.0\.0\.1|localhost):(?:[1-9][0-9]{0,4})\/?$/.test(endpoint))
  )
    throw new StorageBackupError("ERR_STORAGE_BACKUP_ARGUMENTS");
  if (endpoint !== undefined && Number(/:([0-9]+)\/?$/.exec(endpoint)?.[1]) > 65535)
    throw new StorageBackupError("ERR_STORAGE_BACKUP_ARGUMENTS");
  if (
    (command === "restore") !== (backup !== undefined) ||
    (command === "verify") !== (restored !== undefined) ||
    (backup !== undefined && !backupArnMatches(table, backup)) ||
    (restored !== undefined && !isRestoreTable(table, restored))
  )
    throw new StorageBackupError("ERR_STORAGE_BACKUP_ARGUMENTS");
  if (command !== "create" && command !== "restore" && command !== "verify")
    throw new StorageBackupError("ERR_STORAGE_BACKUP_ARGUMENTS");
  return {
    command,
    table,
    ...(profile === undefined ? {} : { profile }),
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(backup === undefined ? {} : { backup }),
    ...(restored === undefined ? {} : { restored }),
  };
}
/** @param {string} table @param {string} arn @returns {boolean} */
function backupArnMatches(table, arn) {
  const match =
    /^arn:aws:dynamodb:ap-northeast-1:[0-9]{12}:table\/([A-Za-z0-9_.-]+)\/backup\/[A-Za-z0-9-]+$/.exec(
      arn,
    );
  return match?.[1] === table;
}
/** @param {string} source @param {string} restored @returns {boolean} */
export function isRestoreTable(source, restored) {
  const suffix = restored.slice(source.length);
  if (!restored.startsWith(source) || !/^-restore-\d{8}T\d{9}Z$/.test(suffix))
    return false;
  const stamp = suffix.slice(9);
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}.${stamp.slice(15, 18)}Z`;
  return (
    Number.isFinite(Date.parse(iso)) &&
    new Date(iso).toISOString().replace(/[-:.]/g, "") === stamp
  );
}
/** @param {unknown} value @returns {string} */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      // Locale collation can equate distinct stored Unicode keys.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
/** Decode only DynamoDB's document scalar/container types; runtime validation remains authoritative.
 * @param {unknown} attribute @returns {unknown}
 */
function documentValue(attribute) {
  if (
    typeof attribute !== "object" ||
    attribute === null ||
    Object.keys(attribute).length !== 1
  )
    throw new StorageBackupError("ERR_STORAGE_BACKUP_SHAPE");
  const s = readKey(attribute, "S"),
    n = readKey(attribute, "N"),
    b = readKey(attribute, "BOOL"),
    l = readKey(attribute, "L"),
    m = readKey(attribute, "M");
  if (typeof s === "string") return s;
  if (typeof n === "string" && Number.isFinite(Number(n))) return Number(n);
  if (typeof b === "boolean") return b;
  if (readKey(attribute, "NULL") === true) return null;
  if (Array.isArray(l)) return l.map(documentValue);
  if (typeof m === "object" && m !== null && !Array.isArray(m))
    return Object.fromEntries(
      Object.entries(m).map(([key, value]) => [key, documentValue(value)]),
    );
  throw new StorageBackupError("ERR_STORAGE_BACKUP_SHAPE");
}
/** @typedef {{call: (operation: string, input: Record<string,unknown>) => Promise<unknown>, validate: (rows: unknown[]) => Promise<unknown>, wait: () => Promise<void>, now: () => Date, close: () => Promise<void>}} BackupPort */
/** @param {BackupOptions} options @returns {BackupPort} */
export function backupPort(options) {
  const validator = createStorageValidator(options.profile, Date.now() + 60 * 60000);
  return {
    call(operation, input) {
      try {
        return Promise.resolve(
          parseJson(
            execFileSync(
              "aws",
              [
                "dynamodb",
                operation,
                "--cli-input-json",
                "file:///dev/stdin",
                "--no-paginate",
                "--region",
                "ap-northeast-1",
                "--output",
                "json",
                ...(options.profile === undefined
                  ? []
                  : ["--profile", options.profile]),
                ...(options.endpoint === undefined
                  ? []
                  : ["--endpoint-url", options.endpoint]),
              ],
              {
                input: JSON.stringify(input),
                encoding: "utf8",
                stdio: ["pipe", "pipe", "pipe"],
                timeout: 60000,
                maxBuffer: 8 * 1024 * 1024,
                killSignal: "SIGKILL",
                env: {
                  ...process.env,
                  AWS_PAGER: "",
                  AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true",
                  AWS_EC2_METADATA_DISABLED: "true",
                  ...(options.endpoint === undefined
                    ? {}
                    : {
                        AWS_ACCESS_KEY_ID: "local",
                        AWS_SECRET_ACCESS_KEY: "local",
                        AWS_SESSION_TOKEN: "",
                      }),
                },
              },
            ),
          ),
        );
      } catch {
        throw new StorageBackupError("ERR_STORAGE_BACKUP_FAILED");
      }
    },
    validate: (rows) => validator.request(rows),
    wait: () => setTimeout(5000),
    now: () => new Date(),
    close: () => validator.close(),
  };
}
/** @param {BackupPort} port @param {string} operation @param {Record<string,unknown>} input @param {(answer:unknown) => boolean} ready @returns {Promise<unknown>} */
async function waitFor(port, operation, input, ready) {
  for (let attempt = 0; attempt < 360; attempt++) {
    const answer = await port.call(operation, input);
    if (ready(answer)) return answer;
    await port.wait();
  }
  throw new StorageBackupError("ERR_STORAGE_BACKUP_TIMEOUT");
}
/** @param {BackupPort} port @param {string} table @returns {Promise<{count:number, families:Record<string,number>, digest:string}>} */
async function summarize(port, table) {
  /** @type {string[]} */ const hashes = [];
  /** @type {Record<string,number>} */ const families = {};
  /** @type {unknown} */ let cursor;
  const cursors = new Set();
  do {
    const page = await port.call("scan", {
      TableName: table,
      ConsistentRead: true,
      Limit: 100,
      ...(cursor === undefined ? {} : { ExclusiveStartKey: cursor }),
    });
    const items = readKey(page, "Items");
    if (!Array.isArray(items)) throw new StorageBackupError("ERR_STORAGE_BACKUP_SHAPE");
    const rows = items.map((/** @type {unknown} */ raw) => documentValue({ M: raw }));
    const decoded = readKey(await port.validate(rows), "rows");
    if (!Array.isArray(decoded) || decoded.length !== rows.length)
      throw new StorageBackupError("ERR_STORAGE_BACKUP_SHAPE");
    for (const row of decoded) {
      const family = readString(row, "type");
      if (!family || !/^[A-Za-z][A-Za-z0-9]*$/.test(family))
        throw new StorageBackupError("ERR_STORAGE_BACKUP_SHAPE");
      families[family] = (families[family] ?? 0) + 1;
    }
    for (const raw of items)
      hashes.push(createHash("sha256").update(canonical(raw)).digest("hex"));
    cursor = readKey(page, "LastEvaluatedKey");
    if (cursor !== undefined) {
      if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor))
        throw new StorageBackupError("ERR_STORAGE_BACKUP_SHAPE");
      if (Object.keys(cursor).length === 0) cursor = undefined;
      else if (
        Object.keys(cursor).length !== 2 ||
        !readString(readKey(cursor, "PK"), "S") ||
        !readString(readKey(cursor, "SK"), "S")
      )
        throw new StorageBackupError("ERR_STORAGE_BACKUP_SHAPE");
    }
    if (cursor !== undefined) {
      const token = canonical(cursor);
      if (cursors.has(token)) throw new StorageBackupError("ERR_STORAGE_BACKUP_SHAPE");
      cursors.add(token);
    }
  } while (cursor !== undefined);
  return {
    count: hashes.length,
    families,
    digest: createHash("sha256").update(hashes.sort().join("\n")).digest("hex"),
  };
}
/** @param {BackupOptions} options @param {BackupPort} port @returns {Promise<unknown>} */
export async function runBackup(options, port) {
  try {
    if (options.command === "create") {
      const created = await port.call("create-backup", {
        TableName: options.table,
        BackupName: `${options.table}-backup-${port.now().toISOString().replace(/[-:.]/g, "")}`,
      });
      const arn = readString(readKey(created, "BackupDetails"), "BackupArn");
      if (!arn || !backupArnMatches(options.table, arn))
        throw new StorageBackupError("ERR_STORAGE_BACKUP_SHAPE");
      const available = await waitFor(
        port,
        "describe-backup",
        { BackupArn: arn },
        (answer) =>
          readString(
            readKey(readKey(answer, "BackupDescription"), "BackupDetails"),
            "BackupStatus",
          ) === "AVAILABLE",
      );
      const time = readKey(
        readKey(readKey(available, "BackupDescription"), "BackupDetails"),
        "BackupCreationDateTime",
      );
      const milliseconds =
        typeof time === "number"
          ? time * 1000
          : typeof time === "string"
            ? Date.parse(time)
            : NaN;
      if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8640000000000000)
        throw new StorageBackupError("ERR_STORAGE_BACKUP_SHAPE");
      return { backupArn: arn, createdAt: new Date(milliseconds).toISOString() };
    }
    if (options.command === "restore") {
      const description = await waitFor(
        port,
        "describe-backup",
        { BackupArn: options.backup },
        (answer) =>
          readString(
            readKey(readKey(answer, "BackupDescription"), "BackupDetails"),
            "BackupStatus",
          ) === "AVAILABLE",
      );
      if (
        readString(
          readKey(readKey(description, "BackupDescription"), "SourceTableDetails"),
          "TableName",
        ) !== options.table
      )
        throw new StorageBackupError("ERR_STORAGE_BACKUP_SHAPE");
      const restored = `${options.table}-restore-${port.now().toISOString().replace(/[-:.]/g, "")}`;
      if (!isRestoreTable(options.table, restored))
        throw new StorageBackupError("ERR_STORAGE_BACKUP_SHAPE");
      await port.call("restore-table-from-backup", {
        BackupArn: options.backup,
        TargetTableName: restored,
      });
      await waitFor(
        port,
        "describe-table",
        { TableName: restored },
        (answer) => readString(readKey(answer, "Table"), "TableStatus") === "ACTIVE",
      );
      return { restoredTable: restored };
    }
    const source = await summarize(port, options.table),
      restored = await summarize(port, options.restored ?? "");
    if (canonical(source) !== canonical(restored))
      throw new StorageBackupError("ERR_STORAGE_BACKUP_MISMATCH");
    return { verified: true, ...source };
  } catch (error) {
    if (error instanceof StorageBackupError) throw error;
    throw new StorageBackupError("ERR_STORAGE_BACKUP_FAILED");
  } finally {
    await port.close();
  }
}
