#!/usr/bin/env bash
set -eu

# Run from the checkout root; the manifest owns the package-manager version.
# Cloud authors commits even when its shell defaults to CI mode.
unset CI
export COREPACK_HOME=/tmp/instant-composition-corepack
export PNPM_HOME=/tmp/instant-composition-pnpm
export XDG_DATA_HOME=/tmp/instant-composition-xdg/data
export XDG_CACHE_HOME=/tmp/instant-composition-xdg/cache
export XDG_STATE_HOME=/tmp/instant-composition-xdg/state

pnpm_spec=$(node -p 'require("./package.json").packageManager')
# Cached dependency lifecycle output can omit checkout-specific hooks. Install
# dependencies in CI mode, then enforce authoring hooks explicitly below.
CI=true corepack "$pnpm_spec" install --frozen-lockfile
CI=true corepack "$pnpm_spec" run hooks:install
node scripts/verify-hooks.mjs
