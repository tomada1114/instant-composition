import { Aws, CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import {
  OidcProviderNative,
  PolicyStatement,
  Role,
  WebIdentityPrincipal,
} from "aws-cdk-lib/aws-iam";
import { type Construct } from "constructs";

import { type Stage } from "./stage";

const GITHUB_OIDC_URL = "https://token.actions.githubusercontent.com";

/**
 * The one workflow subject the deploy role trusts: this repository's `main`.
 *
 * @remarks
 * The repository sends GitHub's immutable subject (`owner@id/repo@id`), so a
 * renamed repository, or a new one created under the same name, cannot match
 * it. `gh api repos/tomada1114/instant-composition/actions/oidc/customization/sub`
 * shows the prefix.
 */
export const DEPLOY_SUBJECT =
  "repo:tomada1114@68495563/instant-composition@1382590627:ref:refs/heads/main";

/** The stack output the deploy role's ARN is read from, for the workflow's variable. */
export const DEPLOY_ROLE_ARN_OUTPUT = "DeployRoleArn";

export interface DeployAccessStackProps extends StackProps {
  readonly stage: Stage;
}

/**
 * GitHub Actions' way into the account: the GitHub OIDC identity provider and
 * one deploy role, so no long-lived access key exists (ADR-0009, Deploys).
 *
 * @remarks
 * The role may do one thing, assume the CDK bootstrap roles (`cdk-*`), which
 * carry the deploy permissions themselves; the owner chose that scope over
 * administrator access. Deployed by hand once, since the workflow needs it
 * before it can deploy anything.
 */
export class DeployAccessStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    { stage, ...props }: DeployAccessStackProps,
  ) {
    super(scope, id, props);
    const provider = new OidcProviderNative(this, "GitHubOidcProvider", {
      url: GITHUB_OIDC_URL,
      clientIds: ["sts.amazonaws.com"],
    });
    const role = new Role(this, "DeployRole", {
      roleName: `instant-composition-${stage}-deploy`,
      description: "Assumed by GitHub Actions on main to run cdk deploy",
      assumedBy: new WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": DEPLOY_SUBJECT,
        },
      }),
    });
    role.addToPolicy(
      new PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [`arn:${Aws.PARTITION}:iam::${Aws.ACCOUNT_ID}:role/cdk-*`],
      }),
    );
    new CfnOutput(this, DEPLOY_ROLE_ARN_OUTPUT, { value: role.roleArn });
  }
}
