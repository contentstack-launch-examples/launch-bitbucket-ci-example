# Redeploy to Contentstack Launch with Bitbucket Pipelines using the Launch CLI

This repository demonstrates how to redeploy a Next.js application to **Contentstack Launch** using the **Contentstack CLI** (`csdx` with the `@contentstack/cli-launch` plugin) and **Bitbucket Pipelines**. After the first deployment is done from the **Launch UI** or **Launch APIs**, the pipeline (`bitbucket-pipelines.yml`) runs on every push to `main` and redeploys the project using the script `deploy.sh`.

---

## Prerequisites

The CLI logs in with a Contentstack username and password (optionally with MFA), not with an M2M/OAuth token.

| Variable | Description |
|----------|-------------|
| `CONTENTSTACK_REGION` | Region: <small>`AWS-NA`, `AWS-EU`, `AWS-AU`, `AZURE-NA`, `AZURE-EU`, `GCP-NA`, `GCP-EU`</small> |
| `CS_USERNAME` | Contentstack account email used to log in via the CLI |
| `CS_PASSWORD` | Password for that account |
| `CONTENTSTACK_MFA_SECRET` | Optional. Base32 TOTP secret — only needed if the account has MFA enabled |
| `PROJECT_UID` | Launch project UID |
| `ENVIRONMENT_UID` | Launch environment UID |
| `ORGANIZATION_UID` | Organization UID that owns the project |

## Deployment flow

1. **First deployment:** Perform the initial deployment from the **Launch UI** or **Launch APIs**. Create the project and deploy once.
2. **Subsequent deployments:** Every push to `main` runs `deploy.sh`, which installs the CLI, logs in, tells the CLI this is an existing project, and redeploys it. This happens automatically through this Bitbucket Pipelines pipeline.

## Quick start

1. Perform the first deployment from the **Launch UI** or **Launch APIs**.
2. Clone or copy this repository and push the code to a Bitbucket repository.
3. Enable Pipelines: **Repository settings → Pipelines → Settings → Enable Pipelines**.
4. Add all required variables to Bitbucket repository variables or to `.env` for local runs.
5. Push to `main` to trigger a redeploy, or run `npm run deploy` locally.

**Running locally:** Copy `.env.example` to `.env`, enter your values, then run `npm run deploy` (or `bash deploy.sh`).

## Pushing to Bitbucket

```bash
git init
git branch -M main
git add .
git commit -m "Initial commit"
git remote add origin git@bitbucket.org:<workspace>/<repo-name>.git
git push -u origin main
```

Bitbucket no longer accepts your Atlassian account password for Git over HTTPS, so use an SSH key:

```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
pbcopy < ~/.ssh/id_ed25519.pub
```

Add the **public** key at **Personal settings → SSH keys**, signed in as the account that owns the workspace, then verify with `ssh -T git@bitbucket.org`.

## Bitbucket Pipelines

**Pipeline:** The file `bitbucket-pipelines.yml` runs on push to `main`, on a `node:24` image, and simply runs `bash ./deploy.sh`. `deploy.sh` installs the Contentstack CLI and the `@contentstack/cli-launch` plugin fresh on every run, so the pipeline caches both `node` and the global npm modules directory (`npmglobal`) to speed that up.

**Required variables** (Repository settings → Pipelines → Repository variables): `CONTENTSTACK_REGION`, `CS_USERNAME`, `CS_PASSWORD`, `PROJECT_UID`, `ENVIRONMENT_UID`, `ORGANIZATION_UID`. Add `CONTENTSTACK_MFA_SECRET` too if the account has MFA enabled.

Mark `CS_PASSWORD` and `CONTENTSTACK_MFA_SECRET` as **Secured** so their values are masked in the build logs.

Two things to know when setting this up:

- Pipelines is **off by default**, and while it is off there is no **Pipelines** tab and no repository-variables screen. Enable it first, then add the variables.
- Enabling Pipelines does not build commits that are already pushed. Start the first run from **Pipelines → Run pipeline**, or with `git commit --allow-empty -m "Trigger pipeline" && git push`.

> The pipeline step in `bitbucket-pipelines.yml` already declares `deployment: production`, which is what makes **Deployments** (Repository settings → Pipelines → Deployments) available if you want per-environment variables instead of plain repository variables.

---

## What `deploy.sh` does

1. **Config:** loads `.env` when run locally (a no-op in CI, where variables come from Bitbucket instead), and checks that all required variables are set.
2. **Isolated credential store:** points the CLI's config at a directory outside the repo (`CS_CLI_CONFIG_PATH`, default `/tmp/csdx-ci`) so a live session token never ends up inside the project that gets zipped and uploaded. It's removed again on exit, along with the CLI session, `.cs-launch.json`, and the deployment zip the CLI creates.
3. **CLI install:** installs `@contentstack/cli` and the `@contentstack/cli-launch` plugin (opt-in, not bundled with the CLI).
4. **Region:** runs `csdx config:set:region` for the given `CONTENTSTACK_REGION`. This must happen before login, since setting the region logs the CLI out.
5. **Login:** runs `csdx auth:login` with `CS_USERNAME` / `CS_PASSWORD`, deriving a TOTP code from `CONTENTSTACK_MFA_SECRET` if it's set.
6. **Existing project:** writes a `.cs-launch.json` describing the project, organization, and environment, with an empty `deployments` array (required by the CLI, since it appends to that array).
7. **Deploy:** runs `csdx launch --data-dir "$PWD" --type FileUpload --environment "$ENVIRONMENT_UID" --redeploy-latest`, which zips the project, uploads it, and creates the deployment with no prompts, streaming logs until it succeeds or fails.

## What is included in the deployment zip

The zip is built by the CLI itself (`csdx launch`), not by a script in this repo, so the exclude list can't be customized here. The CLI always excludes: `logs`, `.next`, `node_modules`, `.cs-launch.json`, `.git`, `.env`, `.env.local`, `.vscode`. Launch installs dependencies and builds the project itself, so no local build or `node_modules` upload is needed.

---

## References

- [Contentstack CLI](https://www.contentstack.com/docs/developers/cli)
- [Contentstack Launch](https://www.contentstack.com/docs/developers/launch)
- [Bitbucket Pipelines – Variables and secrets](https://support.atlassian.com/bitbucket-cloud/docs/variables-and-secrets/)
