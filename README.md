# Redeploy to Contentstack Launch with Bitbucket Pipelines using Launch API

This repository demonstrates how to redeploy a Next.js application to **Contentstack Launch** using the [Launch Public API](https://www.contentstack.com/docs/developers/apis/launch-api) file upload with **Bitbucket Pipelines**. After the first deployment is done from the **Launch UI** or **Launch APIs**, the pipeline (`bitbucket-pipelines.yml`) runs on every push to `main` and redeploys the project using the script `deploy-api.js`.

---

## Prerequisites

The Launch API supports [**M2M**, **OAuth**, or **Authtoken**](https://www.contentstack.com/docs/developers/apis/launch-api#authentication). This example uses **M2M** (Client ID and Client Secret).

| Variable | Description |
|----------|-------------|
| `CONTENTSTACK_CLIENT_ID` | M2M or OAuth application ID |
| `CONTENTSTACK_CLIENT_SECRET` | M2M or OAuth application secret |
| `CONTENTSTACK_REGION` | Region: <small>`AWS_NA`, `AWS_EU`, `AWS_AU`, `AZURE_NA`, `AZURE_EU`, `GCP_NA`, `GCP_EU`</small> |
| `PROJECT_UID` | Launch project UID |
| `ENVIRONMENT_UID` | Launch environment UID |

## Deployment flow

1. **First deployment:** Perform the initial deployment from the **Launch UI** or **Launch APIs**. Create the project and deploy once.
2. **Subsequent deployments:** Every push to `main` redeploys the project automatically through this Bitbucket Pipelines pipeline.

## Quick start

1. Perform the first deployment from the **Launch UI** or **Launch APIs**.
2. Create an application with `launch:manage` or `launch.projects:write` scope (M2M is used in this example; OAuth and Authtoken are also supported by the API).
3. Clone or copy this repository and push the code to a Bitbucket repository.
4. Enable Pipelines: **Repository settings → Pipelines → Settings → Enable Pipelines**.
5. Add all required variables to Bitbucket repository variables or to `.env` for local runs.
6. Push to `main` to trigger a redeploy, or run `npm run deploy` locally.

**Running locally:** Copy `.env.example` to `.env`, enter your values, then run `npm run deploy`.

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

**Pipeline:** The file `bitbucket-pipelines.yml` runs on push to `main`: it checks out the code, runs `npm install form-data archiver dotenv`, then runs `node deploy-api.js`.

**Required variables** (Repository settings → Pipelines → Repository variables): `CONTENTSTACK_CLIENT_ID`, `CONTENTSTACK_CLIENT_SECRET`, `CONTENTSTACK_REGION`, `PROJECT_UID`, `ENVIRONMENT_UID`.

Mark `CONTENTSTACK_CLIENT_SECRET` as **Secured** so its value is masked in the build logs.

Two things to know when setting this up:

- Pipelines is **off by default**, and while it is off there is no **Pipelines** tab and no repository-variables screen. Enable it first, then add the variables.
- Enabling Pipelines does not build commits that are already pushed. Start the first run from **Pipelines → Run pipeline**, or with `git commit --allow-empty -m "Trigger pipeline" && git push`.

> Bitbucket also supports **deployment variables** (Repository settings → Pipelines → Deployments) if you want per-environment values. To use them, add a `deployment:` key to the step in `bitbucket-pipelines.yml`, for example `deployment: production`.

---

## What is included in the deployment zip

The deploy script (`deploy-api.js`) adds the **whole project** to the zip, except the entries listed in the two exclude arrays near the top of the file. Nothing has to be listed for a file to be deployed, so adding a folder such as `src`, `components` or `lib` to your project needs no change to the script.

**`EXCLUDE_ANYWHERE`** — skipped at every level of the project:

| Entry | Reason |
|-------|--------|
| `node_modules` | Launch installs dependencies from `package.json`. Uploading them wastes transfer, and platform-specific binaries built locally can fail on the build machine. |
| `.git` | Repository history is not needed to build the project. |
| `.next`, `dist`, `build`, `out` | Local build output, which Launch regenerates. |
| `.DS_Store` | Operating-system noise. |

**`EXCLUDE_AT_ROOT`** — skipped only at the project root, since the same names deeper in the tree are likely application code:

| Entry | Reason |
|-------|--------|
| `deploy-api.js` | The deploy script itself, not part of the application. |
| `bitbucket-pipelines.yml` | Read by Bitbucket, not by Launch. |
| `deployment.zip` | The archive being written, which must not contain itself. |
| `.gitignore` | Git configuration, unrelated to the build. |

Any name beginning with `.env` is excluded as well, so credentials are never uploaded. `.env.example` is kept, since it holds only placeholders.

**To customize:** Edit those arrays in `deploy-api.js` to exclude anything else that should not be deployed, for example a `tests` or `docs` folder.

---

## References

- [Launch API – Authentication](https://www.contentstack.com/docs/developers/apis/launch-api#authentication)
- [Contentstack OAuth](https://www.contentstack.com/docs/developers/developer-hub/contentstack-oauth)
- [Contentstack Launch API](https://www.contentstack.com/docs/developers/apis/launch-api)
- [Bitbucket Pipelines – Variables and secrets](https://support.atlassian.com/bitbucket-cloud/docs/variables-and-secrets/)
