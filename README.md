# 🔐 PR Human Verification

Prevent automated/bot PRs by requiring a [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) human check. Zero cost, ~10 minute setup.

**No Cloudflare tokens in GitHub. No GitHub tokens in Cloudflare.** The only shared secret is an HMAC key.

---

## How It Works

```
1. Contributor opens a PR
   → GitHub Action sets commit status to "pending"

2. Contributor comments:  /verify
   → Action replies with a personalized verification link

3. Contributor clicks the link → Cloudflare Turnstile challenge
   → Worker returns a signed HMAC token

4. Contributor pastes the token as a PR comment
   → Action verifies signature, username, repo, PR#, expiry
   → Sets commit status to "success" ✅

5. Branch protection enforces the "human-verified" status check
```

---

## Maintainer Setup

### Prerequisites

- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)

### 1. Generate HMAC secret (30 sec)

```bash
openssl rand -hex 32
```

Save the output — you need it in steps 2 and 4.

### 2. Deploy the Cloudflare Worker (3 min)

We deploy the Worker first so we know the exact hostname for Turnstile.

```bash
cd worker
wrangler login
wrangler secret put HMAC_SECRET   # paste hex string from step 1
wrangler deploy
```

Note the deployed URL (e.g. `https://pr-human-verify.yourname.workers.dev`).
The page won't work yet (Turnstile isn't configured) — that's fine.

### 3. Create a Turnstile widget (2 min)

1. [Cloudflare Dashboard → Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile)
2. **Add site** → widget mode: **Managed**
3. For **Domain**, enter your Worker hostname from step 2, e.g.:
   `pr-human-verify.yourname.workers.dev`
4. Copy the **Site Key** and **Secret Key**
5. Now set them on the Worker:

```bash
cd worker
# Edit wrangler.toml: set TURNSTILE_SITE_KEY to your Site Key
wrangler secret put TURNSTILE_SECRET_KEY   # paste Secret Key
wrangler deploy                            # redeploy with the site key
```

### 4. Add the GitHub Action to your repo (3 min)

1. Create `.github/workflows/pr-human-verify.yml` in your repository with the following content:

   ```yaml
   name: PR Human Verification

   on:
     pull_request:
       types: [opened, reopened, synchronize]
     issue_comment:
       types: [created]

   jobs:
     verify:
       uses: lknop/pr-stile/.github/workflows/pr-human-verify.yml@main
       with:
         event_name: ${{ github.event_name }}
         worker_url: ${{ vars.WORKER_URL }}
         verify_internal: ${{ vars.VERIFY_INTERNAL == 'true' }}
       secrets:
         HMAC_SECRET: ${{ secrets.HMAC_SECRET }}
   ```

2. Go to **Settings → Secrets and variables → Actions** and add:

   **Secrets tab:**
   - `HMAC_SECRET` → the hex string from step 1

   **Variables tab:**
   - `WORKER_URL` → your Worker URL from step 2, e.g. `https://pr-human-verify.yourname.workers.dev`
   - `VERIFY_INTERNAL` → (optional) set to `true` to also require verification from repo members and collaborators. By default only external contributors are verified.

3. **(Recommended)** Enforce via branch protection:
   **Settings → Branches → Add rule → Require status checks**
   - Search for and add: `human-verified`

---

## Contributor Experience

```
Contributor:  Opens PR
Bot:          ⏳ Status: "Comment /verify on this PR to prove you're human"

Contributor:  /verify
Bot:          🔐 Human Verification
              @contributor, please complete the verification:
              1. Click here to verify  ← (link with pre-filled username/repo/PR)
              2. Complete the Turnstile challenge
              3. Copy the token and paste it as a new comment on this PR

Contributor:  pr-verify:eyJ1Ijoib2N0b2N...
Bot:          ✅ @contributor has been verified as human. Thank you!
              Status: "success"
```

---

## Security Properties

- **HMAC-SHA256 signed tokens** — can't be forged without the shared secret
- **Bound to username + repo + PR number** — a token for one PR can't be reused on another
- **24-hour expiry** — stale tokens are rejected
- **Author-only** — only the PR author can submit `/verify` or a token
- **No cross-service credentials** — Cloudflare never touches GitHub, GitHub never touches Cloudflare

---

## Sharing One Worker Across Repos

Deploy the Worker once and reuse it across any number of repos. Each repo just
needs the workflow file and the `HMAC_SECRET` secret. If you want all repos to
share the same HMAC secret, you can set it as an **organization secret** in GitHub.

---

## Cost

| Service              | Free Tier              |
|----------------------|------------------------|
| Cloudflare Workers   | 100,000 requests/day   |
| Cloudflare Turnstile | Unlimited              |
| GitHub Actions       | 2,000 min/month (private), unlimited (public) |

---

## Files

```
worker/
  src/index.js       Cloudflare Worker (serves page + signing API)
  wrangler.toml      Worker configuration

.github/
  workflows/
    pr-human-verify.yml   Reusable workflow (all logic — reference this from other repos)
    pr-verify.yml         Thin caller for this repo (declares triggers, calls the reusable workflow)
```
