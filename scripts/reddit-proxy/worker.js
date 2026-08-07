// Reddit JSON proxy with OAuth — runs from Cloudflare's IPs.
// Uses script-app OAuth flow (free tier, 100 queries/min).
// Secrets: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET (set via wrangler secret put)

const REDDIT_BASE = "https://www.reddit.com";
const UA = "reddit-insights/0.1 (by /u/sarthak_research)";

let cachedToken = null;
let tokenExpiry = 0;

async function getOAuthToken(env) {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const creds = btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`);
  const params = new URLSearchParams({
    grant_type: "password",
    username: env.REDDIT_USERNAME,
    password: env.REDDIT_PASSWORD,
  });
  const res = await fetch(`${REDDIT_BASE}/api/v1/access_token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${creds}`,
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token fetch failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/") {
      return new Response("reddit-proxy ok (oauth)", { status: 200 });
    }

    // OPTIONS for CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    try {
      const token = await getOAuthToken(env);
      const redditUrl = `${REDDIT_BASE}${url.pathname}${url.search}`;
      const res = await fetch(redditUrl, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "User-Agent": UA,
          "Accept": "application/json",
        },
        redirect: "follow",
      });

      const body = await res.text();
      const headers = new Headers({
        "Content-Type": res.headers.get("content-type") || "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      });

      // Pass through rate limit headers
      for (const h of ["x-ratelimit-remaining", "x-ratelimit-reset", "x-ratelimit-used"]) {
        const v = res.headers.get(h);
        if (v) headers.set(h, v);
      }

      return new Response(body, { status: res.status, headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: "proxy_error", message: err.message }), {
        status: 502,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
  },
};
