import { NextIntlClientProvider } from "next-intl";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import HomePage from "../src/app/[locale]/page";
import ja from "../messages/ja.json";

vi.mock("next-intl/server", () => ({
  setRequestLocale: () => undefined,
}));

// The home page, rendered the way `writing-tests`/`placing-tests` settle it
// for issue #12: under jsdom, through Testing Library, with
// `NextIntlClientProvider` supplying the `locale`/`messages` context that
// `src/app/[locale]/layout.tsx` gets for free from the Server Component tree
// in a real request but a unit test must pass explicitly (see
// `NextIntlClientProvider`'s own `locale` doc comment). The page carries no
// `"use client"` — `building-app-routes` explains why hooks alone do not make
// it one — so what makes it renderable here is that it is synchronous, not
// that it runs on the client. An asynchronous Server Component —
// `LocaleLayout` itself — is explicitly out of scope; this test never renders
// it.

async function renderHomePage(): Promise<void> {
  await act(async () => {
    render(
      <NextIntlClientProvider locale="ja" messages={ja}>
        <HomePage params={Promise.resolve({ locale: "ja" })} />
      </NextIntlClientProvider>,
    );
    await Promise.resolve();
  });
}

describe("HomePage", () => {
  it("renders under jsdom", () => {
    // Proves the `component` vitest project actually runs under jsdom, and
    // that `tests/**/*.test.ts` (the `unit`/`automation` projects) does not:
    // `tests/server-env.test.ts` and the rest of the `node`-environment suite
    // have no `document` to assert against.
    expect(typeof document).not.toBe("undefined");
  });

  it("renders the translated title and intro", async () => {
    await renderHomePage();

    expect(
      screen.getByRole("heading", { name: ja.HomePage.title }),
    ).toBeInTheDocument();
    // Built from the catalog on disk rather than written as a literal: the
    // only shipped catalog is Japanese, and AGENTS.md's Conventions keep a
    // Japanese literal out of a test unless its exact bytes are the point.
    expect(
      screen.getByText(ja.HomePage.intro.replace("{language}", ja.LocaleSwitcher.ja)),
    ).toBeInTheDocument();
  });
});
