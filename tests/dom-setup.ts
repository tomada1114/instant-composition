import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// `@testing-library/jest-dom/vitest` extends Vitest's `expect` with DOM
// matchers (`toBeInTheDocument`, `toHaveTextContent`, ...) and augments its
// types accordingly; importing it here, once, is what makes those matchers
// available to every test in the jsdom project without each file repeating
// the import.
import "@testing-library/jest-dom/vitest";

// jsdom omits Web Locks; the default fixture represents a supported browser.
beforeEach(() => {
  let tail = Promise.resolve();
  vi.stubGlobal("navigator", {
    userAgent: navigator.userAgent,
    locks: {
      request: <T>(_name: string, work: () => Promise<T>) => {
        const result = tail.then(work);
        tail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    },
  });
});

// `@testing-library/react`'s automatic cleanup registers itself only when it
// finds a global `afterEach` — which requires `test.globals: true` in
// `vitest.config.ts`. This project does not set that (the rest of the suite
// imports its lifecycle hooks explicitly), so cleanup is wired by hand
// instead of relying on an implicit global. Without it, a component rendered
// in one test would still be attached to `document.body` in the next.
afterEach(cleanup);
