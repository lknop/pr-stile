// Cloudflare Worker: PR Human Verification
//
// Serves the Turnstile challenge page and signs verification tokens.
// Does NOT need any GitHub credentials — it only signs tokens.
//
// Environment variables (set via `wrangler secret put`):
//   TURNSTILE_SECRET_KEY  – from Cloudflare Turnstile dashboard
//   HMAC_SECRET           – random hex string (shared with GitHub Actions)
//
// Environment variables (set in wrangler.toml):
//   TURNSTILE_SITE_KEY    – public site key from Turnstile dashboard

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(
        HTML_PAGE(env.TURNSTILE_SITE_KEY || "MISSING_SITE_KEY"),
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    if (request.method === "POST" && url.pathname === "/api/verify") {
      return handleVerify(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};

// ── Signing API ──────────────────────────────────────────────────────────────

async function handleVerify(request, env) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    const body = await request.json();
    const { turnstileToken, username, repo, prNumber } = body;

    if (!turnstileToken || !username || !repo || !prNumber) {
      return Response.json(
        { error: "Missing required fields" },
        { status: 400, headers }
      );
    }

    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
      return Response.json(
        { error: "Invalid repo format, use owner/repo" },
        { status: 400, headers }
      );
    }

    // Verify Turnstile with Cloudflare
    const turnstileOk = await verifyTurnstile(
      turnstileToken,
      env.TURNSTILE_SECRET_KEY,
      request
    );
    if (!turnstileOk) {
      return Response.json(
        { error: "Turnstile verification failed" },
        { status: 403, headers }
      );
    }

    // Create signed token
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      u: username.toLowerCase(),
      r: repo.toLowerCase(),
      pr: parseInt(prNumber, 10),
      ts: timestamp,
    };

    const signature = await hmacSign(JSON.stringify(payload), env.HMAC_SECRET);
    const token = btoa(JSON.stringify({ ...payload, sig: signature }));

    return Response.json({ token: `pr-verify:${token}` }, { headers });
  } catch (err) {
    return Response.json(
      { error: "Internal error" },
      { status: 500, headers }
    );
  }
}

async function verifyTurnstile(token, secretKey, request) {
  const ip = request.headers.get("CF-Connecting-IP");
  const form = new URLSearchParams();
  form.append("secret", secretKey);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);

  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: form }
  );
  const data = await res.json();
  return data.success === true;
}

async function hmacSign(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// ── HTML Page ────────────────────────────────────────────────────────────────

function HTML_PAGE(siteKey) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PR Human Verification</title>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0d1117; color: #c9d1d9;
    display: flex; justify-content: center; align-items: center;
    min-height: 100vh; padding: 1rem;
  }
  .card {
    background: #161b22; border: 1px solid #30363d; border-radius: 12px;
    padding: 2rem; max-width: 480px; width: 100%;
  }
  h1 { font-size: 1.4rem; margin-bottom: .25rem; color: #f0f6fc; }
  .subtitle { color: #8b949e; font-size: .9rem; margin-bottom: 1.5rem; }
  .prefilled {
    margin-bottom: 1rem; padding: .75rem; background: #0d1117;
    border: 1px solid #30363d; border-radius: 6px; font-size: .85rem;
    line-height: 1.8;
  }
  .prefilled .label { color: #8b949e; }
  .prefilled .value { color: #58a6ff; font-weight: 600; }
  .turnstile-box { margin: 1.25rem 0; }
  button {
    width: 100%; padding: .7rem; background: #238636; color: #fff;
    border: none; border-radius: 6px; font-size: 1rem; cursor: pointer;
    font-weight: 600;
  }
  button:hover { background: #2ea043; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .result {
    margin-top: 1.25rem; padding: 1rem; background: #0d1117;
    border: 1px solid #30363d; border-radius: 6px; display: none;
  }
  .result.show { display: block; }
  .result h3 { font-size: .85rem; color: #3fb950; margin-bottom: .5rem; }
  .token-box {
    word-break: break-all; font-family: monospace; font-size: .8rem;
    background: #161b22; padding: .75rem; border-radius: 4px;
    border: 1px solid #30363d; color: #79c0ff; max-height: 120px;
    overflow-y: auto; margin-bottom: .75rem;
  }
  .copy-btn {
    background: #21262d; font-size: .85rem; padding: .45rem .75rem;
    width: auto; display: inline-block; border: 1px solid #30363d;
  }
  .copy-btn:hover { background: #30363d; }
  .error { color: #f85149; font-size: .85rem; margin-top: .75rem; }
  .instructions {
    margin-top: 1rem; padding: .75rem; background: #0d1117;
    border-radius: 6px; font-size: .8rem; color: #8b949e;
    border: 1px solid #30363d; line-height: 1.5;
  }
  .missing { text-align: center; padding: 2rem 1rem; line-height: 1.8; }
  .missing code {
    color: #79c0ff; background: #0d1117; padding: .15rem .4rem;
    border-radius: 3px; font-size: .9rem;
  }
  a { color: #58a6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="card">
  <h1>PR Human Verification</h1>
  <p class="subtitle">Complete the challenge, then paste the token as a comment on your PR.</p>
  <div id="content"></div>
</div>

<script>
  const params = new URLSearchParams(window.location.search);
  const username = params.get("username");
  const repo = params.get("repo");
  const pr = params.get("pr");
  const contentEl = document.getElementById("content");

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  if (!username || !repo || !pr) {
    contentEl.innerHTML =
      '<div class="missing">' +
        "<p>This page is opened via a link posted by the<br>" +
        "<strong>pr-human-verify</strong> GitHub Action on your PR.</p>" +
        '<p style="margin-top:1rem;color:#8b949e;">' +
        "Comment <code>/verify</code> on your pull request to get started.</p>" +
      "</div>";
  } else {
    let turnstileToken = null;

    contentEl.innerHTML =
      '<div class="prefilled">' +
        '<span class="label">User:</span> <span class="value">' + esc(username) + "</span><br>" +
        '<span class="label">Repo:</span> <span class="value">' + esc(repo) + "</span><br>" +
        '<span class="label">PR:</span> <span class="value">' +
          '<a href="https://github.com/' + esc(repo) + "/pull/" + esc(pr) + '" target="_blank">#' + esc(pr) + "</a>" +
        "</span>" +
      "</div>" +
      '<div class="turnstile-box">' +
        '<div class="cf-turnstile" data-sitekey="${siteKey}" data-theme="dark" data-callback="onTurnstile"></div>' +
      "</div>" +
      '<button id="submit" disabled>Verify &amp; Get Token</button>' +
      '<div id="error" class="error"></div>' +
      '<div id="result" class="result">' +
        '<h3>Your verification token:</h3>' +
        '<div id="token" class="token-box"></div>' +
        '<button class="copy-btn" onclick="copyToken()">Copy to clipboard</button>' +
        '<div class="instructions">' +
          "Paste this <strong>entire string</strong> as a comment on " +
          '<a href="https://github.com/' + esc(repo) + "/pull/" + esc(pr) + '" target="_blank">' +
            esc(repo) + "#" + esc(pr) +
          "</a>. The token expires in <strong>24 hours</strong>." +
        "</div>" +
      "</div>";

    window.onTurnstile = function(token) {
      turnstileToken = token;
      document.getElementById("submit").disabled = false;
    };

    document.getElementById("submit").addEventListener("click", async function() {
      var errEl = document.getElementById("error");
      var resEl = document.getElementById("result");
      var btn = document.getElementById("submit");
      errEl.textContent = "";
      resEl.classList.remove("show");
      btn.disabled = true;
      btn.textContent = "Verifying\\u2026";

      try {
        var res = await fetch(window.location.origin + "/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            turnstileToken: turnstileToken,
            username: username,
            repo: repo,
            prNumber: pr,
          }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || "Verification failed");

        document.getElementById("token").textContent = data.token;
        resEl.classList.add("show");
      } catch (err) {
        errEl.textContent = err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = "Verify & Get Token";
        if (window.turnstile) turnstile.reset();
        turnstileToken = null;
        btn.disabled = true;
      }
    });
  }

  function copyToken() {
    navigator.clipboard.writeText(document.getElementById("token").textContent).then(function() {
      var b = document.querySelector(".copy-btn");
      b.textContent = "Copied!";
      setTimeout(function() { b.textContent = "Copy to clipboard"; }, 2000);
    });
  }
</script>
</body>
</html>`;
}
