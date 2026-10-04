import type { QueueStorage } from "../study/answer-queue";
import { outboxPageText, recoverOutbox } from "./outbox-state";

/** Validate the entire empty session before deleting any of its durable records. */
export function purgeEmptyOutbox(storage: QueueStorage, key: string): boolean {
  if (
    !("length" in storage) ||
    typeof storage.length !== "number" ||
    !("key" in storage) ||
    typeof storage.key !== "function" ||
    recoverOutbox(storage, key).count !== 0
  )
    return false;
  const listed = storage as QueueStorage & Pick<Storage, "length" | "key">;
  for (let index = 0; index < listed.length; index += 1) {
    const name = listed.key(index);
    if (!name?.startsWith(`${key}:`)) continue;
    const suffix = name.slice(key.length + 1),
      raw = storage.getItem(name);
    if (suffix === "owner") continue;
    if (suffix === "recent") outboxPageText(raw);
    else if (/^page:(0|[1-9]\d*)$/u.test(suffix)) {
      if (
        !Number.isSafeInteger(Number(suffix.slice(5))) ||
        outboxPageText(raw).length !== 0
      )
        return false;
    } else if (!/^removed:[A-Za-z0-9_-]{1,64}$/u.test(suffix) || raw !== "1")
      return false;
  }
  for (let index = 0; index < listed.length;) {
    const name = listed.key(index);
    if (
      name === key ||
      (name?.startsWith(`${key}:`) === true && name !== `${key}:owner`)
    )
      storage.removeItem(name);
    else index += 1;
  }
  return true;
}
