import {
  buildApp,
  REGION,
  STAGES,
  UnknownStageError,
} from "@instant-composition/infra";
import { describe, expect, it } from "vitest";

// Synthesis is the whole of what the CDK app can get wrong before a deploy, and
// it needs no AWS credentials, so the everyday gate runs it for every stage.
describe("the CDK app", () => {
  it.each(STAGES)("synthesizes the %s stage's stacks in the one region", (stage) => {
    const { app, stage: built } = buildApp({ stage });
    expect(built).toBe(stage);
    const stacks = app.synth().stacks;
    expect(
      stacks.map(({ id, stackName, environment }) => ({
        id,
        stackName,
        region: environment.region,
      })),
    ).toStrictEqual([
      {
        id: "foundation",
        stackName: `instant-composition-${stage}-foundation`,
        region: REGION,
      },
    ]);
  });

  it.each([["qa"], [undefined], ["Dev"]])("refuses to build the stage %p", (stage) => {
    expect(() => buildApp({ stage })).toThrow(UnknownStageError);
    expect(() => buildApp({ stage })).toThrow(
      expect.objectContaining({ code: "ERR_INFRA_UNKNOWN_STAGE" }),
    );
  });
});
