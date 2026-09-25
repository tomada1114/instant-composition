import {
  buildApp,
  FoundationStack,
  LEARNER_TABLE_NAME_OUTPUT,
  type Stage,
} from "@instant-composition/infra";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

function foundationTemplate(stage: Stage): Template {
  const stack = buildApp({ stage }).app.node.findChild("foundation");
  if (!(stack instanceof FoundationStack)) {
    throw new TypeError("the app has no foundation stack");
  }
  return Template.fromStack(stack);
}

// ADR-0006's single table, as packages/adapters writes it: `PK` and `SK`
// are its `LEARNER_TABLE_KEY`, which infra/ may not import.
describe("the foundation stack's learner table", () => {
  it.each<Stage>(["dev", "prod"])(
    "is one on-demand table keyed by PK and SK in %s",
    (stage) => {
      const template = foundationTemplate(stage);
      expect(Object.keys(template.findResources("AWS::DynamoDB::Table"))).toHaveLength(
        1,
      );
      expect(() =>
        template.hasResourceProperties("AWS::DynamoDB::Table", {
          KeySchema: [
            { AttributeName: "PK", KeyType: "HASH" },
            { AttributeName: "SK", KeyType: "RANGE" },
          ],
          AttributeDefinitions: [
            { AttributeName: "PK", AttributeType: "S" },
            { AttributeName: "SK", AttributeType: "S" },
          ],
          BillingMode: "PAY_PER_REQUEST",
        }),
      ).not.toThrow();
    },
  );

  it.each<Stage>(["dev", "prod"])(
    "is retained on delete and on replacement in %s",
    (stage) => {
      const template = foundationTemplate(stage);
      expect(() =>
        template.hasResource("AWS::DynamoDB::Table", {
          DeletionPolicy: "Retain",
          UpdateReplacePolicy: "Retain",
        }),
      ).not.toThrow();
    },
  );

  it.each<[Stage, boolean]>([
    ["dev", false],
    ["prod", true],
  ])(
    "has point-in-time recovery and deletion protection in %s: %s",
    (stage, isProtected) => {
      const table = Object.values(
        foundationTemplate(stage).findResources("AWS::DynamoDB::Table"),
      )[0];
      const properties: unknown = table?.["Properties"];
      expect(properties).toMatchObject({
        DeletionProtectionEnabled: isProtected,
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: isProtected },
      });
    },
  );

  it("exports the table's name as a stack output", () => {
    const outputs = foundationTemplate("dev").findOutputs(LEARNER_TABLE_NAME_OUTPUT);
    expect(Object.keys(outputs)).toStrictEqual([LEARNER_TABLE_NAME_OUTPUT]);
    expect(JSON.stringify(outputs[LEARNER_TABLE_NAME_OUTPUT])).toMatch(
      /"Value":\{"Ref":"LearnerTable[0-9A-F]+"\}/,
    );
    expect(outputs[LEARNER_TABLE_NAME_OUTPUT]).not.toHaveProperty("Export");
  });
});
