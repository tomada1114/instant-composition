#!/usr/bin/env bash
set -eu

# Run from the checkout root; the manifest owns the package-manager version.
export COREPACK_HOME=/tmp/instant-composition-corepack
export PNPM_HOME=/tmp/instant-composition-pnpm
export XDG_DATA_HOME=/tmp/instant-composition-xdg/data
export XDG_CACHE_HOME=/tmp/instant-composition-xdg/cache
export XDG_STATE_HOME=/tmp/instant-composition-xdg/state

pnpm_spec=$(node -p 'require("./package.json").packageManager')
exec corepack "$pnpm_spec" install --frozen-lockfile
