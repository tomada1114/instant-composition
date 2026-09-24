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
  learnerId: undefined,
  learnerTimeZone: undefined,
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
        API_LOCAL_LEARNER_ID: "learner_2",
        API_LOCAL_LEARNER_TIME_ZONE: "asia/tokyo",
      }),
    ).toStrictEqual({
      port: 9000,
      dynamoDbEndpoint: "http://127.0.0.1:8001",
      tableName: "learners-dev",
      catalogPath: "/tmp/catalog.json",
      learnerId: "learner_2",
      learnerTimeZone: "Asia/Tokyo",
    });
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
    ["API_LOCAL_LEARNER_ID", "a#b"],
    ["API_LOCAL_LEARNER_ID", "x".repeat(65)],
    ["API_LOCAL_LEARNER_TIME_ZONE", "Mars/Olympus"],
  ])("refuses %s=%s by naming it", (name, value) => {
    const error = refusedWith({ [name]: value });
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
