# Deploy the observatory as static Cloudflare Pages

## Why

The research runtime currently depends on Node.js filesystem reads, while the public product only needs immutable rendered views. Shipping raw corpora or running a dynamic data service would add cost and expose unnecessary data.

## What

- Pre-render one self-contained HTML route for every compact community artifact.
- Make community switching use static `/r/<subreddit>/` routes in the Pages build.
- Emit security and cache headers with the static output.
- Keep raw corpora, reports, caches, and generated `dist/` output out of Git.
- Document the Cloudflare Pages build command and output directory.

## Out of scope

- Creating a Cloudflare project or deploying it.
- Adding R2, KV, D1, Pages Functions, accounts, or authentication.
- Fetching or enriching Reddit data during a Pages build.
