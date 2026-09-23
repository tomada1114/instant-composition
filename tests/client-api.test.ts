import { describe, expect, it, vi } from "vitest";

import { saveSettings } from "../src/components/lib/api";

describe("saveSettings", () => {
  it("puts the patch and answers the saved settings", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(Response.json({ settings: { sound: false } }));
    });
    expect(await saveSettings({ sound: false })).toStrictEqual({
      ok: true,
      value: { settings: { sound: false } },
    });
    expect(calls[0]?.url).toBe("/api/settings");
    expect(calls[0]?.init.method).toBe("PUT");
    expect(calls[0]?.init.body).toBe(JSON.stringify({ sound: false }));
  });

  it("passes on a refusal's code", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json({ error: { code: "ERR_BAD_REQUEST" } }, { status: 400 }),
      ),
    );
    expect(await saveSettings({ topics: [] })).toStrictEqual({
      ok: false,
      error: { code: "ERR_BAD_REQUEST" },
    });
  });
});
