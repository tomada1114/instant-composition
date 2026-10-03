// Lock acquisition/recovery is serialized separately from the potentially long write.
import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import process from "node:process";
import { parseJson, readKey, readString } from "../lib/json.mjs";
import { CardsError } from "./errors.mjs";

export const LOCK_FILE = ".cards.lock";
/** Age alone never proves that a writer is gone. */
export const STALE_LOCK_MS = 10 * 60 * 1000;
/** @typedef {{ pid: number, host: string, token: string }} Owner */
/** @typedef {import("node:fs").Stats} Identity */
/** @typedef {{ owner: Owner | undefined, identity: Identity }} Observed */

/**
 * @returns {Owner} A unique claim by this process on this host. */
function owner() {
  return { pid: process.pid, host: hostname(), token: randomUUID() };
}

/**
 * @param {unknown} error - The filesystem failure.
 * @returns {CardsError} A safe diagnostic. */
function contentError(error) {
  return new CardsError("ERR_CARDS_CONTENT", "The content root is not writable.", {
    expected: `a writable directory holding ${LOCK_FILE}`,
    actual: readString(error, "code") ?? "unknown filesystem failure",
    next: "check that the content root exists (`--root`) and is writable.",
    cause: error,
  });
}
/**
 * @returns {CardsError} Ownership could not safely be acquired. */
function busy() {
  return new CardsError(
    "ERR_CARDS_BUSY",
    "Another cards:* writer may hold the content lock.",
    {
      expected: `exclusive ownership of ${LOCK_FILE}`,
      actual: "a live owner, an unknown lock, or an acquisition already in progress",
      next: "wait for the writer to finish and rerun. Inspect legacy, foreign-host or unknown locks manually; never remove a live writer's lock.",
    },
  );
}
/**
 * @param {string} file - Claim path.
 * @returns {number | undefined} Descriptor or occupied. */
function create(file) {
  try {
    return openSync(file, "wx", 0o600);
  } catch (error) {
    if (readKey(error, "code") === "EEXIST") return undefined;
    throw contentError(error);
  }
}
/**
 * @param {unknown} value - Untrusted JSON.
 * @returns {Owner | undefined} Known ownership only. */
function readOwner(value) {
  const pid = readKey(value, "pid");
  const host = readString(value, "host");
  const token = readString(value, "token");
  return typeof pid === "number" &&
    Number.isInteger(pid) &&
    pid > 0 &&
    pid <= 2_147_483_647 &&
    host !== undefined &&
    host.length > 0 &&
    token !== undefined &&
    token.length > 0
    ? { pid, host, token }
    : undefined;
}
/**
 * @param {string} file - Lock path.
 * @returns {Observed | undefined} Never follows symlinks. */
function observe(file) {
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const identity = fstatSync(fd);
    if (!identity.isFile()) return undefined;
    return { identity, owner: readOwner(parseJson(readFileSync(fd, "utf8"))) };
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
/**
 * @param {Identity} left - Current file.
 * @param {Identity} right - Open claim.
 * @returns {boolean} Same inode. */
function same(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
/**
 * @param {number} pid - Positive same-host PID.
 * @returns {boolean} Only ESRCH proves death. */
function dead(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return readKey(error, "code") === "ESRCH";
  }
}
/**
 *
 * @param {string} file - Claim path.
 *
 * @param {Identity} identity - Original descriptor stays open until after release.
 *
 * @param {Owner} held - Unique ownership token.
 *
 * @returns {void}
 */
function release(file, identity, held) {
  const current = observe(file);
  if (current?.owner?.token !== held.token || !same(current.identity, identity)) return;
  // All cooperating acquisitions hold the claim guard; a live owner is never reclaimed.
  rmSync(file, { force: true });
}
/**
 *
 * @param {string} lock - Content lock.
 *
 * @param {Owner} held - Ownership for the long-running action.
 *
 * @returns {{ fd: number, identity: Identity, recovered: boolean }} The held lock.
 */
function acquire(lock, held) {
  const guard = `${lock}.claim`;
  const claim = create(guard);
  if (claim === undefined) throw busy();
  const guardOwner = owner();
  const guardIdentity = fstatSync(claim);
  try {
    writeFileSync(claim, JSON.stringify(guardOwner));
    let fd = create(lock);
    let recovered = false;
    if (fd === undefined) {
      const current = observe(lock);
      if (
        current?.owner?.host !== hostname() ||
        Date.now() - current.identity.mtimeMs < STALE_LOCK_MS ||
        !dead(current.owner.pid)
      )
        throw busy();
      // The guard prevents another acquisition replacing this observed dead owner.
      release(lock, current.identity, current.owner);
      fd = create(lock);
      recovered = true;
    }
    if (fd === undefined) throw busy();
    try {
      writeFileSync(fd, JSON.stringify(held));
      return { fd, identity: fstatSync(fd), recovered };
    } catch (error) {
      closeSync(fd);
      throw contentError(error); // Leave any incomplete metadata untouched and fail closed.
    }
  } catch (error) {
    throw error instanceof CardsError ? error : contentError(error);
  } finally {
    try {
      release(guard, guardIdentity, guardOwner);
    } finally {
      closeSync(claim);
    }
  }
}
/**
 * Every acquisition and stale recovery uses a brief exclusive guard. Only an old,
 * same-host lock with a confirmed dead PID is reclaimed. Live/reused PIDs and unknown
 * ownership fail closed; an interrupted guard also needs manual inspection.
 *
 * @template T
 *
 * @param {string} root - Content root.
 *
 * @param {(text: string) => void} warn - Recovery diagnostic.
 *
 * @param {() => T} action - The synchronous write.
 *
 * @returns {T} What the write returned.
 */
export function withLock(root, warn, action) {
  const lock = path.join(root, LOCK_FILE);
  const held = owner();
  const acquired = acquire(lock, held);
  try {
    if (acquired.recovered)
      warn(
        `Breaking a stale lock: ${LOCK_FILE} belongs to a confirmed dead process on this host.`,
      );
    return action();
  } finally {
    try {
      release(lock, acquired.identity, held);
    } finally {
      closeSync(acquired.fd);
    }
  }
}
