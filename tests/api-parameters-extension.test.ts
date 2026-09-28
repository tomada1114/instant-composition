import { describe, expect, it } from "vitest";

import {
  readSecureString,
  SecretParameterError,
  type Fetch,
  type ParametersExtension,
} from "@instant-composition/api";

// Reading a secret through the AWS Parameters and Secrets Lambda extension,
// against a fake of the extension's HTTP endpoint: no AWS call, no socket.

const EXTENSION: ParametersExtension = {
  port: 2773,
  sessionToken: "session-token-for-tests",
};
const NAME = "/instant-composition/dev/web-client-secret";
const SECRET = "testclientsecret1";

/** The extension as documented: a GET, the session token as its header, the parameter's answer. */
function extensionAnswering(respond: () => Response): {
  fetch: Fetch;
  requests: Request[];
} {
  const requests: Request[] = [];
  return {
    requests,
    fetch: (request) => {
      requests.push(request);
      return Promise.resolve(respond());
    },
  };
}

const parameter = (type: string, value: string): Response =>
  Response.json({
    Parameter: { Name: NAME, Type: type, Value: value, Version: 1 },
    ResultMetadata: {},
  });

async function refusal(fetch: Fetch): Promise<SecretParameterError> {
  try {
    await readSecureString(EXTENSION, NAME, fetch);
  } catch (error) {
    if (error instanceof SecretParameterError) return error;
    throw error;
  }
  throw new Error("readSecureString read the parameter.");
}

describe("readSecureString", () => {
  it("asks the extension on localhost for the decrypted parameter, with the session token", async () => {
    const extension = extensionAnswering(() => parameter("SecureString", SECRET));

    expect(await readSecureString(EXTENSION, NAME, extension.fetch)).toBe(SECRET);

    const [request] = extension.requests;
    const url = new URL(request?.url ?? "");
    expect(request?.method).toBe("GET");
    expect(`${url.origin}${url.pathname}`).toBe(
      "http://localhost:2773/systemsmanager/parameters/get",
    );
    expect(Object.fromEntries(url.searchParams)).toStrictEqual({
      name: NAME,
      withDecryption: "true",
    });
    expect(request?.headers.get("x-aws-parameters-secrets-token")).toBe(
      EXTENSION.sessionToken,
    );
  });

  it("reaches the extension on the port it was moved to", async () => {
    const extension = extensionAnswering(() => parameter("SecureString", SECRET));

    await readSecureString({ ...EXTENSION, port: 2800 }, NAME, extension.fetch);

    expect(new URL(extension.requests[0]?.url ?? "").port).toBe("2800");
  });

  it.each([400, 403, 404, 500])(
    "refuses an extension answering %i, carrying the status alone",
    async (status) => {
      const error = await refusal(
        extensionAnswering(() => Response.json({ secret: SECRET }, { status })).fetch,
      );
      expect(error.code).toBe("ERR_API_SECRET_UNREADABLE");
      expect(error.status).toBe(status);
      expect(error.message).not.toContain(SECRET);
    },
  );

  it("refuses an extension it cannot reach, keeping the failure on cause", async () => {
    const failure = new TypeError("fetch failed");
    const error = await refusal(() => Promise.reject(failure));
    expect(error.code).toBe("ERR_API_SECRET_UNREADABLE");
    expect(error.status).toBeNull();
    expect(error.cause).toBe(failure);
  });

  it.each([
    ["a body that is not JSON", () => new Response("not json")],
    ["no parameter", () => Response.json({ ResultMetadata: {} })],
    [
      "a parameter without a value",
      () => Response.json({ Parameter: { Type: "SecureString" } }),
    ],
    ["a parameter that is not an object", () => Response.json({ Parameter: SECRET })],
  ])("refuses %s", async (_, respond) => {
    const error = await refusal(extensionAnswering(respond).fetch);
    expect(error.code).toBe("ERR_API_SECRET_UNREADABLE");
    expect(error.status).toBeNull();
    expect(error.message).not.toContain(SECRET);
  });

  it.each(["String", "StringList"])(
    "refuses a secret stored as a plain %s parameter, never quoting it",
    async (type) => {
      const error = await refusal(
        extensionAnswering(() => parameter(type, SECRET)).fetch,
      );
      expect(error.code).toBe("ERR_API_SECRET_UNREADABLE");
      expect(error.message).not.toContain(SECRET);
    },
  );
});
