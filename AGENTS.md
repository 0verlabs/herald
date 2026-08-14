# Herald monorepo

Bun + Turborepo monorepo for Herald (agentic commerce on 0G). Root package is `herald`; workspaces live in `packages/*` and are named `@hrld/<name>`.

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `regenerate-sdk`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful.

Examples: `fix(chat): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Dependencies

- **Shared stack deps come from the catalog.** pinned once in root `package.json` → `workspaces.catalog`. In packages, reference them as `"react": "catalog:"` and run `bun install`. `bun add` does NOT write `catalog:` references — this is the one case where you check the package version using `bun pm view <package-name>` and add it to package.json by hand. New shared deps get an exact version added to the catalog first.
- **Never hand-write dependency versions in package.json.** For anything not in the catalog, use `bun add <pkg>` / `bun add -d <pkg>` in the target package. `bunfig.toml` enforces exact versions.
- **Bun everywhere**: `bun`/`bunx`, never `npm`/`npx`/`node`. Scaffold new packages with `bun create <template>` when one exists (e.g. `bun create hono@latest`, `bunx create-tsrouter-app@latest`).

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible, use `.catch(() => {})`. Applicable only for Promises.
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

Avoid single line `if` statement brackets

```ts
// Good
if (condition) return 1

// Bad
if (condition) {
  return 1
}
````

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions

### Zod

Typing for entities must be inferred from zod schema (schema first)
Use camelCase for schema fields.

```ts
export const userSchema = z.object({
  id: z.string(),
  createdAt: z.date()
  // ...
})

export type User = z.infer<typeof userSchema>
````

#### Drizzle

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible, you shouldn't be using globalThis.\* at all unless it's the only option.
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do not run tests from root`); run from package dirs like `packages/<name>`.

## Type Checking

- Always run `bun check:types` from package directories (e.g., `packages/<name>`), never `tsc` directly.

## UI: shadcn/ui

UI code uses shadcn/ui (https://ui.shadcn.com) on Tailwind. Shared components live in `packages/ui` (see its `components.json`); frontend packages import them via `@hrld/ui/components/<name>`. Add a component from inside `packages/ui` using `bunx --bun shadcn@latest add <component>` and strictly don't modify shadcn component code (except formatting or linting rules). Use the `shadcn` skill when adding, styling, or composing components instead of hand-rolling them.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `0verlabs/herald`, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
