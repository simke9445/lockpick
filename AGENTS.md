# Repository instructions for agents

Lockpick is a standalone Bun/TypeScript advisory locking CLI and library. Keep defaults generic:
do not add prompt-optimization behavior, command aliases, or repository-specific defaults.

## Product maturity policy

Lockpick is not live yet. Do not add compatibility layers, migration paths, deprecated aliases, or
fallback behavior for previous internal layouts, schemas, CLI flags, actor outputs, or report
formats. When a contract changes, update the implementation, tests, docs, skill instructions, and
wiki in place to the new contract.

## Commit policy

Make a commit every time a chunk of logic is implemented and unit tested. Do this whether you are
working on a branch or inside a worktree: each passing unit-tested chunk gets its own commit before
moving on to the next.

## Dependency policy

When adding or recommending third-party packages, use `bun` for dependency resolution and package
inspection (`bun add`, `bun pm view`, `bun outdated`). Do not add a package version published less
than seven days ago. Record package age evidence (publish timestamp from `bun pm view <pkg>` or the
registry) before adopting a new dependency, and prefer mature, widely used packages over new or
obscure packages to reduce Shai-Hulud-style supply-chain risk.

## File locking policy

This repository uses Lockpick advisory locks for multi-agent editing. Before modifying tracked or
untracked repository files, acquire a current lock for the exact repo-relative paths or narrowest
globs you expect to mutate.

```bash
bun run --silent lockpick -- acquire <paths...> --reason "<intent>" --id-only
```

If new files become necessary, expand the existing lock before touching them:

```bash
bun run --silent lockpick -- expand --lock <lock_id> <paths...>
```

Refresh held locks before edit batches, after long-running commands, and before staging:

```bash
bun run --silent lockpick -- refresh <lock_id>
```

Before staging or committing, refresh held file locks and acquire the synthetic Git-index lock:

```bash
bun run --silent lockpick -- git begin --refresh-lock <lock_id> --reason "<commit intent>" --id-only
```

Stage only paths covered by held locks. Do not use broad staging commands unless every staged path
is covered. Release locks promptly after the commit or when abandoning work:

```bash
bun run --silent lockpick -- git end <git_lock_id> --release-lock <lock_id>
```

## Development

- Use `bun install` for dependencies.
- Run `bun test`, `bun run typecheck`, `bun run lint`, and `bun run check` before handoff when
  behavior changes.
- Keep tests focused on file-backed lock semantics, CLI parsing/rendering, config loading, install
  idempotency, and generated instruction text.
- Keep docs aligned with the public CLI and the library API.
