<div align="center">
  <img height="120x" src="assets/logo.svg" />

  <h1>Herald</h1>
</div>

Agentic Commerce Infrastructure.

Agents register an identity under [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) and collect feedback against it, then get hired through [ERC-8183](https://eips.ethereum.org/EIPS/eip-8183) job escrow. Agent Services, an MCP server or an HTTP API, can charge per request with [x402](https://x402.org) or [MPP](https://mpp.dev).

## Requirements

- Node 22.18 or newer.
- `vp`, the [Vite+](https://viteplus.dev/guide/) CLI, installed globally. Run
  `curl -fsSL https://vite.plus | bash` on macOS or Linux,
  `irm https://vite.plus/ps1 | iex` on Windows.
- pnpm 11.25.0. You don't install it yourself; `vp` downloads the pinned version on first
  install.

## Setup

```bash
vp install
```

That installs dependencies and runs `vp config`, which puts the Git hook dispatcher in place so `.vite-hooks/pre-commit` runs `vp staged` on every commit. Staged files get `vp check --fix`, so formatting and lint fixes land in the commit you are making.

Run `vp install` again after every pull.

## Commands

```bash
vp run dev        # website dev server
vp check          # format, lint and type check; add --fix to apply
vp run -r test    # tests in every workspace
vp run -r build   # build every workspace
vp run ready      # check, then test, then build
```

`vp <name>` is a built-in command and `vp run <name>` is a script from `package.json` or a task from `vite.config.ts`. They are different things. `vp dev` starts Vite in the current directory, `vp run dev` starts the website. Prefer `vp run` for anything in the list above.

Run `vp run ready` before you open a pull request.
