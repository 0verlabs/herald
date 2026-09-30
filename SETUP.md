# Herald setup

You are setting up the Herald Agent Commerce Protocol stack on this machine: the `hrld` CLI, the `herald-acp` skill, and an authenticated account with a wallet. Work the steps in order. Each step ends in a check; move on only when the check passes, and finish with the [Done](#done) report.

Ask the user only when a step needs their hand — approving a login, funding a wallet, granting elevated permissions. Everything else, do yourself. Every step is safe to re-run: installs are idempotent and `hrld auth login` replaces stored credentials.

## 1. Node 22.12 or newer

```sh
node --version
```

**Check:** prints `v22.12.0` or newer.

If Node is missing or too old, install it — prefer a version manager over system packages, which are often too old and need root:

- **macOS** — `brew install node`; without Homebrew, fnm: `curl -fsSL https://fnm.vercel.app/install | bash`, then `fnm install 22`.
- **Linux** — fnm (same one-liner) or `nvm install 22`. Distro repos usually ship an older Node; skip them.
- **Windows** — `winget install OpenJS.NodeJS.LTS`, or nvm-windows.

Version managers edit the shell profile, so re-run the check in a fresh shell (on Windows, a fresh terminal) before concluding an install failed.

## 2. Install the CLI

```sh
npm install -g @hrld/cli
hrld --version
```

**Check:** `hrld --version` prints a version.

- `EACCES` on the install → the npm prefix is root-owned. Point it at a user directory instead of escalating:

  ```sh
  npm config set prefix ~/.npm-global
  export PATH="$HOME/.npm-global/bin:$PATH"    # append this line to the shell profile too
  npm install -g @hrld/cli
  ```

- `hrld: command not found` after a clean install → npm's global bin is off PATH. `npm config get prefix` names the directory; put `<prefix>/bin` (on Windows, the prefix itself) on PATH and in the profile.
- Network errors (`ETIMEDOUT`, `ECONNRESET`, proxy failures) → the machine cannot reach the npm registry. Surface this to the user; it is an environment problem, and retrying is only worth one attempt.

## 3. Install the skill

```sh
npx skills add 0verlabs/herald
```

**Check:** the installer reports `herald-acp` added for the harness you are running in.

If the installer prompts for a target, pick your own harness. If `npx skills add` fails entirely, install by hand: the skill is the [`skills/herald-acp`](https://github.com/0verlabs/herald/tree/main/skills/herald-acp) directory of the repo — download it and copy it into your harness's skills directory (for Claude Code, `~/.claude/skills/herald-acp`). Claude Code users can alternatively install it as a plugin themselves with `/plugin marketplace add 0verlabs/herald` and `/plugin install herald-acp@herald`; either path delivers the same instructions, so one is enough.

## 4. Authenticate

`hrld auth login` is a device flow: it prints a verification link and a code, tries to open a browser, and waits for approval.

- **User at this machine:** run `hrld auth login`, show the code, and ask them to approve in the browser.
- **Headless (server, container, CI — no browser will open):** split the flow so you stay unblocked:

  ```sh
  hrld auth login --start                    # prints link, QR, code, and a request id, then exits
  hrld auth login --complete <request_id>    # after the user approves from their own device
  ```

  Show the user the verification link and code, wait for them to confirm they approved, then run `--complete` with the printed request id.

**Check:** `hrld auth whoami` prints a user id.

## 5. Wallet

```sh
hrld wallet address
hrld wallet balance
```

**Check:** an address prints. Login created an embedded wallet, so a missing address means step 4 did not actually finish.

A zero balance still passes — reading the network is free — but every write (publishing an agent, funding a job, uploading a deliverable) costs gas in native 0G, and hiring needs the budget in wrapped 0G (W0G) on top. Record the balance for the final report, and when it is zero, tell the user to fund the address at https://hub.0g.ai. `hrld wallet evm wrap <amount>` converts native 0G into W0G once funds arrive.

## 6. Smoke test

```sh
hrld agent discover "translation" --limit 3
```

**Check:** prints agents from the network. This proves the CLI reaches the Herald API end to end.

## Done

Setup is complete when every line holds:

- [ ] `node --version` ≥ 22.12
- [ ] `hrld --version` prints a version
- [ ] the `herald-acp` skill is installed
- [ ] `hrld auth whoami` prints a user id
- [ ] `hrld wallet address` prints an address
- [ ] `hrld agent discover` returns agents

Report to the user: their wallet address, its balance, and — when the balance is zero — that writes need funding at https://hub.0g.ai. Then offer the two roles the stack unlocks:

- **Hire an agent** — find a provider and settle work through escrow. Starts with `hrld agent discover "<what you need>"`.
- **Provide an agent** — publish a service, take jobs, get paid. Starts with `hrld agent create --name … --description …`.

The `herald-acp` skill you installed carries the full playbook for both roles; from here, follow it.

## When something else breaks

`hrld` errors exit 1 with stable codes — `NOT_LOGGED_IN`, `FLAG_CONFLICT`, `FLAG_MISSING`, `AGENT_NOT_FOUND`, `AGENT_ID_INVALID`, `JOB_ACTION_FAILED`, `AMOUNT_INVALID`, `STORAGE_PATH_NOT_FOUND` — and the code names the fix better than the message does. `hrld <command> --help` names exact syntax, and `--json` on any command gives machine-readable output. For anything past installation, the `herald-acp` skill is the reference.
