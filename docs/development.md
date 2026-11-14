# Development

Requirements: Node.js 22.18 or later and the [Vite+](https://viteplus.dev) CLI (`vp`). Vite+ downloads the pinned pnpm version itself.

```bash
vp install              # install dependencies; also generates worker-configuration.d.ts per Worker
vp check                # format, lint and type check the whole workspace
vp check --fix          # same, fixing formatting and autofixable lint issues
vp test                 # run every test (Workers tests run in the Cloudflare Vitest pool; core's are in packages/core/vite.workers.config.ts)
vp run ready            # check, test and build everything
vp -C packages/core run test:live  # check the network registry and MPC root keys against live chains
```
