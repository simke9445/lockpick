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
| 3 | `codebase-audit` domain `cli` | completed | CLI audit findings recorded below with severity, root cause, and recommended fix. |
| 4 | `agent-ergonomics-and-intuitiveness-maximization-for-cli-tools` | completed | Used as scoring lens: output parseability, error pedagogy, intent inference, self-documentation, safety, determinism, composability, regression resistance. |
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
| `--id-only` residual scope | `identify --id-only` now fails with a replacement command and `prune --id-only` returns pruned ids; `status --id-only` remains accepted for active lock ids. |
| No doctor surface | There is no health command for config/install/lock-state diagnosis. |

## CLI Audit Findings

### High: Missing Machine-Readable Capabilities Surface

- Location: `src/cli/program.ts:106`, `src/cli/program.ts:120`, `src/cli/program.ts:363`
- Issue: the CLI exposes prose help but no `capabilities --json` inventory. Agents must scrape
  Commander text to discover commands, flags, JSON support, mutation behavior, and exit codes.
- Root cause: parser command registration is only human-help oriented; there is no first-class
  contract renderer.
- Recommended fix: add `capabilities` with compact JSON by default under `--json`, covering
  version, contract version, command list, flags, mutates/read-only status, exit-code dictionary,
  env vars, and next-step commands. Add parser and subprocess contract tests.

### Medium: Exit-Code Contract Is Implicit

- Location: `src/cli/index.ts:23`, `src/locks/commands.ts:223`,
  `src/locks/registry.ts:443`, `src/locks/registry.ts:455`, `src/install.ts:74`,
  `README.md:47`
- Issue: code distinguishes parse errors, usage errors, conflicts, and install drift, but README
  only documents success/non-zero broadly.
- Root cause: exit code meanings live in implementation and tests, not in a stable public
  contract.
- Recommended fix: publish exit-code dictionary through `capabilities --json` and README; add a
  conformance test for the dictionary.

### Medium: `--id-only` Is Exposed Too Broadly

- Location: `src/cli/program.ts:382`, `src/locks/commands.ts:210`
- Issue: every lock command accepts `--id-only`, including surfaces such as `identify` and `prune`
  that do not necessarily return affected lock ids. That can produce successful empty stdout.
- Root cause: `addLockOutputOptions` applies the same output flags to all lock commands.
- Recommended fix: either scope `--id-only` to commands that return lock ids or make unsupported
  combinations fail with a precise usage error. Add parser/subprocess tests.

### Medium: Prune Has No Dry-Run Or Confirmation Plan

- Location: `src/cli/program.ts:281`, `src/locks/registry.ts:254`
- Issue: `prune` deletes reclaimable lock files immediately. It is useful and local, but it is
  still a filesystem mutation with no plan/dry-run view.
- Root cause: prune is implemented as a single mutation path.
- Recommended fix: add `prune --dry-run --json` plan output before considering stronger confirm
  gates. Keep defaults generic and do not add compatibility aliases.

### Low: `--version` Is Missing

- Location: `src/cli/program.ts:106`, `package.json:3`
- Issue: `lockpick --version` exits 1 with `unknown option '--version'`.
- Root cause: Commander program does not configure a version option.
- Recommended fix: expose package version through `--version` and capabilities output, with a CLI
  test. Keep the value sourced from the package metadata or a single generated constant.

### Low: Install JSON Is Token-Heavy

- Location: `src/cli/commands/install.ts:8`, `src/install.ts:81`
- Issue: `install --check --json` pretty-prints the full result. Useful, but expensive for agents
  that only need drift status and paths.
- Root cause: install has only text or full pretty JSON; no compact/default-vs-verbose split.
- Recommended fix: after capabilities lands, consider compact install JSON by default and full
  output behind a consistent verbose/include flag.

## Agent-Ergonomics Score Snapshot

Scores are 0-1000 estimates grounded in source lines and transcripts above.

| Surface | Intuitive | Ergonomic | Parseable | Errors Teach | Intent Recovery | Safety | Deterministic | Self-Docs | Regression | Priority |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `status --json` / `identify --json` | 750 | 800 | 850 | n/a | n/a | n/a | 750 | 650 | 500 | Medium |
| lock mutations JSON/text | 700 | 700 | 750 | 650 | 300 | 650 | 650 | 600 | 550 | Medium |
| parse errors with `--json` | 550 | 550 | 700 | 450 | 250 | n/a | 700 | 450 | 450 | Medium |
| root help | 650 | 600 | 300 | n/a | n/a | n/a | 700 | 550 | 350 | Medium |
| install check JSON | 650 | 550 | 600 | n/a | n/a | 700 | 800 | 550 | 450 | Low |
| `capabilities --json` | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 | High |
| `doctor` / health | 0 | 0 | 0 | n/a | n/a | 500 | n/a | 0 | 0 | Medium |

Next implementation chunk selected from the scorecard: add `capabilities --json` first because it
raises self-documentation, output parseability, exit-code discoverability, and token efficiency
without changing lock mutation semantics.

## Implementation Log

### Chunk: `capabilities --json`

- Status: completed.
- Contract: add `lockpick capabilities --json` as a compact machine-readable CLI contract with
  version, schema version, command inventory, flags, mutation/read-only status, JSON support,
  exit-code dictionary, env vars, defaults, and copy-pasteable next commands.
- Verification skill used: `testing-conformance-harnesses`; requirements extracted into focused
  parser/subprocess tests in `tests/cli.test.ts`.
- Verification passed: `bun test tests/cli.test.ts`, `bun test`, `bun run typecheck`,
  `bun run lint`, `bun run check`, and `bun run src/index.ts capabilities --json`.

### Chunk: `--id-only` contract tightening

- Status: completed.
- Contract: `identify --id-only` fails with `unsupported_output_option` and the exact replacement
  command `lockpick identify --json`; `prune --id-only` now prints the ids of pruned locks.
- Verification skill used: `testing-conformance-harnesses`; requirements are pinned by focused
  CLI and lock-command tests.
- Verification passed: `bun test tests/cli.test.ts tests/locks.test.ts`, `bun run typecheck`,
  `bun run lint`, and `bun run check`.
