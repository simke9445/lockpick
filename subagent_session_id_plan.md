# Feature Plan: Harness-Aware Agent IDs

## Goal

Make Lockpick assign `owner.agentId` automatically for the active coding agent in Codex and
Claude Code, including Claude subagents, without adding verbose identity instructions to generated
`AGENTS.md` or `CLAUDE.md`.

The public setup command is `lockpick init`. Because Lockpick is pre-live, the old `install`
command and previous session-id ownership names are not kept as aliases.

## Workflow

```bash
lockpick init
lockpick init --check --json
lockpick init --harness codex
lockpick init --harness claude-code
lockpick init --harness auto
```

`auto` is the default. There is no `both` harness option. The generated agent instructions stay
focused on lock/refresh/git/release mechanics; identity diagnostics live in `identify`, `doctor`,
capabilities JSON, and the README.

## Runtime Owner Model

Owner equality is based on `owner.agentId`.

Canonical ids:

```text
codex:<CODEX_THREAD_ID>
claude-code:<CLAUDE_CODE_SESSION_ID>:main
claude-code:<CLAUDE_CODE_SESSION_ID>:agent:<agent_id>
claude-code:<CLAUDE_CODE_SESSION_ID>        # session-scope fallback only
lockpick:<host>:<pid>                       # process fallback
```

Structured diagnostics:

```ts
type LockOwner = {
  agentId: string;
  source: string;
  hostname: string;
  pid: number;
  cwd: string;
  harness?: "codex" | "claude-code" | "lockpick";
  harnessScope?: "agent" | "main" | "session" | "fallback";
  rawSessionId?: string;
  harnessAgentId?: string;
  agentType?: string;
};
```

Detection priority:

1. Reserved harness env: `LOCKPICK_HARNESS_AGENT_ID`.
2. Codex harness env: `CODEX_THREAD_ID`.
3. Claude Code session env: `CLAUDE_CODE_SESSION_ID`.
4. Explicit fallback: `--agent-id`.
5. Configured fallback env keys, defaulting to `LOCKPICK_AGENT_ID`.
6. Process fallback `lockpick:<host>:<pid>`.

Harness detection intentionally wins over explicit fallback ids. `--agent-id` and
`LOCKPICK_AGENT_ID` are for unsupported harnesses and recovery, not the normal Codex/Claude path.
There is no supervisor-agent metadata in the owner contract.

## Codex Integration

Codex needs no project hook. Use `CODEX_THREAD_ID`:

```text
owner.agentId = codex:<CODEX_THREAD_ID>
owner.source = harness:codex:CODEX_THREAD_ID
owner.harnessScope = agent
```

## Claude Code Integration

Claude Code exposes `CLAUDE_CODE_SESSION_ID` to subprocesses, but that is session-scoped. For
main-vs-subagent distinction, `lockpick init --harness claude-code` writes:

```text
.claude/settings.json
.claude/hooks/lockpick-agent-env.mjs
```

The project `PreToolUse` hook handles Bash tool calls, exits silently for non-Lockpick commands,
and prefixes matching commands with a per-call reserved env assignment:

```sh
LOCKPICK_HARNESS_AGENT_ID='claude-code:<session>:main' lockpick ...
LOCKPICK_HARNESS_AGENT_ID='claude-code:<session>:agent:<agent>' lockpick ...
```

The hook does not emit explanatory text, `additionalContext`, or permission decisions. It exits
without changing commands that already set `LOCKPICK_HARNESS_AGENT_ID`, set `LOCKPICK_AGENT_ID`,
or pass `--agent-id`.

## Test Coverage

- Harness identity wins over `--agent-id` and configured env ids.
- Explicit/configured ids work when no supported harness is detected.
- Codex and Claude fallback ids produce the expected owner metadata.
- Claude hook output distinguishes main and subagent calls.
- Claude hook does not override existing reserved/manual identity inputs.
- `init --harness claude-code` writes `CLAUDE.md`, settings, and hook script.
- `capabilities`, `doctor`, README, and generated robot docs use `agentId`/`--agent-id`.
- `install` and `--harness both` remain unsupported.
