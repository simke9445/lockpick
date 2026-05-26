# Lockpick CLI Map

Run id: `20260526T142530Z`

## Executive Summary

Lockpick is a standalone Bun/TypeScript advisory locking CLI and library for shared repository
worktrees. The CLI is currently small and direct: Bun entrypoint -> Commander parser -> lock or
install handler -> file-backed registry/install implementation -> compact text or JSON output.

Baseline status on 2026-05-26:

| Check | Result |
| --- | --- |
| `bun test` | 21 tests passing |
| `bun run typecheck` | passing |
| `bun run lint` | passing |
| `bun run --silent lockpick -- status --verbose` | `No active locks.` |

## Entry Points

| Entry | Location | Purpose |
| --- | --- | --- |
| `bin/lockpick.ts` | `bin/lockpick.ts:1` | Published executable, imports and awaits CLI `main`. |
| `src/index.ts` | `src/index.ts:1` | Library export surface and direct `bun run src/index.ts` entrypoint. |
| `main` | `src/cli/index.ts:5` | Parses argv, dispatches command families, formats top-level errors. |
| `parseCliArgs` | `src/cli/program.ts:73` | Builds Commander program and returns typed command objects. |
| `executeLockCommand` | `src/locks/commands.ts:30` | Dispatches typed lock commands to `FileLockRegistry` and renders results. |
| `runInstall` | `src/install.ts:50` | Installs or checks host repository support files. |

## Parser And Commands

The parser is defined in `src/cli/program.ts`. `createProgram` configures the root command at
`src/cli/program.ts:106`, lock commands are added at `src/cli/program.ts:120`, and install is added
at `src/cli/program.ts:363`.

Supported top-level commands:

| Command | Parser Location | Handler | Mutates Files |
| --- | --- | --- | --- |
| `acquire [paths...]` | `src/cli/program.ts:121` | `FileLockRegistry.acquire` at `src/locks/registry.ts:109` | Yes, lock JSON and events. |
| `expand --lock <id> [paths...]` | `src/cli/program.ts:153` | `FileLockRegistry.expand` at `src/locks/registry.ts:148` | Yes, lock JSON and events. |
| `refresh [locks...]` | `src/cli/program.ts:187` | `FileLockRegistry.refresh` at `src/locks/registry.ts:191` | Yes, lock JSON and events. |
| `release [locks...]` | `src/cli/program.ts:219` | `FileLockRegistry.release` at `src/locks/registry.ts:221` | Yes, removes lock JSON and appends events. |
| `status [paths...]` | `src/cli/program.ts:249` | `FileLockRegistry.status` at `src/locks/registry.ts:236` | Creates lock dir if missing via read path. |
| `prune` | `src/cli/program.ts:281` | `FileLockRegistry.prune` at `src/locks/registry.ts:254` | Yes, removes reclaimable locks and appends events. |
| `identify` | `src/cli/program.ts:303` | `FileLockRegistry.identify` at `src/locks/registry.ts:96` | No intended mutation. |
| `git begin` | `src/cli/program.ts:333` | refreshes file locks then acquires `@git/index` | Yes. |
| `git end` | `src/cli/program.ts:363` | releases git lock then optional file locks | Yes. |
| `install --check --json` | `src/cli/program.ts:363` | `runInstall` at `src/install.ts:50` | `--check` is dry-run; otherwise yes. |

All lock commands currently receive `--json`, `--id-only`, and `--verbose` from
`addLockOutputOptions` at `src/cli/program.ts:382`.

## Data Flow

```text
argv
  -> parseCliArgs/createProgram
  -> typed CliCommand
  -> runLockCommand or runInstallCommand
  -> executeLockCommand/runInstall
  -> FileLockRegistry or install helpers
  -> renderCommandResults/renderInstallResult
  -> stdout, stderr, process.exitCode
```

Lock data flow:

```text
paths/globs/git resource
  -> normalizeLockResources
  -> registry mutex
  -> active lock JSON under .lockpick/locks/active
  -> events.jsonl append
  -> compact JSON/text renderer
```

## Renderers And Output Contracts

| Surface | Location | Current Contract |
| --- | --- | --- |
| top-level help | `src/cli/program.ts:102` | Commander generated prose to stdout, exit 0. |
| parse/runtime errors | `src/cli/index.ts:18` | Text to stderr unless argv contains `--json`; JSON error to stdout when `--json`. |
| lock command text | `src/locks/commands.ts:230` | Compact prose by default; verbose adds resources/status details. |
| lock command JSON | `src/locks/commands.ts:124` | Compact JSON by default; verbose returns fuller result objects. |
| conflict text | `src/locks/commands.ts:268` | Includes resource, holder, reason, status, and a `next:` command. |
| install text | `src/install.ts:81` | Multi-line prose summary. |
| install JSON | `src/cli/commands/install.ts:8` | Pretty-printed full install result. |

## Errors And Exit Codes

Observed and implemented codes:

| Condition | Exit | Evidence |
| --- | --- | --- |
| success/help | 0 | `main` returns without setting `process.exitCode` at `src/cli/index.ts:8`. |
| parse errors | 1 | `main` fallback at `src/cli/index.ts:23`; Commander error code is preserved in JSON. |
| invalid lock command/input | 2 | `LockCommandError` default use in registry and `requireLockIds` at `src/locks/commands.ts:223`. |
| lock conflict/ownership failure | 3 | `conflictResult` at `src/locks/registry.ts:455`; ownership at `src/locks/registry.ts:443`. |
| install check drift | 1 | `runInstall` check result at `src/install.ts:74`. |

Exit-code contract is not yet documented in README/help beyond success/non-zero prose.

## Configuration And Environment

Configuration is resolved by `loadLockpickConfig` at `src/config.ts:103` and
`resolveLockpickConfig` at `src/config.ts:116`.

Precedence:

1. Explicit load options such as root/config path.
2. Host root discovered by `.git` search at `src/config.ts:158`.
3. `lockpick.config.ts` if present, loaded by dynamic import at `src/config.ts:172`.
4. Generic defaults from `src/locks/types.ts` and `src/config.ts`.

Owner detection inputs include explicit `--owner-session`, configured owner env keys, supervisor
env keys, and a generic fallback prefix.

## Filesystem Writes

| Path | Writer | Notes |
| --- | --- | --- |
| `.lockpick/locks/active/<lock>.json` | `writeLock` at `src/locks/registry.ts:360` | Atomic temp write then rename. |
| `.lockpick/locks/events.jsonl` | `appendEvent` at `src/locks/registry.ts:368` | Append-only local event stream. |
| `.lockpick/locks/.mutex` | `withMutex` at `src/locks/registry.ts:392` | Directory mutex with stale reclaim. |
| `.lockpick/locks/active` | `readActiveLocks` at `src/locks/registry.ts:342` | Read path ensures directory exists. |
| `lockpick.config.ts` | `ensureConfigFile` at `src/install.ts:174` | Created by install unless `--check`. |
| `AGENTS.md` | `ensureAgentsInstructions` at `src/install.ts:186` | Marked block upsert unless disabled. |
| `.gitignore` | `ensureGitignore` at `src/install.ts:205` | Adds `.lockpick/`. |
| `package.json` | `ensurePackageScripts` at `src/install.ts:225` | Adds recommended scripts only when absent. |

## Dependencies And Scripts

Runtime dependency is `commander` for CLI parsing. Development dependencies are Biome,
TypeScript, and Bun types. Package scripts:

| Script | Command |
| --- | --- |
| `lockpick` | `bun run src/index.ts` |
| `start` | `bun run src/index.ts` |
| `format` | `biome format --write .` |
| `lint` | `biome check .` |
| `typecheck` | `tsc --noEmit` |
| `test` | `bun test` |
| `check` | `bun test && tsc --noEmit && biome check .` |

## Baseline Transcripts

### `bun run src/index.ts --help`

Exit: 0

```text
Usage: lockpick [options] [command]

Local advisory locking for shared repository worktrees.

Options:
  -h, --help                    display help for command

Commands:
  acquire [options] [paths...]  Acquire advisory locks for paths or globs.
  expand [options] [paths...]   Atomically add paths or globs to an existing
                                lock.
  refresh [options] [locks...]  Refresh a held lock lease.
  release [options] [locks...]  Release a held lock.
  status [options] [paths...]   Show active locks, optionally filtered by
                                requested resources.
  prune [options]               Remove reclaimable expired locks.
  identify [options]            Show detected lock owner identity.
  git                           Coordinate shared Git index operations.
  install [options]             Install Lockpick support files into the host
                                repository.
  help [command]                display help for command
```

### `bun run src/index.ts nope --json`

Exit: 1

```json
{
  "ok": false,
  "code": "commander.unknownCommand",
  "message": "error: unknown command 'nope'"
}
```

### `bun run src/index.ts status --json`

Exit: 0

```json
{"kind":"status","exitCode":0,"lock_count":0,"lock_ids":[]}
```

### `bun run src/index.ts identify --json`

Exit: 0

```json
{"kind":"identified","exitCode":0,"session_id":"lockpick:Djordjes-MacBook-Pro.local:66159"}
```

### `bun run src/index.ts install --check --json`

Exit: 1

```json
{
  "ok": false,
  "exitCode": 1,
  "root": "/Users/djsimovic/Work/lockpick",
  "changes": [
    { "path": ".lockpick/locks", "action": "unchanged", "message": "lock directory exists" },
    { "path": "lockpick.config.ts", "action": "would_create", "message": "default config is required" },
    { "path": "AGENTS.md", "action": "would_update", "message": "Lockpick instructions are required" },
    { "path": ".gitignore", "action": "unchanged", "message": "entry exists" },
    { "path": "package.json", "action": "would_update", "message": "recommended scripts added" }
  ],
  "recommendedScripts": {
    "lockpick": "lockpick",
    "lockpick:status": "lockpick status",
    "lockpick:install": "lockpick install"
  }
}
```
