import type { ModelTask } from "@instant-composition/domain";

type Fields<T> = { readonly [K in keyof T]-?: true };
const IDENTITY = {
  key: true,
  claimId: true,
  input: true,
  attempt: true,
  duplicatePossible: true,
  startedAt: true,
  expiresAt: true,
  state: true,
} as const;
const CLAIM = { ...IDENTITY, leaseUntil: true } as const satisfies Fields<
  Extract<ModelTask, { state: "in-flight" }>
>;
const RESULT = { ...IDENTITY, result: true } as const satisfies Fields<
  Extract<ModelTask, { state: "result" }>
>;
const FAILED = { ...IDENTITY, outcome: true, reason: true } as const satisfies Fields<
  Extract<ModelTask, { state: "failed" }>
>;

function declared<T extends object>(value: T, fields: Fields<T>): T {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => Object.hasOwn(fields, key)),
  ) as T;
}

/** Only fields of the task's current state survive a read and a later write. */
export function declaredModelTask(task: ModelTask): ModelTask {
  switch (task.state) {
    case "in-flight":
      return declared(task, CLAIM);
    case "result":
      return declared(task, RESULT);
    case "failed":
      return declared(task, FAILED);
  }
}
