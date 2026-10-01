import { type Stack } from "aws-cdk-lib";
import { type HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function as EdgeFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  OriginProtocolPolicy,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { CfnSubscription } from "aws-cdk-lib/aws-pricingplanmanager";
import { type IBucket } from "aws-cdk-lib/aws-s3";

import { type Stage } from "./stage";

/**
 * The CloudFront Function that sends a client route to the SPA's entry: a
 * path whose last segment has no extension is a route, never a file Vite
 * emitted. A distribution-wide error response would do the same by status
 * code, but it would also rewrite the API's own 403 and 404 answers.
 */
const SPA_FALLBACK = `function handler(event) {
  var request = event.request;
  var last = request.uri.split("/").pop();
  if (last.indexOf(".") === -1) {
    request.uri = "/index.html";
  }
  return request;
}`;

/**
 * The CloudFront flat-rate plan tier the distribution is subscribed to.
 * CloudFormation refuses a tier change on an existing
 * subscription, so moving to Pro is done outside the stack first and this
 * value follows it.
 */
export const CLOUDFRONT_PLAN_TIER = "FREE";

export interface DistributionProps {
  readonly stage: Stage;
  readonly bucket: IBucket;
  readonly api: HttpApi;
  /**
   * The `CLOUDFRONT`-scope web ACL the distribution's plan requires, which
   * only us-east-1 can hold, so it arrives from the `edge` stack.
   */
  readonly webAclArn: string;
}

/**
 * `/*` from the bucket, `/api/*` uncached from the HTTP API, subscribed to
 * CloudFront's flat-rate plan. Only managed cache and origin request
 * policies, one function and one web ACL this distribution alone uses: what
 * the Free plan admits.
 *
 * @remarks
 * Every construct is created in `stack` itself, never in a child scope, so
 * moving this code never changes a deployed logical id.
 */
export function addDistribution(
  stack: Stack,
  { stage, bucket, api, webAclArn }: DistributionProps,
): Distribution {
  const distribution = new Distribution(stack, "Distribution", {
    comment: `instant-composition ${stage}`,
    defaultRootObject: "index.html",
    webAclId: webAclArn,
    defaultBehavior: {
      origin: S3BucketOrigin.withOriginAccessControl(bucket),
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: CachePolicy.CACHING_OPTIMIZED,
      functionAssociations: [
        {
          eventType: FunctionEventType.VIEWER_REQUEST,
          function: new EdgeFunction(stack, "SpaFallback", {
            code: FunctionCode.fromInline(SPA_FALLBACK),
            runtime: FunctionRuntime.JS_2_0,
            comment: "Serves index.html for a client route",
          }),
        },
      ],
    },
    additionalBehaviors: {
      // Every viewer header but Host goes through: the cookie path's Origin
      // check and the sign-in callback read Origin, Cookie, Authorization
      // and the query string. The app matches `/api/...` on the raw path,
      // so the path goes through unchanged.
      "/api/*": {
        origin: new HttpOrigin(
          `${api.apiId}.execute-api.${stack.region}.${stack.urlSuffix}`,
          { protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY },
        ),
        viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
    },
  });
  // Referencing the distribution creates the subscription after it and
  // deletes it first: a subscribed distribution cannot be deleted.
  new CfnSubscription(stack, "PricingPlan", {
    planFamily: "CloudFront",
    planTier: CLOUDFRONT_PLAN_TIER,
    usageLevel: "DEFAULT",
    resourceArns: [distribution.distributionArn, webAclArn],
  });
  return distribution;
}
