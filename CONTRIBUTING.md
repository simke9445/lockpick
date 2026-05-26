# Contributing

Lockpick is pre-release. Keep changes small, generic, and backed by tests or command output.

## Before You Open a Change

- Read `AGENTS.md`.
- Do not add prompt-optimization behavior, command aliases, repository-specific defaults,
  compatibility layers, migration paths, or deprecated names.
- Do not add dependencies unless the supply-chain checks in `AGENTS.md` are satisfied.
- Keep public docs aligned with the CLI contract, library exports, generated instruction text, and
  tests.

## Local Checks

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun run lint
bun run check
```

## File Locks

This repository uses Lockpick for advisory file locks. Before editing files, acquire the narrowest
lock that covers the paths you will modify:

```bash
bun run --silent lockpick -- acquire <paths...> --reason "<intent>" --id-only
```

Expand and refresh the lock as needed, and use `git begin` / `git end` around staging and commits as
documented in `AGENTS.md`.

## Pull Requests

- Explain the user-visible behavior change.
- List tests and commands run.
- Include docs updates when command output, config fields, install behavior, or library exports
  change.
- Keep unrelated refactors out of the patch.
