import type { Result } from "@instant-composition/domain";
import type { Stored } from "@instant-composition/application";

/** Private shape shared by guarded DynamoDB and synchronous in-memory system records. */
export interface SystemRecord<T> {
  checkpoint(): Promise<Stored<T> | undefined>;
  save(
    value: T,
    version: number | null,
  ): Promise<Result<undefined, { readonly code: "ERR_CONFLICT" }>>;
}
