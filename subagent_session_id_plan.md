# Feature Plan: Harness-Aware Agent Owner Session IDs

## Goal

Make Lockpick automatically assign distinct `owner.sessionId` values for the active agent in Codex and Claude Code, including subagents, without requiring long `AGENTS.md` or `CLAUDE.md` guidance.

The feature should also rename the public setup command from `install` to `init`. Because Lockpick is pre-live, do not keep a compatibility alias for `install`.

## Desired User Workflow

```bash
lockpick init
lockpick init --check --json
lockpick init --harness codex
lockpick init --harness claude-code
lockpick init --harness auto
```

`auto` is the default. Do not add a `both` option. If both harnesses are detected and automatic selection is ambiguous, emit a clear warning and choose a deterministic default, with `--harness codex` or `--harness claude-code` as the override.

Generated `AGENTS.md` / `CLAUDE.md` content should stay lean. Do not add verbose owner-session troubleshooting blocks there. Put diagnostics in `lockpick identify --verbose`, `lockpick doctor`, README, and generated capability metadata.

## Runtime Owner Model

Use provider-scoped opaque owner IDs:

```text
codex:<CODEX_THREAD_ID>
claude-code:<CLAUDE_CODE_SESSION_ID>:main
claude-code:<CLAUDE_CODE_SESSION_ID>:agent:<agent_id>
claude-code:<CLAUDE_CODE_SESSION_ID>        # session-scope fallback only
```

Owner equality remains based on `owner.sessionId`. Add structured metadata only for diagnostics:

```ts
type LockOwner = {
  sessionId: string;
  source: string;
  hostname: string;
  pid: number;
  harness?: "codex" | "claude-code" | "lockpick";
  harnessScope?: "agent" | "main" | "session" | "fallback";
  rawSessionId?: string;
  agentId?: string;
  agentType?: string;
};
```

`agentType` is metadata only and must not affect ownership.

Detection priority:

1. Explicit `--owner-session`.
2. `LOCKPICK_OWNER_SESSION`.
3. `LOCKPICK_SESSION_ID`.
4. Harness-specific owner from runtime integration.
5. Harness session fallback, if available.
6. Process fallback `lockpick:<host>:<pid>`.

Explicit Lockpick owner env must always win over harness detection.

## Codex Integration

Codex does not need a project hook.

Use `CODEX_THREAD_ID` as the owner key:

```text
owner.sessionId = codex:<CODEX_THREAD_ID>
owner.source = harness:codex:CODEX_THREAD_ID
owner.harnessScope = agent
```

Rationale:

- Codex injects `CODEX_THREAD_ID` into shell command environments.
- Codex injects it even when `shell_environment_policy.include_only` is set.
- The shell command path passes the active conversation/thread id.
- Codex subagents can inherit the parent `session_id`, so hook `session_id` is not the right owner key for subagent distinction.

Implementation:

- Replace the current opt-in `includeCodexEnv` config with first-class harness detection.
- Prefer only `CODEX_THREAD_ID` for the canonical Codex path.
- Keep any older Codex env names out of defaults unless there is current evidence that they are still emitted.

## Claude Code Integration

Claude needs a project hook for true subagent distinction.

Claude documents `CLAUDE_CODE_SESSION_ID` for Bash/PowerShell subprocesses, but that is session-scoped. Claude hook payloads expose `agent_id` and `agent_type` for subagent hooks/tool events. Therefore:

- Built-in env detection can only provide a session-scope fallback.
- The distinct main-vs-subagent owner must come from a `PreToolUse` hook.

### Hook Files

`lockpick init --harness claude-code` should create/update:

```text
.claude/settings.json
.claude/hooks/lockpick-owner-env.mjs
```

The settings entry should register a project `PreToolUse` hook for `Bash`. Add PowerShell support only after confirming the exact Claude Code tool input shape in tests or manual verification.

The hook script should:

1. Read Claude's hook JSON from stdin.
2. Return immediately with no stdout if `tool_name` is not `Bash`.
3. Return immediately if the Bash command does not invoke Lockpick.
4. Return immediately if the command already supplies `LOCKPICK_OWNER_SESSION` or `--owner-session`.
5. Build the owner id:
   - with `agent_id`: `claude-code:<session_id>:agent:<agent_id>`
   - without `agent_id`: `claude-code:<session_id>:main`
6. Return `updatedInput` with the Bash command prefixed by a shell-safe env assignment:

```sh
LOCKPICK_OWNER_SESSION='<owner-id>' <original command>
```

The hook must not return `additionalContext` and must not emit explanatory text on success. That avoids spending model context tokens.

### Command Matching

Correctness is more important than saving a local process spawn.

Initial implementation should match all `Bash` tool calls in Claude settings and let the tiny script exit quickly unless the command contains a Lockpick invocation. After this is tested, consider a Claude `if` filter only if it can match all supported forms:

```text
lockpick ...
bun run --silent lockpick ...
bun run lockpick:...
npm run lockpick:...
pnpm run lockpick:...
```

Do not rely on a narrow `if` matcher until tests prove it will not miss normal generated instructions.

### Why Not `CLAUDE_ENV_FILE`

Do not use `CLAUDE_ENV_FILE` for per-subagent owner IDs. It is session-scoped and can be dynamically populated by lifecycle hooks, but it is not safe for concurrent subagents because one subagent can overwrite the value used by another.

The owner env assignment must be per Bash tool call.

## `install` to `init` Rename

Rename the public command:

```text
lockpick install -> lockpick init
```

No deprecated alias.

Required updates:

- `src/cli/program.ts`: command name and option parsing.
- `src/cli/commands/install.ts`: rename to `init.ts` or keep internals only if there is a strong reason.
- `src/install.ts`: rename to `init.ts` if practical; otherwise rename exported types/functions to `Init*`.
- `src/cli/capabilities.ts`: command list, examples, exit-code text, next commands.
- `src/cli/doctor.ts`: drift checks and next commands.
- `README.md`: setup workflow and command table.
- Tests and goldens: replace `install` with `init`.
- Package scripts: change `lockpick:install` to `lockpick:init`.

Because the project is pre-live, update contracts in place rather than adding migration or compatibility behavior.

## Init Harness Selection

Add:

```bash
lockpick init --harness auto
lockpick init --harness codex
lockpick init --harness claude-code
```

Do not add `--harness both`.

Suggested behavior:

| Harness | Written files |
| --- | --- |
| `codex` | `AGENTS.md`, `.lockpick/config` support files, package/gitignore updates |
| `claude-code` | `CLAUDE.md`, `.claude/settings.json`, `.claude/hooks/lockpick-owner-env.mjs`, package/gitignore updates |
| `auto` with Codex only | same as `codex` |
| `auto` with Claude only | same as `claude-code` |
| `auto` with both | choose deterministic default, emit warning, allow explicit override |
| `auto` with neither | choose Codex docs by default or fail with a concise message in noninteractive mode |

The runtime owner detector should support both Codex and Claude regardless of which instruction file was written.

## Generated Agent Docs

Keep generated agent docs short.

Recommended owner-session text, if any:

```md
Lockpick owner identity is configured by `lockpick init`.
```

Do not include verbose verification commands or harness-specific explanation in generated `AGENTS.md` / `CLAUDE.md`.

Detailed guidance belongs in:

- README.
- `lockpick capabilities --json`.
- `lockpick identify --json --verbose`.
- `lockpick doctor --json --verbose`.

## Doctor and Identify

Enhance `identify --json --verbose`:

```json
{
  "owner": {
    "session_id": "claude-code:session-1:agent:agent-1",
    "source": "env:LOCKPICK_OWNER_SESSION",
    "harness": "claude-code",
    "harness_scope": "agent"
  }
}
```

Enhance `doctor`:

- Warn if running under Claude Code and `.claude/hooks/lockpick-owner-env.mjs` is missing.
- Warn if running under Claude Code and owner source is only session-scoped.
- Warn if running under Codex and `CODEX_THREAD_ID` is unavailable.
- Report init drift for `.claude/settings.json` and hook script.

## Tests

### Unit Tests

Owner detection:

- explicit `--owner-session` wins over everything.
- `LOCKPICK_OWNER_SESSION` wins over harness env.
- `LOCKPICK_SESSION_ID` wins over harness env.
- `CODEX_THREAD_ID` produces `codex:<thread-id>`.
- `CLAUDE_CODE_SESSION_ID` without hook produces session-scope fallback.
- hook-provided `LOCKPICK_OWNER_SESSION=claude-code:<session>:main` is preserved.
- hook-provided `LOCKPICK_OWNER_SESSION=claude-code:<session>:agent:<agent>` is preserved.
- process fallback still works when no harness env is present.

Claude hook script:

- no output for non-Bash tool payload.
- no output for Bash command without Lockpick.
- prefixes direct `lockpick acquire`.
- prefixes `bun run --silent lockpick -- acquire`.
- does not override existing `LOCKPICK_OWNER_SESSION`.
- does not override explicit `--owner-session`.
- shell-quotes owner ids safely.
- uses `agent_id` when present.
- uses `main` when `agent_id` is absent.
- does not return `additionalContext`.

Init:

- `init --check --json` reports drift without writing.
- `init --harness codex` targets `AGENTS.md`.
- `init --harness claude-code` targets `CLAUDE.md` and Claude hook files.
- `init --harness auto` selects based on env fixtures.
- no `both` option is accepted.
- no `install` command is accepted.
- generated docs stay lean and do not include verbose session-id guidance.

Doctor/capabilities:

- capability JSON lists `init`, not `install`.
- doctor next commands use `lockpick init`.
- doctor warns for missing Claude hook when in Claude Code env.
- doctor reports ok when Claude hook files match expected content.

### Manual Harness Verification

Codex:

1. Run `lockpick identify --json --verbose` in a main Codex session.
2. Spawn a Codex subagent and run the same command.
3. Confirm IDs are distinct and both sources are `harness:codex:CODEX_THREAD_ID`.

Claude Code:

1. Run `lockpick init --harness claude-code`.
2. Run `lockpick identify --json --verbose` in the main Claude Code session.
3. Spawn a Claude Code subagent and run the same command.
4. Confirm main owner is `claude-code:<session>:main`.
5. Confirm subagent owner is `claude-code:<session>:agent:<agent_id>`.
6. Confirm hook execution does not add context text to the conversation.

## Security and Robustness

- Treat harness IDs as opaque untrusted strings.
- Validate or shell-quote every generated env assignment.
- Do not execute shell parsing inside the hook beyond simple command text matching.
- Do not mutate commands that do not invoke Lockpick.
- Do not auto-approve, block, or deny tool calls from the owner hook.
- Do not write session-specific values into repository files.
- Do not use global env files for subagent-specific state.

## Implementation Order

1. Rename public `install` command to `init` and update tests/docs/goldens.
2. Replace `includeCodexEnv` with harness-aware owner detection.
3. Add Codex `CODEX_THREAD_ID` owner support.
4. Add Claude session-scope fallback detection.
5. Add Claude hook renderer and init file operations.
6. Add Claude hook script tests.
7. Update doctor, capabilities, and README.
8. Run full verification:

```bash
bun test
bun run typecheck
bun run lint
bun run check
```

Commit each passing unit-tested chunk separately.

## Acceptance Criteria

- Fresh `lockpick init` configures harness-aware owner detection.
- Codex main sessions and subagents get distinct owner IDs without AGENTS instructions.
- Claude Code main sessions and subagents get distinct owner IDs when the project hook is installed.
- Generated `AGENTS.md` / `CLAUDE.md` do not contain verbose session-id verification guidance.
- `lockpick install` is gone; `lockpick init` is the only public setup command.
- There is no explicit `both` harness option.
- `doctor` can detect missing or stale Claude hook integration.
- All tests, typecheck, lint, and check pass.
