import type { Result } from "../../core/result";
import {
  contentSignature,
  loadContent,
  type ContentError,
  type ContentSnapshot,
} from "./load";

export type { ContentError, ContentSnapshot } from "./load";

export interface ContentSource {
  /** The current snapshot, re-read only when a file under the root changed. */
  get(): Result<ContentSnapshot, ContentError>;
}

export function createContentSource(root: string): ContentSource {
  let cached:
    { signature: string; result: Result<ContentSnapshot, ContentError> } | undefined;
  return {
    get() {
      const signature = contentSignature(root);
      if (cached?.signature !== signature) {
        cached = { signature, result: loadContent(root) };
      }
      return cached.result;
    },
  };
}
