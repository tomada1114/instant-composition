import { describe, expect, it } from "vitest";

import {
  API_ENV_NAMES,
  ApiEnvError,
  readApiEnv,
  type ApiEnv,
} from "@instant-composition/api";

// The local run's environment: every name has a default, a blank value is
// unset, and a value its setting refuses is named — never quoted.

const DEFAULTS: ApiEnv = {
  port: 8787,
  dynamoDbEndpoint: "http://localhost:8000",
  tableName: "instant-composition-local",
  catalogPath: "dist/catalog/en/ja.json",
  cognito: null,
};

/** A whole user pool configuration, well formed. */
const COGNITO = {
  API_COGNITO_USER_POOL_ID: "ap-northeast-1_AbC123",
  API_COGNITO_CLIENT_ID: "1example23456789",
  API_COGNITO_CLIENT_SECRET: "1example2secret3456789abcdef",
  API_COGNITO_DOMAIN: "https://example.auth.ap-northeast-1.amazoncognito.com",
};

function refusedWith(source: Record<string, string>): ApiEnvError {
  try {
    readApiEnv(source);
  } catch (error) {
    if (error instanceof ApiEnvError) return error;
    throw error;
  }
  throw new Error("readApiEnv accepted the environment.");
}

describe("readApiEnv", () => {
  it("reads every setting's default from an empty environment", () => {
    expect(readApiEnv({})).toStrictEqual(DEFAULTS);
  });

  it("treats a blank or whitespace value as unset", () => {
    expect(
      readApiEnv(Object.fromEntries(API_ENV_NAMES.map((name) => [name, "  "]))),
    ).toStrictEqual(DEFAULTS);
  });

  it("takes every setting the environment gives, trimmed", () => {
    expect(
      readApiEnv({
        API_PORT: " 9000 ",
        API_DYNAMODB_ENDPOINT: "http://127.0.0.1:8001",
        API_TABLE_NAME: "learners-dev",
        API_CATALOG_PATH: "/tmp/catalog.json",
        ...COGNITO,
        API_COGNITO_USER_POOL_ID: " ap-northeast-1_AbC123 ",
        API_COGNITO_DOMAIN: "https://example.auth.ap-northeast-1.amazoncognito.com/",
      }),
    ).toStrictEqual({
      port: 9000,
      dynamoDbEndpoint: "http://127.0.0.1:8001",
      tableName: "learners-dev",
      catalogPath: "/tmp/catalog.json",
      cognito: {
        userPoolId: "ap-northeast-1_AbC123",
        clientId: "1example23456789",
        clientSecret: "1example2secret3456789abcdef",
        domain: "https://example.auth.ap-northeast-1.amazoncognito.com",
      },
    });
  });

  it.each(Object.keys(COGNITO))(
    "refuses a user pool configured without %s, naming it alone",
    (name) => {
      const error = refusedWith({ ...COGNITO, [name]: " " });
      expect(error.code).toBe("ERR_API_ENV_INVALID");
      expect(error.names).toStrictEqual([name]);
    },
  );

  it("names every unset user pool variable when only one is set", () => {
    expect(
      refusedWith({ API_COGNITO_CLIENT_SECRET: COGNITO.API_COGNITO_CLIENT_SECRET })
        .names,
    ).toStrictEqual([
      "API_COGNITO_USER_POOL_ID",
      "API_COGNITO_CLIENT_ID",
      "API_COGNITO_DOMAIN",
    ]);
  });

  it.each([
    ["API_PORT", "0"],
    ["API_PORT", "65536"],
    ["API_PORT", "80.5"],
    ["API_PORT", "-1"],
    ["API_DYNAMODB_ENDPOINT", "localhost:8000"],
    ["API_DYNAMODB_ENDPOINT", "ftp://localhost"],
    ["API_TABLE_NAME", "x1"],
    ["API_TABLE_NAME", "learners/dev"],
    ["API_COGNITO_USER_POOL_ID", "dummy-not-a-real-value"],
    ["API_COGNITO_USER_POOL_ID", "AbC123"],
    ["API_COGNITO_CLIENT_ID", "dummy-not-a-real-value"],
    ["API_COGNITO_CLIENT_SECRET", "dummy-not-a-real-value"],
    ["API_COGNITO_CLIENT_SECRET", "a".repeat(65)],
    ["API_COGNITO_DOMAIN", "dummy-not-a-real-value"],
    ["API_COGNITO_DOMAIN", "http://example.auth.ap-northeast-1.amazoncognito.com"],
    [
      "API_COGNITO_DOMAIN",
      "https://example.auth.ap-northeast-1.amazoncognito.com/oauth2",
    ],
    ["API_COGNITO_DOMAIN", "https://example.auth.ap-northeast-1.amazoncognito.com?x=1"],
    [
      "API_COGNITO_DOMAIN",
      "https://user:pw@example.auth.ap-northeast-1.amazoncognito.com",
    ],
  ])("refuses %s=%s by naming it", (name, value) => {
    const error = refusedWith(
      name.startsWith("API_COGNITO_")
        ? { ...COGNITO, [name]: value }
        : { [name]: value },
    );
    expect(error.code).toBe("ERR_API_ENV_INVALID");
    expect(error.names).toStrictEqual([name]);
    expect(error.message).not.toContain(value);
  });

  it("names every variable at fault at once", () => {
    expect(refusedWith({ API_PORT: "x", API_TABLE_NAME: "!" }).names).toStrictEqual([
      "API_PORT",
      "API_TABLE_NAME",
    ]);
  });

  it.each(["AWS_LAMBDA_FUNCTION_NAME", "AWS_EXECUTION_ENV"])(
    "refuses to start where AWS runs the process (%s set)",
    (marker) => {
      const error = refusedWith({ [marker]: "api" });
      expect(error.code).toBe("ERR_API_ENV_NOT_LOCAL");
      expect(error.names).toStrictEqual([marker]);
    },
  );
});
