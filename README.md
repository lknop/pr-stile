# 🔐 PR Human Verification

Blocks automated PRs by making contributors complete a [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) CAPTCHA. Free, no external dependencies, ~10 minute setup.

---

## How it works

When a PR is opened, the bot sets a pending commit status and asks the contributor to run `/verify`. They get a pre-filled link to a Cloudflare Worker page where they complete the CAPTCHA. The Worker signs a token with an HMAC key shared with the GitHub Action — no OAuth tokens cross between the two services. The contributor pastes the token as a PR comment, the Action checks the signature and a few fields (username, repo, PR number, 24h expiry), and sets the status to success.

Repo members and collaborators are skipped by default and don't need to verify. You can change this with a repo variable.

---

## Setup

You'll need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`).

### 1. Generate an HMAC secret

```bash
openssl rand -hex 32
```

Keep this — you'll use it in steps 2 and 4.

### 2. Deploy the Cloudflare Worker

Deploy first so you have the hostname to register with Turnstile.

```bash
cd worker
wrangler login
wrangler secret put HMAC_SECRET   # paste the hex string from step 1
wrangler deploy
```

Note your Worker URL, e.g. `https://pr-human-verify.yourname.workers.dev`. The page won't work yet — that's fine.

### 3. Set up Turnstile

1. Go to [Cloudflare Dashboard → Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) and click **Add site**
2. Widget mode: **Managed**, domain: your Worker hostname from step 2
3. Copy the Site Key and Secret Key, then configure the Worker:

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

jobs:
  verify:
    uses: lknop/pr-stile/.github/workflows/pr-human-verify.yml@master
    with:
      event_name: ${{ github.event_name }}
      worker_url: ${{ vars.WORKER_URL }}
      verify_internal: ${{ vars.VERIFY_INTERNAL == 'true' }}
    secrets:
      HMAC_SECRET: ${{ secrets.HMAC_SECRET }}
```

Then in **Settings → Secrets and variables → Actions**, add:

- Secret `HMAC_SECRET` — the hex string from step 1
- Variable `WORKER_URL` — your Worker URL from step 2
- Variable `VERIFY_INTERNAL` — set to `true` if you want to require verification from members and collaborators too (optional)

To actually block merging, go to **Settings → Branches → Add rule → Require status checks** and add `human-verified`.

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

The `/verify` exchange is cleaned up after a successful verification.

---

## Sharing one Worker across repos

Deploy the Worker once and point as many repos at it as you like — each repo just needs the workflow and the `HMAC_SECRET`. For org-wide use, set `HMAC_SECRET` as an organization secret so you don't have to repeat it everywhere.

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
  pr-human-verify.yml   Reusable workflow with all the logic — reference this from other repos
  pr-verify.yml         Caller workflow for this repo
```
