# CLI Hardening Ledger

Run id: `20260526T142530Z`

## Goal

Harden Lockpick CLI through test-gated iterations for agent-first UX, token efficiency,
deterministic automation, and CLI ergonomics while keeping Lockpick standalone and generic.

## Skill Ledger

| Order | Skill | Status | Notes |
| --- | --- | --- | --- |
| 1 | `codebase-archaeology` | completed | Read `SKILL.md`, `AGENTS.md`, `README.md`; mapped CLI parser, handlers, renderers, errors, exits, config/env, filesystem writes, docs, tests, scripts. |
| 2 | `codebase-report` | completed | Wrote `cli-map.md`, `surface-inventory.json`, `test-map.md`, and this ledger. |
| 3 | `codebase-audit` domain `cli` | pending | Next required step. |
| 4 | `agent-ergonomics-and-intuitiveness-maximization-for-cli-tools` | pending | Use as primary scoring lens after CLI audit. |
| 5 | `world-class-doctor-mode-for-cli-tools` | pending | Only apply if doctor/health/diagnose surface is selected. |
| 6 | verification skills | pending | Apply when output/parser/contracts need stronger proof. |
| 7 | `simplify-and-refactor-code-isomorphically`, `ai-slop-cleaner` | pending | Use for scoped cleanup after functional chunks. |
| 8 | `code-review`, `security-review` | pending | Required before final handoff if dangerous filesystem/subprocess/security-sensitive behavior is touched. |

## Baseline

| Item | Evidence |
| --- | --- |
| Tests | `bun test` passed: 21 pass, 0 fail. |
| Typecheck | `bun run typecheck` passed. |
| Lint | `bun run lint` passed. |
| Lock status | `bun run --silent lockpick -- status --verbose` returned `No active locks.` |
| Git state before artifact writes | Clean `main` at `5545fde Initial commit`. |

## Sampled CLI Transcripts

| Command | Exit | Output Contract |
| --- | --- | --- |
| `bun run src/index.ts --help` | 0 | Commander help prose on stdout. |
| `bun run src/index.ts nope --json` | 1 | Pretty JSON error on stdout, no stderr. |
| `bun run src/index.ts status --json` | 0 | Compact JSON: `kind`, `exitCode`, `lock_count`, `lock_ids`. |
| `bun run src/index.ts identify --json` | 0 | Compact JSON: `kind`, `exitCode`, `session_id`. |
| `bun run src/index.ts install --check --json` | 1 | Pretty JSON full install drift result. |

## Current Ranked Candidates

1. Add `lockpick capabilities --json` as a compact machine-readable inventory of commands, flags,
   exit codes, JSON support, mutation behavior, and next commands.
2. Document and test exit-code contracts in a machine-readable surface and README.
3. Tighten `--id-only` support so unsupported surfaces do not succeed with empty output.
4. Make `install --check --json` compact by default with an explicit verbose/full mode if the
   product contract wants it.
5. Add a scoped `doctor`/health surface for config, lock dirs, stale mutexes, and install drift
   after discovery contracts are in place.

## Locks Held

| Lock | Paths | Reason |
| --- | --- | --- |
| `lock_20260526T142535Z_026df8b4` | `cli-hardening/artifacts/20260526T142530Z/*` exact artifact files | Write CLI hardening baseline artifacts. |

## Open Risks

| Risk | Notes |
| --- | --- |
| Capabilities missing | Agents must parse help prose to discover commands and flags. |
| Exit-code docs incomplete | README only says invalid/conflict exits non-zero; concrete code meanings are implicit. |
| Output contract not golden-tested | Compact JSON exists, but help and error outputs are not snapshot/golden protected. |
| `--id-only` is too broad | Global lock output option exposes flag to `identify` and `prune`, where empty success output is possible. |
| No doctor surface | There is no health command for config/install/lock-state diagnosis. |
