import { describe, expect, it } from "vitest";

import {
  ApiEnvError,
  HOSTED_ENV_NAMES,
  readHostedEnv,
  type HostedEnv,
} from "@instant-composition/api";

// The hosted entry's environment: every name is required but the extension's
// port, the user pool and the model are never optional, neither the client
// secret nor the model key is taken as a plain variable, and a value its
// setting refuses is named — never quoted.

/** A whole hosted configuration, well formed. None of these is a real value. */
const HOSTED = {
  AWS_REGION: "ap-northeast-1",
  AWS_SESSION_TOKEN: "session-token-for-tests",
  API_TABLE_NAME: "instant-composition-dev",
  API_CATALOG_PATH: "catalog/en/ja.json",
  API_COGNITO_USER_POOL_ID: "ap-northeast-1_AbC123",
  API_COGNITO_CLIENT_ID: "1example23456789",
  API_COGNITO_DOMAIN: "https://example.auth.ap-northeast-1.amazoncognito.com",
  API_COGNITO_CLIENT_SECRET_PARAMETER: "/instant-composition/dev/web-client-secret",
  API_WEB_ORIGINS: "https://app.example.com",
  API_MODEL_PROVIDER: "openrouter",
  API_MODEL_ID: "anthropic/claude-haiku-4.5",
  API_OPENROUTER_KEY_PARAMETER: "/instant-composition/dev/app/openrouter-api-key",
};

const READ: HostedEnv = {
  region: "ap-northeast-1",
  tableName: "instant-composition-dev",
  catalogPath: "catalog/en/ja.json",
  cognito: {
    userPoolId: "ap-northeast-1_AbC123",
    clientId: "1example23456789",
    domain: "https://example.auth.ap-northeast-1.amazoncognito.com",
    clientSecretParameter: "/instant-composition/dev/web-client-secret",
  },
  web: { origins: ["https://app.example.com"] },
  extension: { port: 2773, sessionToken: "session-token-for-tests" },
  model: {
    provider: "openrouter",
    modelId: "anthropic/claude-haiku-4.5",
    keyParameter: "/instant-composition/dev/app/openrouter-api-key",
  },
};

function refusedWith(source: Record<string, string>): ApiEnvError {
  try {
    readHostedEnv(source);
  } catch (error) {
    if (error instanceof ApiEnvError) return error;
    throw error;
  }
  throw new Error("readHostedEnv accepted the environment.");
}

describe("readHostedEnv", () => {
  it("reads a whole hosted configuration, the extension on its default port", () => {
    expect(readHostedEnv(HOSTED)).toStrictEqual(READ);
  });

  it("takes the extension's port, several web origins, and trims every value", () => {
    expect(
      readHostedEnv({
        ...HOSTED,
        PARAMETERS_SECRETS_EXTENSION_HTTP_PORT: " 2800 ",
        API_WEB_ORIGINS: " https://app.example.com , https://d111.cloudfront.net ",
        API_COGNITO_DOMAIN: "https://example.auth.ap-northeast-1.amazoncognito.com/",
      }),
    ).toStrictEqual({
      ...READ,
      web: {
        ...READ.web,
        origins: ["https://app.example.com", "https://d111.cloudfront.net"],
      },
      extension: { ...READ.extension, port: 2800 },
    });
  });

  it("refuses to start with no configuration, naming every required variable", () => {
    const error = refusedWith({});
    expect(error.code).toBe("ERR_API_ENV_INVALID");
    expect(error.names).toStrictEqual(
      HOSTED_ENV_NAMES.filter(
        (name) =>
          name !== "PARAMETERS_SECRETS_EXTENSION_HTTP_PORT" &&
          name !== "API_COGNITO_CLIENT_SECRET" &&
          name !== "API_OPENROUTER_API_KEY",
      ),
    );
  });

  it.each(Object.keys(HOSTED))(
    "refuses to start without %s, naming it alone",
    (name) => {
      const error = refusedWith({ ...HOSTED, [name]: " " });
      expect(error.code).toBe("ERR_API_ENV_INVALID");
      expect(error.names).toStrictEqual([name]);
    },
  );

  it("refuses the client secret as a plain variable, never quoting it", () => {
    const secret = "1example2secret3456789abcdef";
    const error = refusedWith({ ...HOSTED, API_COGNITO_CLIENT_SECRET: secret });
    expect(error.code).toBe("ERR_API_ENV_INVALID");
    expect(error.names).toStrictEqual(["API_COGNITO_CLIENT_SECRET"]);
    expect(error.message).not.toContain(secret);
  });

  it("refuses the model key as a plain variable, never quoting it", () => {
    const key = "dummy-not-a-real-value";
    const error = refusedWith({ ...HOSTED, API_OPENROUTER_API_KEY: key });
    expect(error.code).toBe("ERR_API_ENV_INVALID");
    expect(error.names).toStrictEqual(["API_OPENROUTER_API_KEY"]);
    expect(error.message).not.toContain(key);
  });

  it.each([
    ["AWS_REGION", "dummy-not-a-real-value"],
    ["AWS_REGION", "Tokyo"],
    ["PARAMETERS_SECRETS_EXTENSION_HTTP_PORT", "dummy-not-a-real-value"],
    ["PARAMETERS_SECRETS_EXTENSION_HTTP_PORT", "70000"],
    ["API_TABLE_NAME", "learners/dev"],
    ["API_COGNITO_USER_POOL_ID", "dummy-not-a-real-value"],
    ["API_COGNITO_CLIENT_ID", "dummy-not-a-real-value"],
    ["API_COGNITO_DOMAIN", "http://example.auth.ap-northeast-1.amazoncognito.com"],
    [
      "API_COGNITO_DOMAIN",
      "https://user:pw@example.auth.ap-northeast-1.amazoncognito.com",
    ],
    ["API_COGNITO_DOMAIN", "https://example.auth.ap-northeast-1.amazoncognito.com/#x"],
    ["API_COGNITO_CLIENT_SECRET_PARAMETER", "web client secret"],
    ["API_COGNITO_CLIENT_SECRET_PARAMETER", "x".repeat(1012)],
    ["API_WEB_ORIGINS", "dummy-not-a-real-value"],
    ["API_WEB_ORIGINS", "http://app.example.com"],
    ["API_WEB_ORIGINS", "https://app.example.com/"],
    ["API_WEB_ORIGINS", "https://app.example.com,"],
    ["API_MODEL_PROVIDER", "stand-in"],
    ["API_MODEL_PROVIDER", "bedrock"],
    ["API_MODEL_ID", "claude haiku"],
    ["API_OPENROUTER_KEY_PARAMETER", "openrouter api key"],
  ])("refuses %s=%s by naming it", (name, value) => {
    const error = refusedWith({ ...HOSTED, [name]: value });
    expect(error.code).toBe("ERR_API_ENV_INVALID");
    expect(error.names).toStrictEqual([name]);
    expect(error.message).not.toContain(value);
  });

  it("never quotes the session token, whatever else is at fault", () => {
    const error = refusedWith({ ...HOSTED, API_TABLE_NAME: "!" });
    expect(error.names).toStrictEqual(["API_TABLE_NAME"]);
    expect(error.message).not.toContain(HOSTED.AWS_SESSION_TOKEN);
  });
});
