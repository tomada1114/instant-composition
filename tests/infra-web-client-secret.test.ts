import { spawnSync } from "node:child_process";

import {
  AppStack,
  buildApp,
  webClientSecretParameterName,
} from "@instant-composition/infra";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { infraContext } from "./infra-context";

// The dev app stack's client secret writer, run as Lambda runs it: its inline
// Python, taken from the synthesized template, under the local `python3` with
// fakes of boto3's two clients and of CloudFormation's response URL.

function writerCode(): string {
  const stack = buildApp(infraContext("dev")).app.node.findChild("app");
  if (!(stack instanceof AppStack)) throw new TypeError("the dev app has no app stack");
  const writers = Object.entries(
    Template.fromStack(stack).findResources("AWS::Lambda::Function") as Record<
      string,
      { Properties: { Code: { ZipFile?: unknown } } }
    >,
  ).filter(([id]) => id.startsWith("WebClientSecretWriter"));
  const code = writers[0]?.[1].Properties.Code.ZipFile;
  if (writers.length !== 1 || typeof code !== "string") {
    throw new TypeError("the app stack has no single inline client secret writer");
  }
  return code;
}

// Synthesized once at collection, outside any test's timeout (#150).
const CODE = writerCode();

/** Loads the writer as `index` with fakes in place, calls its handler once, and prints what it did. */
const HARNESS = String.raw`
import contextlib, io, json, sys, types, urllib.request

spec = json.load(sys.stdin)
calls, sent = [], []


class ClientError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.response = {"Error": {"Code": code, "Message": message}}


def operation(name):
    def call(**kwargs):
        calls.append({"command": name, "input": kwargs})
        answer = spec["answers"].get(name, {})
        if "fail" in answer:
            raise ClientError(answer["fail"], answer["message"])
        return answer.get("return", {})
    return call


class Client:
    describe_user_pool_client = staticmethod(operation("DescribeUserPoolClient"))
    put_parameter = staticmethod(operation("PutParameter"))
    delete_parameter = staticmethod(operation("DeleteParameter"))


boto3 = types.ModuleType("boto3")
boto3.client = lambda service: Client()
sys.modules["boto3"] = boto3


def urlopen(request, timeout=None):
    sent.append({
        "url": request.full_url,
        "method": request.get_method(),
        "headers": dict(request.header_items()),
        "body": json.loads(request.data),
    })


urllib.request.urlopen = urlopen
printed = io.StringIO()
with contextlib.redirect_stdout(printed):
    module = {"__name__": "index"}
    exec(spec["code"], module)
    module["handler"](spec["event"], None)
print(json.dumps({"calls": calls, "sent": sent, "printed": printed.getvalue()}))
`;

const SECRET = "testclientsecret1";
const PARAMETER = webClientSecretParameterName("dev");
const PROPERTIES = {
  ServiceToken: "arn:aws:lambda:ap-northeast-1:111111111111:function:writer",
  UserPoolId: "ap-northeast-1_example",
  ClientId: "exampleclient",
  ParameterName: PARAMETER,
};
const STACK_ID = "arn:aws:cloudformation:ap-northeast-1:111111111111:stack/app/1";
const RESPONSE_URL = "https://cloudformation-custom-resource-response.example/signed";

type Answer = { return: unknown } | { fail: string; message: string };

interface Run {
  readonly calls: { command: string; input: Record<string, unknown> }[];
  readonly sent: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }[];
  readonly printed: string;
}

function invoke(
  event: Record<string, unknown>,
  answers: Readonly<Record<string, Answer>> = {},
): Run {
  const result = spawnSync("python3", ["-c", HARNESS], {
    encoding: "utf8",
    input: JSON.stringify({
      code: CODE,
      event: {
        ResponseURL: RESPONSE_URL,
        StackId: STACK_ID,
        RequestId: "request-1",
        LogicalResourceId: "WebClientSecret",
        ResourceType: "Custom::WebClientSecret",
        ResourceProperties: PROPERTIES,
        ...event,
      },
      answers: {
        DescribeUserPoolClient: {
          return: { UserPoolClient: { ClientSecret: SECRET } },
        },
        ...answers,
      },
    }),
  });
  if (result.status !== 0) {
    throw new Error(`the harness failed: ${result.error?.message ?? result.stderr}`);
  }
  return JSON.parse(result.stdout) as Run;
}

/** The one answer the writer sent CloudFormation. */
function responseOf(run: Run): Record<string, unknown> {
  expect(run.sent).toHaveLength(1);
  return run.sent[0]?.body ?? {};
}

// An SDK message may quote what it was sent.
function failing(code: string): Answer {
  return { fail: code, message: `rejected ${SECRET}` };
}

describe("the client secret writer", () => {
  it("fits CloudFormation's 4096-byte inline code limit", () => {
    expect(Buffer.byteLength(CODE)).toBeLessThanOrEqual(4096);
  });

  it.each(["Create", "Update"])(
    "on %s copies the client's secret into a standard SecureString",
    (type) => {
      const run = invoke({ RequestType: type, PhysicalResourceId: PARAMETER });
      expect(run.calls).toStrictEqual([
        {
          command: "DescribeUserPoolClient",
          input: { UserPoolId: PROPERTIES.UserPoolId, ClientId: PROPERTIES.ClientId },
        },
        {
          command: "PutParameter",
          input: {
            Name: PARAMETER,
            Value: SECRET,
            Type: "SecureString",
            Tier: "Standard",
            Overwrite: true,
          },
        },
      ]);
      expect(responseOf(run)).toStrictEqual({
        Status: "SUCCESS",
        Reason: "",
        PhysicalResourceId: PARAMETER,
        StackId: STACK_ID,
        RequestId: "request-1",
        LogicalResourceId: "WebClientSecret",
      });
    },
  );

  // The response URL is presigned: a content type it was not signed with is refused.
  it("answers CloudFormation with a PUT to its response URL, with an empty content type", () => {
    const run = invoke({ RequestType: "Create" });
    expect(run.sent[0]).toMatchObject({
      url: RESPONSE_URL,
      method: "PUT",
      headers: { "Content-type": "" },
    });
    expect(JSON.stringify(run.sent)).not.toContain(SECRET);
    expect(run.printed).toBe("");
  });

  it("on Delete removes the parameter it wrote", () => {
    const run = invoke({ RequestType: "Delete", PhysicalResourceId: PARAMETER });
    expect(run.calls).toStrictEqual([
      { command: "DeleteParameter", input: { Name: PARAMETER } },
    ]);
    expect(responseOf(run)).toMatchObject({
      Status: "SUCCESS",
      PhysicalResourceId: PARAMETER,
    });
  });

  it("on Delete succeeds when the parameter is already gone", () => {
    const run = invoke(
      { RequestType: "Delete", PhysicalResourceId: PARAMETER },
      { DeleteParameter: failing("ParameterNotFound") },
    );
    expect(responseOf(run)).toMatchObject({ Status: "SUCCESS" });
  });

  // A Create that never answered leaves CloudFormation's own physical id.
  it("on Delete leaves alone a parameter it never wrote", () => {
    const run = invoke({
      RequestType: "Delete",
      PhysicalResourceId: "app-WebClientSecret-ABC123",
    });
    expect(run.calls).toStrictEqual([]);
    expect(responseOf(run)).toMatchObject({
      Status: "SUCCESS",
      PhysicalResourceId: "app-WebClientSecret-ABC123",
    });
  });

  it.each([
    ["Create", "DescribeUserPoolClient", "ResourceNotFoundException"],
    ["Update", "PutParameter", "ValidationException"],
    ["Delete", "DeleteParameter", "AccessDeniedException"],
  ])(
    "on a failed %s reports the error's code alone, never the secret",
    (type, command, code) => {
      const run = invoke(
        { RequestType: type, PhysicalResourceId: PARAMETER },
        { [command]: failing(code) },
      );
      expect(responseOf(run)).toMatchObject({
        Status: "FAILED",
        Reason: `${type} failed: ${code}`,
        PhysicalResourceId: PARAMETER,
      });
      expect(JSON.stringify(run.sent)).not.toContain(SECRET);
      expect(run.printed).toBe(`${type} failed: ${code}\n`);
    },
  );

  it("fails rather than write a client with no secret", () => {
    const run = invoke(
      { RequestType: "Create" },
      { DescribeUserPoolClient: { return: { UserPoolClient: {} } } },
    );
    expect(run.calls.map(({ command }) => command)).toStrictEqual([
      "DescribeUserPoolClient",
    ]);
    expect(responseOf(run)).toMatchObject({
      Status: "FAILED",
      Reason: "Create failed: NoClientSecret",
    });
  });
});
