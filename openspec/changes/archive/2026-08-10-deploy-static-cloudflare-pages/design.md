# Design

The checked-in compact artifacts remain the reproducible build input. A Node build script starts the existing renderer against those artifacts, requests every community view, rewrites only the community navigation target to a static route, and writes self-contained HTML.

```mermaid
flowchart LR
  A[Compact display artifacts] --> B[Existing Node renderer]
  B --> C[Static export build]
  C --> D[dist/index.html]
  C --> E[dist/r/community/index.html]
  D --> F[Cloudflare Pages]
  E --> F
```

The deployed output contains no raw JSON, compact JSON, embeddings, reports, or server process. Pages serves static assets from its edge cache.
