import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { parseJson, readKey, readString } from "./json.mjs";
import { StorageTransitionError } from "./storage-runtime.mjs";
import { sameStorageWriter } from "./storage-configuration.mjs";

/** The actual job start includes setup. Reserve barriers, maximum drain and final overhead.
 * @param {string} root @param {number} minutes @param {number} [now]
 * @param {number} [startedAt] @returns {void}
 */
export function recordStorageJobBudget(
  root,
  minutes,
  now = Date.now(),
  startedAt = now,
) {
  const deadline = startedAt + (minutes - 21) * 60000;
  if (
    !Number.isSafeInteger(minutes) ||
    minutes <= 21 ||
    minutes > 45 ||
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(startedAt) ||
    startedAt < 0 ||
    startedAt > now ||
    deadline <= now
  )
    throw new StorageTransitionError("deployment job budget");
  mkdirSync(path.join(root, "dist"), { recursive: true });
  writeFileSync(
    path.join(root, "dist/storage-job.json"),
    JSON.stringify({ startedAt, deadline }),
    { mode: 0o600 },
  );
}
/** @param {string} root @param {number} [now] @returns {number} */
export function storageJobDeadline(root, now = Date.now()) {
  const value = parseJson(
    readFileSync(path.join(root, "dist/storage-job.json"), "utf8"),
  );
  const startedAt = readKey(value, "startedAt"),
    deadline = readKey(value, "deadline");
  if (
    typeof startedAt !== "number" ||
    !Number.isSafeInteger(startedAt) ||
    startedAt > now ||
    typeof deadline !== "number" ||
    !Number.isSafeInteger(deadline) ||
    deadline <= now ||
    deadline - startedAt > 24 * 60000 ||
    deadline <= startedAt
  )
    throw new StorageTransitionError("deployment job budget");
  return deadline;
}

/** @typedef {{complete:boolean,phase:'discovery'|'preparation'|'verification',checkpoint:string|null,rows:number,learners:number}} BootstrapAnswer */
/** @param {unknown} value @returns {BootstrapAnswer} */
export function storageBootstrapAnswer(value) {
  const complete = readKey(value, "complete"),
    phase = readString(value, "phase"),
    checkpoint = readKey(value, "checkpoint"),
    rows = readKey(value, "rows"),
    learners = readKey(value, "learners");
  if (
    typeof value !== "object" ||
    value === null ||
    Object.keys(value).sort().join(",") !== "checkpoint,complete,learners,phase,rows" ||
    typeof complete !== "boolean" ||
    (phase !== "discovery" && phase !== "preparation" && phase !== "verification") ||
    (checkpoint !== null &&
      (typeof checkpoint !== "string" || checkpoint.length > 8192)) ||
    typeof rows !== "number" ||
    !Number.isSafeInteger(rows) ||
    rows < 0 ||
    typeof learners !== "number" ||
    !Number.isSafeInteger(learners) ||
    learners < 0 ||
    (complete
      ? phase !== "verification" || checkpoint !== null
      : typeof checkpoint !== "string" || checkpoint.length === 0)
  )
    throw new StorageTransitionError("bootstrap completion evidence");
  return { complete, phase, checkpoint, rows, learners };
}
/** Job summaries omit the resumable private checkpoint.
 * @param {string} root @returns {{sha:string,codeHash:string,complete:boolean,phase:string,rows:number,learners:number}|null}
 */
export function storageBootstrapEvidence(root) {
  const file = path.join(root, "dist/storage-bootstrap.json");
  if (!existsSync(file)) return null;
  const value = parseJson(readFileSync(file, "utf8"));
  const sha = readString(value, "sha"),
    codeHash = readString(value, "codeHash");
  if (sha === undefined || codeHash === undefined)
    throw new StorageTransitionError("bootstrap checkpoint identity");
  const { complete, phase, rows, learners } = storageBootstrapAnswer(
    readKey(value, "result"),
  );
  return { sha, codeHash, complete, phase, rows, learners };
}
/** Only certified worker code is admitted while the API remains paused. No table IAM is needed.
 * A fresh job's null checkpoint resumes the certified worker's durable state.
 * @param {{root:string,sha:string,writer:import('./storage-transition.mjs').Writer,port:import('./storage-transition.mjs').TransitionPort,invoke:(checkpoint:string|null)=>Promise<unknown>,maxSteps?:number,deadline?:number,now?:()=>number}} options @returns {Promise<import('./storage-transition.mjs').Writer>}
 */
export async function prepareStorageReadModels(options) {
  const { root, sha, writer, port, invoke } = options;
  if (writer.timeout < 1 || writer.timeout > 60 || writer.capacity !== 1)
    throw new StorageTransitionError("bootstrap worker configuration");
  const file = path.join(root, "dist/storage-bootstrap.json"),
    clock = options.now ?? Date.now,
    deadline = options.deadline ?? Infinity;
  /** @type {string|null} */
  let checkpoint = null;
  if (existsSync(file)) {
    const previous = parseJson(readFileSync(file, "utf8"));
    if (
      readString(previous, "sha") !== sha ||
      readString(previous, "codeHash") !== writer.codeHash
    )
      throw new StorageTransitionError("bootstrap checkpoint identity");
    checkpoint = storageBootstrapAnswer(readKey(previous, "result")).checkpoint;
  }
  const before = await port.verify(writer);
  if (!sameStorageWriter(before, writer) || !(await port.current()))
    throw new StorageTransitionError("bootstrap admission identity");
  let receipt = writer;
  async function closeAdmission() {
    const paused = await port.pause(receipt);
    if (!(await port.isPaused(paused)) || !(await port.probePaused(paused)))
      throw new StorageTransitionError("bootstrap admission barrier");
    await port.wait(writer.timeout * 1000);
    const checked = await port.verify(paused);
    if (!sameStorageWriter(paused, checked))
      throw new StorageTransitionError("bootstrap close identity");
    return checked;
  }
  async function preparePages() {
    receipt = await port.restore(writer);
    if (
      !sameStorageWriter(writer, receipt, false) ||
      !sameStorageWriter(receipt, await port.verify(receipt))
    )
      throw new StorageTransitionError("bootstrap capacity identity");
    for (
      let steps = 0;
      steps < (options.maxSteps ?? Infinity) &&
      clock() + (writer.timeout + 5) * 1000 < deadline;
      steps++
    ) {
      const result = storageBootstrapAnswer(await invoke(checkpoint));
      writeFileSync(
        `${file}.next`,
        JSON.stringify({ sha, codeHash: writer.codeHash, result }),
        { mode: 0o600 },
      );
      renameSync(`${file}.next`, file);
      checkpoint = result.checkpoint;
      if (result.complete) return;
    }
    throw new StorageTransitionError("bootstrap bounded budget");
  }
  try {
    await preparePages();
  } finally {
    receipt = await closeAdmission();
  }
  return receipt;
}
