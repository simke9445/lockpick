# Lockpick

Lockpick is a standalone local advisory locking subsystem for shared repository worktrees. It
provides a `lockpick` CLI and a reusable TypeScript library for file-backed locks, short leases,
owner-only refresh and release, and a synthetic `@git/index` lock for staging and commit
coordination.

Lockpick is a generic contract and intentionally avoids repository-specific paths, command aliases,
or prompt-optimization behavior.

## Install

Install Lockpick into a host repository:

```bash
lockpick install
```

The install command is idempotent. It creates `.lockpick/locks/`, creates a `lockpick.config.ts`
when one is missing, inserts a marked Lockpick block into `AGENTS.md`, adds `.lockpick/` to
`.gitignore`, and adds recommended package scripts when a `package.json` exists. Use
`lockpick install --check --json` to inspect required changes without writing.

Recommended host scripts:

```json
{
  "scripts": {
    "lockpick": "lockpick",
    "lockpick:status": "lockpick status",
    "lockpick:install": "lockpick install"
  }
}
```

## CLI

Top-level commands are standalone Lockpick commands:

```text
lockpick acquire [paths...] --glob <pattern> --reason <text> --ttl-ms <n> --owner-session <id>
lockpick expand --lock <lock_id> [paths...] --glob <pattern> --ttl-ms <n> --owner-session <id>
lockpick refresh [lock_ids...] --lock <lock_id> --ttl-ms <n> --owner-session <id>
lockpick release [lock_ids...] --lock <lock_id> --owner-session <id>
lockpick status [paths...] --glob <pattern>
lockpick prune --dry-run
lockpick identify --owner-session <id>
lockpick capabilities --json
lockpick robot-docs guide
lockpick git begin --reason <text> --refresh-lock <lock_id> --ttl-ms <n> --owner-session <id>
lockpick git end [locks...] --lock <lock_id> --release-lock <lock_id> --owner-session <id>
lockpick install --check --json
```

Lock commands support `--json` and `--verbose`. Commands that return lock ids also support
`--id-only`. Success exits `0`. Invalid arguments, missing locks, ownership failures, and conflicts
exit non-zero. When `--json` is present, parse and runtime errors use
`{ "ok": false, "code": "...", "message": "..." }` where practical.
Unknown flag errors include a corrected `next:` command when Lockpick can infer the intended flag.

Use `lockpick capabilities --json` for the compact machine-readable CLI contract, including command
flags, mutation/read-only status, JSON support, defaults, environment variables, next commands, and
exit-code meanings. Current exit codes are:

| Code | Meaning |
| --- | --- |
| 0 | Success. |
| 1 | CLI parse error or install check drift. |
| 2 | Invalid lock input, missing lock id, or missing lock resource. |
| 3 | Lock conflict or ownership failure. |

Use `lockpick prune --dry-run --json` to inspect reclaimable expired locks before deleting them.
Use `lockpick robot-docs guide` for a concise in-tool agent workflow handbook.

## Workflow

Acquire the narrowest exact paths before editing:

```bash
lockpick acquire src/index.ts tests/cli.test.ts --reason "change CLI dispatch" --id-only
```

Expand before touching newly needed files:

```bash
lockpick expand --lock <lock_id> src/config.ts
```

Refresh before edit batches, after long tests, and before staging:

```bash
lockpick refresh <lock_id>
```

Coordinate staging and commit with the shared Git index:

```bash
lockpick git begin --refresh-lock <lock_id> --reason "commit Lockpick change" --id-only
lockpick git end <git_lock_id> --release-lock <lock_id>
```

Stage only paths covered by held locks and release locks promptly after the commit or handoff.

## Example AGENTS.md Snippet

```md
## Lockpick coordination

- Acquire exact file locks before edits with `lockpick acquire <paths...> --reason "<intent>"`.
- Expand before touching newly needed files with `lockpick expand --lock <lock_id> <paths...>`.
- Refresh before edit batches, after long tests, and before staging with `lockpick refresh <lock_id>`.
- Use `lockpick git begin --refresh-lock <lock_id> --reason "<commit intent>"` before staging or committing.
- Stage only owned paths and verify the staged diff before committing.
- Release locks promptly with `lockpick git end <git_lock_id> --release-lock <lock_id>` or `lockpick release <lock_id>`.
```

## Config

Host repositories may add `lockpick.config.ts` at the repository root:

```ts
import type { LockpickConfig } from "lockpick";

export default {
  projectName: "example",
  lockRoot: ".lockpick/locks",
  command: {
    executable: "lockpick",
  },
  defaults: {
    ttlMs: 600_000,
    maxTtlMs: 1_800_000,
    unknownLivenessGraceMs: 600_000,
  },
  owner: {
    envKeys: ["LOCKPICK_OWNER_SESSION", "LOCKPICK_SESSION_ID"],
    fallbackPrefix: "lockpick",
  },
  liveness: {
    adapter: "unknown",
  },
} satisfies LockpickConfig;
```

`command.prefix` can render host-specific instructions such as
`["bun", "run", "--silent", "lockpick", "--"]`. Owner detection checks explicit
`--owner-session`, configured environment keys, then a fallback id. The optional Codex-compatible
adapter can be enabled with config, but the generic core does not require Codex session metadata.

## Library

The public TypeScript API exports the registry, command executor, config helpers, install helpers,
resource matching, and lock types from `src/index.ts`:

```ts
import { FileLockRegistry, executeLockCommand } from "lockpick";
```

The lock record schema is current-version only. State defaults to ignored repo-local files under
`.lockpick/locks/active`, with registry mutation serialized by an atomic `.mutex` directory and
events appended to `.lockpick/locks/events.jsonl`.
