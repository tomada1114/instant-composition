import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
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
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  type IBucket,
} from "aws-cdk-lib/aws-s3";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { type Construct } from "constructs";

import { addApiFunction } from "./api-function";
import {
  FOUNDATION_PARAMETERS,
  type FoundationParameter,
  foundationParameterName,
} from "./foundation-parameters";
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

/** The stack output the `dev` URL is read from. */
export const WEB_URL_OUTPUT = "WebUrl";

/** The stack output the SPA bucket's name is read from, for the web build's upload. */
export const SPA_BUCKET_NAME_OUTPUT = "SpaBucketName";

/** The stack output the distribution's id is read from, for an invalidation. */
export const DISTRIBUTION_ID_OUTPUT = "DistributionId";

/**
 * The `SecureString` parameter the hosted web app client's secret is kept in.
 * The `app` stack does not create it: CloudFormation cannot write a
 * `SecureString`, and the client it belongs to comes with #156.
 */
export function webClientSecretParameterName(stage: Stage): string {
  return `/instant-composition/${stage}/app/web-client-secret`;
}

export interface AppStackProps extends StackProps {
  readonly stage: Stage;
  /**
   * The repository's root, absolute or relative to the working directory:
   * the function is bundled from `apps/api` and the catalog from `content/`.
   */
  readonly repositoryRoot: string;
}

/**
 * What is rebuilt often (ADR-0009): CloudFront in front of the SPA bucket
 * and, under `/api/*`, API Gateway's HTTP API and the API on Lambda.
 *
 * @remarks
 * Foundation's identifiers are read from Parameter Store by name when the
 * stack deploys, never through a CloudFormation export, so either stack
 * updates on its own and `foundation` knows nothing of this one.
 */
export class AppStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    { stage, repositoryRoot, ...props }: AppStackProps,
  ) {
    super(scope, id, props);
    const foundation = (parameter: FoundationParameter): string =>
      StringParameter.valueForStringParameter(
        this,
        foundationParameterName(stage, parameter),
      );

    const bucket = new Bucket(this, "SpaBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });
    const api = new HttpApi(this, "HttpApi", {
      description: `instant-composition ${stage}: the API behind CloudFront's /api/*`,
    });
    const distribution = this.addDistribution(bucket, api, stage);
    const webUrl = `https://${distribution.distributionDomainName}`;

    const handler = addApiFunction(this, {
      repositoryRoot,
      tableName: foundation(FOUNDATION_PARAMETERS.learnerTableName),
      tableArn: foundation(FOUNDATION_PARAMETERS.learnerTableArn),
      userPoolId: foundation(FOUNDATION_PARAMETERS.userPoolId),
      // Foundation's web client until #156 gives this URL a client of its own.
      clientId: foundation(FOUNDATION_PARAMETERS.webClientId),
      signInDomainUrl: foundation(FOUNDATION_PARAMETERS.signInDomainUrl),
      clientSecretParameter: webClientSecretParameterName(stage),
      webUrl,
    });
    api.addRoutes({
      path: "/{proxy+}",
      integration: new HttpLambdaIntegration("ApiIntegration", handler),
    });

    new CfnOutput(this, WEB_URL_OUTPUT, { value: webUrl });
    new CfnOutput(this, SPA_BUCKET_NAME_OUTPUT, { value: bucket.bucketName });
    new CfnOutput(this, DISTRIBUTION_ID_OUTPUT, {
      value: distribution.distributionId,
    });
  }

  /**
   * `/*` from the bucket, `/api/*` uncached from the HTTP API. Only managed
   * cache and origin request policies, and one function this distribution
   * alone uses: what the flat-rate Free plan admits.
   */
  private addDistribution(bucket: Bucket, api: HttpApi, stage: Stage): Distribution {
    // `Bucket` declares `isWebsite` optional where `IBucket` requires it, which
    // exactOptionalPropertyTypes refuses; the value is the same object.
    const origin: IBucket = bucket as IBucket;
    return new Distribution(this, "Distribution", {
      comment: `instant-composition ${stage}`,
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(origin),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            function: new EdgeFunction(this, "SpaFallback", {
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
            `${api.apiId}.execute-api.${this.region}.${this.urlSuffix}`,
            { protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY },
          ),
          viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });
  }
}
