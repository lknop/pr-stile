# 🔐 PR Human Verification

Blocks automated PRs by requiring contributors to complete a [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) CAPTCHA. Free, no external dependencies, ~10 minute setup.

---

## How it works

1. A PR is opened → bot sets a pending commit status and asks the contributor to run `/verify`
2. Contributor comments `/verify` → bot replies with a pre-filled link to a Cloudflare Worker page
3. Contributor completes the CAPTCHA → Worker issues an HMAC-signed token (username + repo + PR number + timestamp)
4. Contributor pastes the token as a PR comment → Action verifies the signature and fields → sets status to success

The Worker and the GitHub Action share only the HMAC secret — neither holds credentials for the other.

Repo members and collaborators are skipped by default. This is configurable via a repo variable.

---

## Setup

Prerequisites: a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`).

### 1. Generate an HMAC secret

```bash
openssl rand -hex 32
```

Save the output — it's needed in steps 2 and 4.

### 2. Deploy the Cloudflare Worker

Deploy first to get the hostname for Turnstile registration.

```bash
cd worker
wrangler login
wrangler secret put HMAC_SECRET   # paste the hex string from step 1
wrangler deploy
```

Note your Worker URL (e.g. `https://pr-human-verify.yourname.workers.dev`). The page won't work yet — that's expected.

### 3. Set up Turnstile

1. Go to [Cloudflare Dashboard → Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) and click **Add site**
2. Widget mode: **Managed**, hostname: your Worker hostname from step 2
3. Copy the Site Key and Secret Key, then update the Worker:

```bash
cd worker
# Edit wrangler.toml: set TURNSTILE_SITE_KEY to your Site Key
wrangler secret put TURNSTILE_SECRET_KEY   # paste Secret Key
wrangler deploy
```

### 4. Add the workflow to your repo

Create `.github/workflows/pr-human-verify.yml`:

```yaml
name: PR Human Verification

on:
  pull_request:
    types: [opened, reopened, synchronize]
  issue_comment:
    types: [created]

permissions:
  pull-requests: write
  statuses: write
  issues: write

jobs:
  verify:
    uses: lknop/pr-stile/.github/workflows/pr-human-verify.yml@master
    with:
      event_name: ${{ github.event_name }}
      worker_url: ${{ vars.WORKER_URL }}
      # verify_internal: 'true'  # optional: also verify repo members and collaborators
    secrets:
      HMAC_SECRET: ${{ secrets.HMAC_SECRET }}
```

In **Settings → Secrets and variables → Actions**, add:

- Secret `HMAC_SECRET` — the hex string from step 1
- Variable `WORKER_URL` — your Worker URL from step 2
- To require verification from repo members and collaborators as well, uncomment `verify_internal: 'true'` in the workflow above

### 5. Enforce via branch protection

Go to **Settings → Branches**, add a rule for your default branch, and enable **Require status checks to pass before merging**. Search for and add `human-verified`.

Also enable **Do not allow bypassing the above settings** if you want the check to apply to administrators too.

Note: the `human-verified` check only appears in the search after it has run at least once on the repo.

---

## What contributors see

```
Bot:          @contributor This PR requires human verification.
              Please comment `/verify` to get started.

Contributor:  /verify

Bot:          🔐 Human Verification
              @contributor, please complete the verification:
              1. Click here to verify  ← pre-filled link
              2. Complete the Turnstile challenge
              3. Paste the token as a new comment

Contributor:  pr-verify:eyJ1Ijoib2N0b2N...

Bot:          ✅ @contributor has been verified as human. Thank you!
```

The `/verify` exchange is removed from the PR after successful verification.

---

## Security properties

- **HMAC-SHA256 signed tokens** — cannot be forged without the shared secret
- **Bound to username, repo, and PR number** — a token cannot be reused on a different PR
- **24-hour expiry** — tokens issued more than 24 hours ago are rejected
- **Author-only** — only the PR author can submit `/verify` or a token

---

## Sharing one Worker across repos

Deploy the Worker once and reuse it across any number of repos — each repo only needs the workflow file and the `HMAC_SECRET`. For org-wide use, set `HMAC_SECRET` as an organization secret.

---

## Cost

| Service              | Free tier              |
|----------------------|------------------------|
| Cloudflare Workers   | 100,000 requests/day   |
| Cloudflare Turnstile | Unlimited              |
| GitHub Actions       | 2,000 min/month (private repos), unlimited (public) |

---

## Files

```
worker/
  src/index.js       Cloudflare Worker — serves the verification page and signs tokens
  wrangler.toml      Worker config

.github/workflows/
  pr-human-verify.yml   Reusable workflow containing all logic — reference this from other repos
  pr-verify.yml         Caller workflow for this repo
```
