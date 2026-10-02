import { Duration } from "aws-cdk-lib";
import { type IDistribution } from "aws-cdk-lib/aws-cloudfront";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { type IBucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, CacheControl, Source } from "aws-cdk-lib/aws-s3-deployment";
import { type Construct } from "constructs";

/**
 * The context key naming the web client's build, `apps/web/dist`, absolute or
 * relative to the working directory. Only a deploy that has run
 * `pnpm web:build` passes it; without it the `app` stack uploads nothing, so
 * synthesis never needs a build.
 */
export const WEB_DIST_CONTEXT = "web-dist";

/** Vite's fingerprinted output: a changed file gets a new name, never new bytes. */
const HASHED = "assets/*";

/** What the SPA's bucket and distribution are, and where the build is. */
export interface SpaDeploymentProps {
  readonly bucket: IBucket;
  readonly distribution: IDistribution;
  /** The web client's build directory, absolute or relative to the working directory. */
  readonly webDist: string;
}

/**
 * Upload the web build to the SPA bucket through CloudFormation, which the
 * CDK bootstrap roles run, so the deploy role needs no S3 or CloudFront
 * permission of its own.
 *
 * @remarks
 * Two uploads of the same build. The fingerprinted `assets/` go first, cached
 * for a year and never pruned, so a page loaded before a deploy can still
 * fetch its chunks. Everything else — `index.html` above all — goes after
 * them, revalidated on every request and pruned, and its upload invalidates
 * the distribution: CachingOptimized would otherwise keep the previous
 * `index.html`, which names the previous assets, for up to a day. Each
 * upload's filter also bounds its prune, so neither deletes the other's files.
 */
export function addSpaDeployment(
  scope: Construct,
  { bucket, distribution, webDist }: SpaDeploymentProps,
): BucketDeployment {
  const source = Source.asset(webDist);
  // One handler serves both uploads; without a group of its own its logs
  // would be kept forever.
  const logGroup = new LogGroup(scope, "SpaDeploymentLogs", {
    retention: RetentionDays.ONE_MONTH,
  });
  const common = {
    sources: [source],
    destinationBucket: bucket,
    logGroup,
    // A custom resource answers in 4 KB; one key per font file would outgrow it.
    outputObjectKeys: false,
  };

  const assets = new BucketDeployment(scope, "SpaAssets", {
    ...common,
    exclude: ["*"],
    include: [HASHED],
    prune: false,
    cacheControl: [
      CacheControl.setPublic(),
      CacheControl.maxAge(Duration.days(365)),
      CacheControl.immutable(),
    ],
  });
  const entry = new BucketDeployment(scope, "SpaEntry", {
    ...common,
    exclude: [HASHED],
    prune: true,
    cacheControl: [CacheControl.noCache()],
    distribution,
    distributionPaths: ["/*"],
  });
  // index.html names the new assets, so it lands only once they are there.
  entry.node.addDependency(assets);
  return entry;
}
