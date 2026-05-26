# Lockpick Test Map

Run id: `20260526T142530Z`

## Baseline Verification

| Command | Result |
| --- | --- |
| `bun test` | 21 pass, 0 fail |
| `bun run typecheck` | `tsc --noEmit` passing |
| `bun run lint` | `biome check .` passing |
| `bun run --silent lockpick -- status --verbose` | `No active locks.` |

## Test Files

| File | Coverage |
| --- | --- |
| `tests/cli.test.ts` | Help, help alias behavior, command parsing, git helper parsing, install parsing, machine-readable parse errors. |
| `tests/locks.test.ts` | Resource normalization, conflict matching, registry acquire/expand/refresh/release/status/prune semantics, owner detection, compact output, id-only batch output. |
| `tests/install.test.ts` | Install file creation/update/idempotency/check mode and generated AGENTS snippet. |

## Existing CLI Contract Tests

| Test | Location | Contract |
| --- | --- | --- |
| help lists top-level lock commands | `tests/cli.test.ts:29` | Root help includes command names. |
| nested help aliases resolve to subcommand help | `tests/cli.test.ts:37` | `help expand` and `git help begin` are accepted. |
| parse lock acquire command | `tests/cli.test.ts:53` | Acquire args map to typed `LockCommand`. |
| parse lock git helpers | `tests/cli.test.ts:82` | `git begin/end` args map to typed `LockCommand`. |
| parse install check command | `tests/cli.test.ts:117` | Install args map to typed install options. |
| json parse errors are machine-readable | `tests/cli.test.ts:128` | Invalid args with `--json` return JSON on stdout and empty stderr. |

## Existing Lock Semantics Tests

| Test | Location | Contract |
| --- | --- | --- |
| normalizes safe repo-relative path and glob resources | `tests/locks.test.ts:17` | Path/glob normalization and outside-repo rejection. |
| detects exact, path-glob, conservative glob, and git-index conflicts | `tests/locks.test.ts:42` | Conflict matcher behavior. |
| acquire defaults and conflicts | `tests/locks.test.ts:75` | Default lock root, active dir creation, conflict exit code. |
| expand is atomic | `tests/locks.test.ts:101` | Failed expand does not modify original lock resources. |
| owner checks | `tests/locks.test.ts:127` | Refresh/release/expand require owning session. |
| unknown liveness expiry | `tests/locks.test.ts:150` | Unknown sessions become reclaimable after grace. |
| git index conflicts | `tests/locks.test.ts:178` | `@git/index` conflicts only with another git lock. |
| owner detection | `tests/locks.test.ts:203` | Explicit, env, fallback owner ids. |
| compact output | `tests/locks.test.ts:228` | Compact JSON/text and conflict next command. |
| id-only batch output | `tests/locks.test.ts:268` | Acquire/refresh/release id-only behavior. |

## Existing Install Tests

| Test | Location | Contract |
| --- | --- | --- |
| install creates support files | `tests/install.test.ts:7` | Creates AGENTS, gitignore, package scripts, config. |
| install updates existing files | `tests/install.test.ts:31` | Preserves unrelated content while adding Lockpick data. |
| install preserves config and is idempotent | `tests/install.test.ts:58` | Existing config is not overwritten; rerun clean. |
| install check reports without writing | `tests/install.test.ts:75` | `--check` exits 1 and avoids writes when drift exists. |
| generated AGENTS snippet renders command usage | `tests/install.test.ts:85` | Snippet includes core commands. |

## Coverage Gaps For Hardening Goal

| Gap | Risk | Suggested Proof |
| --- | --- | --- |
| No machine-readable capabilities inventory | Agents scrape prose help, losing determinism and tokens. | Add parser + subprocess JSON tests and a schema assertion. |
| No explicit exit-code contract artifact | Recovery behavior is implicit. | Add tests against capabilities/README exit code table. |
| No golden snapshots for help/error JSON | Commander/text drift may slip through. | Add focused goldens after output contract stabilizes. |
| No conformance test for stdout/stderr split across commands | Data and diagnostics can regress. | Add subprocess matrix for success, parse error, conflict, install check. |
| No fuzz/metamorphic parser tests | Unknown flags and argument combinations may surprise automation. | Add table-driven parser conformance before broader fuzzing. |
| `--id-only` unsupported-surface behavior untested | Empty successful output can confuse agents. | Add tests for `identify --id-only`, `prune --id-only`, and `status --id-only`. |
| No doctor/health tests | Health surface is missing. | Add fixture workspace tests if doctor command is implemented. |
