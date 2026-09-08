#!/usr/bin/env bash
set -euo pipefail

# Local runs: pick up .env if present. Not present in CI, so this is a no-op there.
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

# --- required config -------------------------------------------------------
: "${CONTENTSTACK_REGION:?Missing CONTENTSTACK_REGION}"
: "${CS_USERNAME:?Missing CS_USERNAME}"
: "${CS_PASSWORD:?Missing CS_PASSWORD}"
: "${PROJECT_UID:?Missing PROJECT_UID}"
: "${ENVIRONMENT_UID:?Missing ENVIRONMENT_UID}"
: "${ORGANIZATION_UID:?Missing ORGANIZATION_UID}"
# optional: CONTENTSTACK_MFA_SECRET (base32 TOTP secret, if the account has MFA)

# Credential store MUST live outside the repo — everything inside it gets zipped
# and uploaded, and this directory holds a live session token.
export CS_CLI_CONFIG_PATH="${CS_CLI_CONFIG_PATH:-/tmp/csdx-ci}"
mkdir -p "$CS_CLI_CONFIG_PATH"

cleanup() {
  csdx auth:logout --yes >/dev/null 2>&1 || true
  rm -f "$PWD/.cs-launch.json"
  find "$PWD" -maxdepth 1 -name "*_$(basename "$PWD").zip" -delete 2>/dev/null || true
  rm -rf "$CS_CLI_CONFIG_PATH"
}
trap cleanup EXIT

# --- 0. CLI ----------------------------------------------------------------
# launch is an opt-in plugin, not bundled with the CLI. Pin both for reproducible CI.
npm install -g @contentstack/cli@latest
csdx plugins:install @contentstack/cli-launch

# --- 1. region -------------------------------------------------------------
# Must run BEFORE login: config:set:region force-logs-out the CLI.
case "$CONTENTSTACK_REGION" in
  AWS-NA|AWS-EU|AWS-AU|AZURE-NA|AZURE-EU|GCP-NA|GCP-EU)
    csdx config:set:region "$CONTENTSTACK_REGION"
    ;;
  STAGE)  # dev11 — custom region; launch host derives to dev-launch-api.csnonprod.com
    csdx config:set:region \
      --name "dev11" \
      --cma  "dev11-api.csnonprod.com" \
      --cda  "dev11-cdn.csnonprod.com" \
      --ui-host "dev11-app.csnonprod.com"
    ;;
  *)
    echo "Unknown CONTENTSTACK_REGION: $CONTENTSTACK_REGION" >&2
    echo "Use one of: AWS-NA AWS-EU AWS-AU AZURE-NA AZURE-EU GCP-NA GCP-EU STAGE" >&2
    exit 1
    ;;
esac

# --- 2. login --------------------------------------------------------------
# Reads CONTENTSTACK_MFA_SECRET from the env and derives a fresh TOTP code.
csdx auth:login --username "$CS_USERNAME" --password "$CS_PASSWORD"

# --- 3. tell the CLI this is an existing project ---------------------------
# "deployments" MUST be present as an array: createNewDeployment() pushes onto it
# unconditionally (src/adapters/base-class.ts:106) and crashes if it's undefined.
cat > "$PWD/.cs-launch.json" <<EOF
{
  "project": {
    "uid": "$PROJECT_UID",
    "organizationUid": "$ORGANIZATION_UID",
    "projectType": "FILEUPLOAD",
    "environments": [{ "uid": "$ENVIRONMENT_UID" }],
    "deployments": []
  }
}
EOF

# --- 4. deploy -------------------------------------------------------------
# Uploads the whole repo minus the CLI's excludes:
#   [logs .next node_modules .cs-launch.json .git .env .env.local .vscode]
# Launch installs and builds the source itself, so no local build is needed.
# --redeploy-latest = zip + signed-url upload + create deployment, no prompts.
# Streams deployment logs and exits non-zero on FAILED/CANCELLED.
csdx launch \
  --data-dir "$PWD" \
  --type FileUpload \
  --environment "$ENVIRONMENT_UID" \
  --redeploy-latest
