import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import { CfnWebACL } from "aws-cdk-lib/aws-wafv2";
import { type Construct } from "constructs";

import { type Stage } from "./stage";

/**
 * The stack output the `app` stack reads the distribution's web ACL ARN from,
 * across Regions, with `Fn::GetStackOutput`.
 */
export const WEB_ACL_ARN_OUTPUT = "WebAclArn";

export interface EdgeStackProps extends StackProps {
  readonly stage: Stage;
}

/**
 * What CloudFront needs from us-east-1: the `CLOUDFRONT`-scope AWS
 * WAF web ACL the distribution's flat-rate plan requires, which can exist in
 * no other Region.
 *
 * @remarks
 * The web ACL allows every request and holds no rule. A plan needs one
 * associated with its distribution for as long as the subscription lasts, and
 * `dev` has no WAF rules. A rule added later counts against the
 * Free plan's five, and a rule group of our own (`AWS::WAFv2::RuleGroup`) is
 * a configuration no plan admits.
 */
export class EdgeStack extends Stack {
  constructor(scope: Construct, id: string, { stage, ...props }: EdgeStackProps) {
    super(scope, id, props);
    const webAcl = new CfnWebACL(this, "DistributionWebAcl", {
      scope: "CLOUDFRONT",
      description: `instant-composition ${stage}: the web ACL of the distribution flat-rate plan`,
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName: `instant-composition-${stage}-distribution`,
      },
    });
    new CfnOutput(this, WEB_ACL_ARN_OUTPUT, { value: webAcl.attrArn });
  }
}
