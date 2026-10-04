# Deployment release checks

The deploy workflow accepts only a completed successful CI run for a push from this
repository's `main`. It checks out the CI event's full commit SHA, validates the event's
workflow path and checkout, and never downloads a PR artifact. AWS credentials arrive
only after the trusted build, synthesis and manifest verification. The OIDC job still
runs on the workflow's default `main` ref, which preserves the immutable subject in
`deploy-access`; the checkout explicitly selects the verified SHA instead of that ref.

`pnpm release web <sha>` labels the built web client. The API's bundling hook packages
`release.mjs` beside `index.mjs` and the catalog, with `release.json` naming the
checkout SHA and SHA256 of its code and catalog files. The wrapper verifies those bytes
at cold start and serves only that metadata on `GET /api/release`, without learner data,
credentials, authentication registration or model calls. Other requests reach the
unchanged API handler.

`pnpm release record <assembly> <sha>` writes `dist/release.json`: exact checkout, web,
API and catalog identity plus hashes for all assembly and web files. All three stack
deployments consume that synthesized assembly; no deploy rebuilds it. Verification fails
on SHA or hash disagreement before deployment. The manifest is appended to the workflow
summary, including on failure once recording succeeded.

The current-main guard queries GitHub with the job's read-only token just before AWS
credentials. A superseded completion is explicitly skipped; an unavailable or malformed
GitHub answer fails closed. Concurrency prevents simultaneous running deploys and does
not cancel an active CloudFormation update, but GitHub does not guarantee FIFO. Main can
advance during an active deployment: its smoke still verifies that candidate, and the
newest successful main CI completion reconciles the subsequent release. Pending GitHub
concurrency jobs can be superseded, so there is no claim that every intermediate commit
is deployed.

After CloudFormation and invalidation finish, `pnpm release smoke <outputs-file>` uses
the app's `WebUrl` through CloudFront. It fetches every web file and compares SHA256,
checks a client route against the built SPA entry, checks the API's served SHA and
code/catalog hashes, and expects the unauthenticated `/api/v1/home` error contract. Only
unauthenticated GET requests are sent: no model operation, learner registration or
learner mutation. Redirects, timeouts, wrong status, metadata or bytes fail the job. A
green synthesis alone remains insufficient evidence of a live release.

A hand deploy uses the same bundle wrapper but no web upload without `web-dist`. Rebuild
and record a fresh assembly when a release check fails; never edit a manifest or reuse
another SHA's successful CI to make it pass.
