# README Evidence Note

Last verified: 2026-05-26.

This note records the evidence used for the public README contract. It is intentionally compact:
commands, flags, install paths, config knobs, API exports, tests, and known limits only.

## Skill Work Log

All requested skills were available and read from disk in order:

| Order | Skill | Status | Use in README work |
| --- | --- | --- | --- |
| 1 | `readme-writing` | read | Conversion structure, scanner-first order, examples before reference |
| 2 | `codebase-archaeology` | read | Docs-first exploration from CLI entry points to registry, install, tests |
| 3 | `codebase-report` | read | This evidence note with file and command citations |
| 4 | `agent-ergonomics-and-intuitiveness-maximization-for-cli-tools` | read | `--json`, `--id-only`, capabilities, robot docs, exits, next-step clarity |
| 5 | `de-slopify` | read | Manual prose pass for hype, formulaic phrasing, and em dash avoidance |
| 6 | `seo-for-saas-businesses` | read | Lightweight title, first paragraph, heading, and snippet readability lens |
| 7 | `code-review` | read | Final pass treats README claims as contracts |

No skill was missing or blocked.

## Repository Facts

| Fact | Evidence |
| --- | --- |
| Package name and version are `lockpick` and `0.1.0` | `package.json:2`, `package.json:3` |
| License is declared as MIT in the package manifest and license file | `package.json:4`, `LICENSE:1` |
| Runtime is Bun `>=1.2.0` | `package.json:41` to `package.json:43` |
| Binary entry is `./bin/lockpick.ts` | `package.json:8` to `package.json:10` |
| Package export is `./src/index.ts` | `package.json:19` to `package.json:21` |
| Package files list includes CLI, source, README evidence, README, contribution policy, and license | `package.json:11` to `package.json:18` |
| Runtime dependency is `commander` | `package.json:33` to `package.json:35` |
| Local checks are `bun test`, `tsc --noEmit`, `biome check .` | `package.json:28` to `package.json:31` |
| No `.github` workflow files were present | `.github` did not exist when checked; no CI badge is claimed |

## Global CLI Evidence

Commands:

```bash
bun pm pack --dry-run
npm pack --dry-run
PACK_PATH=$(bun pm pack --destination "$(mktemp -d)" --quiet | awk 'NF {line=$0} END {print line}')
TMP_BUN_HOME=$(mktemp -d)
BUN_INSTALL="$TMP_BUN_HOME" bun install -g "$PACK_PATH"
PATH="$TMP_BUN_HOME/bin:$PATH" lockpick --help | head -20
NPM_PREFIX=$(mktemp -d)
npm install -g --prefix "$NPM_PREFIX" "$PACK_PATH"
PATH="$NPM_PREFIX/bin:$PATH" lockpick --help | head -20
```

Result summary:

- `bun pm pack --dry-run` and `npm pack --dry-run` completed and reported the package tarball
  contents.
- The packed tarball installed globally with `bun install -g <tarball>` into an isolated temp Bun
  home, and `lockpick --help` exited 0.
- The same tarball installed globally with `npm install -g --prefix <temp> <tarball>`, and
  `lockpick --help` exited 0.
- In a temp Git host repo, the tarball-installed global `lockpick` binary completed the README setup
  and quick-demo flow: `install --check --json`, `install`, `acquire`, `expand`, `refresh`,
  `git begin`, `status --json`, `git end`, `prune --dry-run --json`, and `doctor --json`.

## Runtime Command Evidence

### Capabilities

Command:

```bash
bun run --silent lockpick -- capabilities --json | jq '{kind,schema_version,version,contract,command_count:(.commands|length), commands:[.commands[].name], defaults, exit_codes, env:[.env[].name]}'
```

Result summary:

- `kind`: `capabilities`
- `schema_version`: `1`
- `version`: `0.1.0`
- `contract`: `lockpick.capabilities.v1`
- `command_count`: `13`
- Commands: `acquire`, `expand`, `refresh`, `release`, `status`, `prune`, `identify`,
  `git begin`, `git end`, `install`, `capabilities`, `robot-docs guide`, `doctor`
- Defaults: `lockpick.config.ts`, `.lockpick/locks`, `ttl_ms` 600000, `max_ttl_ms`
  1800000, `unknown_liveness_grace_ms` 600000, `git_index_resource` `@git/index`
- Exit codes: 0 success, 1 parse/check drift or doctor warning/error result, 2 lock usage error,
  3 conflict/ownership
- Env keys: `LOCKPICK_OWNER_SESSION`, `LOCKPICK_SESSION_ID`,
  `LOCKPICK_SUPERVISOR_SESSION_ID`

Source: `src/cli/capabilities.ts:66` to `src/cli/capabilities.ts:303`.

### Robot Docs

Command:

```bash
bun run --silent lockpick -- robot-docs guide
```

Verified content includes inspect commands, lock-before-edit commands, Git-index workflow,
recovery guidance, and output contract. Source: `src/cli/robot-docs.ts:5` to
`src/cli/robot-docs.ts:35`. Golden test: `tests/cli.test.ts:333`.

### Install Check

Command:

```bash
bun run --silent lockpick -- install --check --json | jq .
```

In this repository, check output was compact JSON with `kind: "install"`, `ok: false`,
`exitCode: 1`, `instructions_path: "AGENTS.md"`, five changes, and recommended scripts
`lockpick`, `lockpick:install`, `lockpick:status`. Exit 1 is expected when drift is found.

Source: `src/cli/commands/install.ts:10` to `src/cli/commands/install.ts:21`,
`src/install.ts:60` to `src/install.ts:92`.

### Doctor

Command:

```bash
bun run --silent lockpick -- doctor --json | jq .
```

In this repository, doctor returned shell exit 1 with `ok: false` and warnings for missing config
and install drift, plus ok checks for lock root, active dir, and registry mutex. In the temp
installed demo, doctor returned shell exit 0 with `ok: true`.

Source: `src/cli/doctor.ts:32` to `src/cli/doctor.ts:81`.

### Help Commands

Representative help commands verified:

```bash
bun run --silent lockpick -- --help
bun run --silent lockpick -- acquire --help
bun run --silent lockpick -- git begin --help
bun run --silent lockpick -- install --help
bun run --silent lockpick -- prune --help
```

Source: `src/cli/program.ts:118` to `src/cli/program.ts:511`.

## Temp-Repo Demo Evidence

The README quick demo was run safely in a temp Git repository using:

```bash
LOCKPICK_SRC="/Users/djsimovic/Work/lockpick/src/index.ts"
HOST=$(mktemp -d)
cd "$HOST"
git init -q
export LOCKPICK_OWNER_SESSION="demo-session"
printf 'console.log("hello")\n' > app.ts
printf '# Demo host repo\n' > AGENTS.md
printf '{"scripts":{}}\n' > package.json
```

Verified outcomes:

- `install --check --json` reported five would-change entries and exited 1.
- `install` completed and wrote host support files.
- `acquire app.ts --id-only` printed one lock id.
- `expand --lock <file_lock> README.md --id-only` printed the same file lock id.
- `refresh <file_lock> --id-only` printed the same file lock id.
- `git begin --refresh-lock <file_lock> --id-only` printed a different Git-index lock id.
- `status --json` reported `lock_count: 2`.
- `git end <git_lock> --release-lock <file_lock> --id-only` printed both released ids.
- `prune --dry-run --json` reported `pruned_count: 0`.
- `doctor --json` reported `ok: true`.

The stable owner env var is necessary for multi-command examples because fallback owner ids include
the process id. Source: `src/locks/session.ts:42` to `src/locks/session.ts:60`,
`src/locks/session.ts:125` to `src/locks/session.ts:127`.

## Source Contracts Used

| Contract | Source |
| --- | --- |
| CLI main dispatch and compact JSON errors | `src/cli/index.ts:8` to `src/cli/index.ts:52` |
| Unknown flag and command suggestions | `src/cli/index.ts:100` to `src/cli/index.ts:192` |
| Command registration and flags | `src/cli/program.ts:135` to `src/cli/program.ts:470` |
| Registry acquire/expand/refresh/release/status/prune | `src/locks/registry.ts:109` to `src/locks/registry.ts:283` |
| Owner-only refresh/release/expand | `src/locks/registry.ts:453` to `src/locks/registry.ts:462` |
| Registry mutex and stale reclaim | `src/locks/registry.ts:402` to `src/locks/registry.ts:440` |
| Lock ids and TTL defaults | `src/locks/types.ts:1` to `src/locks/types.ts:7` |
| Path and glob normalization | `src/locks/resources.ts:15` to `src/locks/resources.ts:98` |
| Conflict matching | `src/locks/matching.ts:4` to `src/locks/matching.ts:28` |
| Config fields and discovery | `src/config.ts:17` to `src/config.ts:64`, `src/config.ts:103` to `src/config.ts:170` |
| Install writes and marked instructions | `src/install.ts:60` to `src/install.ts:92`, `src/install.ts:106` to `src/install.ts:145` |
| Public TypeScript exports | `src/index.ts:1` to `src/index.ts:36` |

## Test Evidence

Commands run after the README contract update:

| Command | Result |
| --- | --- |
| `bun test` | Passed, 39 tests |
| `bun run typecheck` | Passed, exit 0 |
| `bun run lint` | Passed, exit 0 |
| `bun run check` | Passed, exit 0 |

| Area | Tests |
| --- | --- |
| CLI help, parser, errors, capabilities, robot docs, install JSON, doctor | `tests/cli.test.ts` |
| File-backed lock semantics, conflicts, owner checks, stale cleanup, `@git/index` | `tests/locks.test.ts` |
| Install creation, updates, CLAUDE target, idempotency, check mode, AGENTS snippet | `tests/install.test.ts` |
| Robot docs golden output | `tests/goldens/robot-docs-guide.txt` |

Earlier hardening artifacts under `cli-hardening/artifacts/20260526T142530Z/` were read as
supporting context, but runtime commands and current source were used for README claims.

## Limitations Used In README

- Package is pre-release.
- No checked-in CI workflow files; no CI badge.
- Advisory local coordination only; no networked service or enforcement against non-participants.
- Generic default liveness is `unknown`; Codex-specific liveness is opt-in config.
- No compatibility layers, migration paths, deprecated names, or old-schema promises.
- `lockpick --version` is not implemented; version is exposed through `capabilities --json`.
- `CONTRIBUTING.md` exists with local checks, file-locking expectations, and PR guidance.
