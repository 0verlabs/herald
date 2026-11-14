# Run locally

```bash
vp run db:migrate:local         # apply D1 migrations to the local database
vp -C apps/facilitator run dev  # facilitator on http://localhost:8787 (GET /health)
vp -C apps/web dev              # dashboard on http://localhost:3000 (GET /api/health)
```

`vp run dev` starts every app at once. Both Workers keep local D1 and KV state in `.wrangler/state` at the repo root, so they share one local database, as they share one database per environment when deployed.

Both Workers need their secrets locally: copy `apps/facilitator/.dev.vars.example` and `apps/web/.dev.vars.example` to `.dev.vars` next to them, and fill in throwaway testnet keys and your QuickNode testnet endpoints.
