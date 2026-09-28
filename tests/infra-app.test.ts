import {
  buildApp,
  REGION,
  STAGES,
  UnknownStageError,
} from "@instant-composition/infra";
import { describe, expect, it } from "vitest";

// Synthesis is the whole of what the CDK app can get wrong before a deploy, and
// it needs no AWS credentials, so the everyday gate runs it for every stage.
// Built and synthesized once per stage at collection, outside any test's
// timeout: the first synthesis loads aws-cdk-lib and alone takes seconds (#150).
const SYNTHESIZED = new Map(
  STAGES.map((stage) => {
    const { app, stage: built } = buildApp({ stage });
    return [stage, { built, stacks: app.synth().stacks }] as const;
  }),
);

describe("the CDK app", () => {
  // Only `dev` has a deploy role: `prod`'s deploy waits behind an approval.
  const STACKS = {
    dev: ["deploy-access", "foundation"],
    prod: ["foundation"],
  } as const;

  it.each(STAGES)("synthesizes the %s stage's stacks in the one region", (stage) => {
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
        region: REGION,
      })),
    );
  });

  it.each([["qa"], [undefined], ["Dev"]])("refuses to build the stage %p", (stage) => {
    expect(() => buildApp({ stage })).toThrow(UnknownStageError);
    expect(() => buildApp({ stage })).toThrow(
      expect.objectContaining({ code: "ERR_INFRA_UNKNOWN_STAGE" }),
    );
  });
});
