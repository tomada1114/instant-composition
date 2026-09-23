import { describe, expect, it } from "vitest";

import { failure, MAX_REQUEST_BODY_BYTES, readJsonBody } from "../src/server/http";

// `src/server/http.ts` is the request-reading helper every endpoint is told to
// use (`building-app-routes`). Its only caller used to be the handler removed
// with the AI layer, whose suite exercised it indirectly; these cases drive it
// directly so its guarantees do not ride on an endpoint existing.

/** A POST request whose body arrives as exactly these chunks. */
function streamed(chunks: readonly Uint8Array[]): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return new Request("http://localhost/api/example", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);
}

/** A POST request whose body stream fails after one chunk. */
function brokenMidway(): Request {
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new TextEncoder().encode('{"partial":'));
        return;
      }
      controller.error(new Error("connection reset"));
    },
  });
  return new Request("http://localhost/api/example", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);
}

/** The status and `error.code` a refusal answers with. */
async function refusal(response: Response): Promise<{ status: number; code: unknown }> {
  const body = (await response.json()) as { error?: { code?: unknown } };
  return { status: response.status, code: body.error?.code };
}

describe("failure", () => {
  it("answers with the status, a code and a message under `error`", async () => {
    const response = failure(418, "ERR_EXAMPLE", "An example refusal.", {
      "retry-after": "5",
    });

    expect(response.status).toBe(418);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toStrictEqual({
      error: { code: "ERR_EXAMPLE", message: "An example refusal." },
    });
  });
});

describe("readJsonBody", () => {
  it("parses a JSON body", async () => {
    const request = new Request("http://localhost/api/example", {
      method: "POST",
      body: '{"prompt":"hello"}',
    });

    const result = await readJsonBody(request);

    expect(result).toStrictEqual({ ok: true, value: { prompt: "hello" } });
  });

  it("decodes a multi-byte character split across two chunks", async () => {
    const bytes = new TextEncoder().encode('{"text":"日本"}');
    // Split inside the first character's three-byte sequence.
    const splitAt = bytes.indexOf(0xe6) + 1;

    const result = await readJsonBody(
      streamed([bytes.slice(0, splitAt), bytes.slice(splitAt)]),
    );

    expect(result).toStrictEqual({ ok: true, value: { text: "日本" } });
  });

  it("accepts a body of exactly the ceiling", async () => {
    const padding = "a".repeat(MAX_REQUEST_BODY_BYTES - '{"p":""}'.length);
    const body = `{"p":"${padding}"}`;
    expect(new TextEncoder().encode(body).byteLength).toBe(MAX_REQUEST_BODY_BYTES);

    const result = await readJsonBody(
      new Request("http://localhost/api/example", { method: "POST", body }),
    );

    expect(result.ok).toBe(true);
  });

  it("refuses a body one byte over the ceiling with 413", async () => {
    const result = await readJsonBody(
      streamed([new Uint8Array(MAX_REQUEST_BODY_BYTES), new Uint8Array(1)]),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      await expect(refusal(result.error)).resolves.toStrictEqual({
        status: 413,
        code: "ERR_PAYLOAD_TOO_LARGE",
      });
    }
  });

  it.each([
    ["a body that is not JSON", "not json"],
    ["an empty body", ""],
  ])("refuses %s with 400", async (_label, body) => {
    const result = await readJsonBody(
      new Request("http://localhost/api/example", { method: "POST", body }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      await expect(refusal(result.error)).resolves.toStrictEqual({
        status: 400,
        code: "ERR_BAD_REQUEST",
      });
    }
  });

  it("refuses a request with no body at all with 400", async () => {
    const result = await readJsonBody(new Request("http://localhost/api/example"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      await expect(refusal(result.error)).resolves.toStrictEqual({
        status: 400,
        code: "ERR_BAD_REQUEST",
      });
    }
  });

  it("refuses a body whose stream fails midway with 400 rather than throwing", async () => {
    const result = await readJsonBody(brokenMidway());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      await expect(refusal(result.error)).resolves.toStrictEqual({
        status: 400,
        code: "ERR_BAD_REQUEST",
      });
    }
  });
});
