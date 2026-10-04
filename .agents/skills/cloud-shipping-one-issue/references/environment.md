# Cloud installation and service startup

## Install only what a task needs

The checked environment has Node 24.19.0, Corepack 0.34.6, Python 3.12.14, Git 2.52.0,
GitHub CLI 2.46.0, Docker 28.4.0 and Compose 2.40.3. These are observations, not new
version constraints. `.node-version` and `package.json` own the runtime/manager
requirements; currently Node 24.18.1 and pnpm 11.18.0. A saved environment supplying
Node 24.19.0 satisfies the documented development runtime. No `just` is needed.

The checked-in [install script](../scripts/install.sh) uses the manifest's package
manager pin and disposable writable cache paths. Run it from the repository root:

```sh
bash .agents/skills/cloud-shipping-one-issue/scripts/install.sh
```

For the environment settings Install script field, this is the complete launcher for the
checkout verified in this task:

```sh
set -eu
cd /workspace/instant-composition
bash .agents/skills/cloud-shipping-one-issue/scripts/install.sh
```

Adjust the checkout path if another environment places the repository elsewhere. The
helper must be present in the selected checkout; until this PR is merged, choose its
branch when testing the helper or paste the helper's contents after the `cd`. The script
installs dependencies with the frozen lockfile and retains the lifecycle/hook policy. It
installs dependencies and explicitly installs hooks in CI mode, then clears inherited
`CI` for verification, even for a cached dependency tree. Matching pnpm's CI mode for
both commands also preserves its virtual-store setting. An installation or verification
failure stops setup. These environment overrides affect only the script's processes. It
does not run the full suite, start services, log in, change credentials or deploy. The
`/tmp` paths fix the observed unavailable home cache directories. Exports affect that
script's process only: do not assume they persist into a later task shell. Reuse the
same cache exports in that task when necessary, without editing shell profiles.

## Start skill: leave unset by default

The
[official Cloud guide](https://learn.chatgpt.com/docs/environments/cloud-environments)
distinguishes dependency installation from starting services and checking readiness.
Ordinary edits, unit/component/script tests, lint, typecheck and CDK synthesis need no
service. Do not put issue selection, PR creation, full tests or a permanently running
dev server in the environment's Start skill.

Start DynamoDB Local only for a task that needs DB integration or the full source gate:

```sh
pnpm db:up
INSTANT_COMPOSITION_TEST_WORKERS=2 pnpm check:source
pnpm db:down
```

Compose's `--wait` establishes readiness; no AWS authentication is involved. Record
whether the task started the container, and stop it only if it did. An environment
dedicated to DB tasks may use a Start skill instructed to run `pnpm db:up` and confirm
its health, but that is optional configuration for the owner, not part of this change.

## Keep model calls local by default

The saved environment has an `API_OPENROUTER_API_KEY` variable. Do not inspect its
value, change the saved setting, or assume it authorizes paid requests. Tests and smoke
inject the stand-in. When a local dev server is actually needed, explicitly blank the
variable for that process:

```sh
API_OPENROUTER_API_KEY= pnpm dev
```

This preserves the saved value and overrides dotenv loading for that process. It selects
the scripted model instead of OpenRouter. Use the appropriate local test harness for
authentication; do not obtain real Cognito credentials as startup work.

## Access checks

The observed package-manager network policy permitted the dependency install and Git
transport; `gh` API calls returned `Forbidden`. The connected GitHub app successfully
read issues/PRs, opened a draft and read its CI. Discover its current capabilities
rather than hard-coding action names or assuming it exposes every review field.

The package-manager preset includes GitHub source/download hosts but not every API
subdomain. Check hostname authorization and API credentials separately; a direct
environment variable does not add allowed domains. The owner may choose targeted API
access later. This workflow never changes allowlists, network secrets or saved settings.
AWS CLI/login, actual resources, live providers and browser acceptance remain outside
the unauthenticated Cloud workflow.
