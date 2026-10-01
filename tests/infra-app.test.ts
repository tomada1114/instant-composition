import {
  buildApp,
  EDGE_REGION,
  MissingRepositoryRootError,
  REGION,
  REPOSITORY_ROOT_CONTEXT,
  STAGES,
  UnknownStageError,
} from "@instant-composition/infra";
import { describe, expect, it } from "vitest";

import { infraContext } from "./infra-context";

// Synthesis is the whole of what the CDK app can get wrong before a deploy, and
// it needs no AWS credentials, so the everyday gate runs it for every stage.
// Built and synthesized once per stage at collection, outside any test's
// timeout: the first synthesis loads aws-cdk-lib and alone takes seconds (#150).
const SYNTHESIZED = new Map(
  STAGES.map((stage) => {
    const { app, stage: built } = buildApp(infraContext(stage));
    return [stage, { built, stacks: app.synth().stacks }] as const;
  }),
);

describe("the CDK app", () => {
  // Only `dev` has a deploy role, since `prod`'s deploy waits behind an
  // approval, and only `dev` is hosted for now.
  const STACKS = {
    dev: ["deploy-access", "edge", "foundation", "app"],
    prod: ["foundation"],
  } as const;

  // A CLOUDFRONT-scope web ACL can only be created in us-east-1, so `edge`
  // is the one stack outside the stages' Region.
  function regionOf(id: string): string {
    return id === "edge" ? EDGE_REGION : REGION;
  }

  it.each(STAGES)("synthesizes the %s stage's stacks in their regions", (stage) => {
    const synthesized = SYNTHESIZED.get(stage);
    if (synthesized === undefined) throw new TypeError(`no ${stage} synthesis`);
    const { built, stacks } = synthesized;
    expect(built).toBe(stage);
    expect(
      stacks.map(({ id, stackName, environment }) => ({
        id,
        stackName,
        region: environment.region,
      })),
    ).toStrictEqual(
      STACKS[stage].map((id) => ({
        id,
        stackName: `instant-composition-${stage}-${id}`,
        region: regionOf(id),
      })),
    );
  });

  // `app` reads foundation's identifiers and edge's web ACL by
  // name, so the order is a deploy order alone, and neither waits on `app`.
  it("deploys the dev app stack after foundation and edge, never the reverse", () => {
    const stacks = SYNTHESIZED.get("dev")?.stacks ?? [];
    const ids = new Set(stacks.map(({ id }) => id));
    // Each stack also depends on its own asset manifest, which is no stack.
    const dependencies = Object.fromEntries(
      stacks.map(({ id, dependencies: on }) => [
        id,
        on.map((artifact) => artifact.id).filter((artifact) => ids.has(artifact)),
      ]),
    );
    expect(dependencies).toStrictEqual({
      "deploy-access": [],
      foundation: [],
      edge: [],
      app: ["foundation", "edge"],
    });
  });

  it.each([[undefined], [""], [42]])(
    "refuses to build dev without a repository root to bundle from: %p",
    (root) => {
      const build = () => buildApp({ stage: "dev", [REPOSITORY_ROOT_CONTEXT]: root });
      expect(build).toThrow(MissingRepositoryRootError);
      expect(build).toThrow(
        expect.objectContaining({ code: "ERR_INFRA_REPOSITORY_ROOT" }),
      );
    },
  );

  it("builds prod, which bundles nothing, without a repository root", () => {
    expect(buildApp({ stage: "prod" }).stage).toBe("prod");
  });

  it.each([["qa"], [undefined], ["Dev"]])("refuses to build the stage %p", (stage) => {
    expect(() => buildApp({ stage })).toThrow(UnknownStageError);
    expect(() => buildApp({ stage })).toThrow(
      expect.objectContaining({ code: "ERR_INFRA_UNKNOWN_STAGE" }),
    );
  });
});
