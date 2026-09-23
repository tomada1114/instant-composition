// @vitest-environment node
import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ja from "../messages/ja.json";
import { DrillScreen } from "../src/components/drill/drill-screen";

// Next.js renders a client component on the server first, where there is no
// `window`; the round's kind is read from the address only once in the browser.
describe("DrillScreen on the server", () => {
  it("renders its loading shell without touching the browser", () => {
    expect(typeof window).toBe("undefined");
    const html = renderToString(
      <NextIntlClientProvider locale="ja" messages={ja}>
        <DrillScreen first={false} sound={false} dailySize={10} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("<main");
  });
});
