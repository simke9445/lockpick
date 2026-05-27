# Implementation Notes

This file tracks design decisions, deviations, tradeoffs, and open questions while implementing `subagent_session_id_plan.md`.

## 2026-05-27

- Design decision: use an explicit Lockpick owner (`codex:<CODEX_THREAD_ID>`) for implementation-time file locks until the repository's own harness detection is implemented. The current fallback owner is process-scoped, so release/refresh can fail across separate shell commands.
- Design decision: implement the public setup rename as a contract replacement, not as a compatibility alias. `lockpick install` should stop parsing once the `init` rename lands.
- Tradeoff: use broad but scoped implementation locks for `src/**`, `tests/**`, `README.md`, `package.json`, `subagent_session_id_plan.md`, and this notes file because the feature cuts across CLI parsing, docs, tests, owner detection, and init rendering.
- Design decision: `lockpick init --harness auto` currently resolves to `claude-code` only when `CLAUDE_CODE_SESSION_ID` is present and `CODEX_THREAD_ID` is absent; otherwise it resolves to `codex`. This matches the plan's deterministic default for ambiguous/no-harness cases and avoids an interactive prompt in noninteractive agent runs.
- Design decision: harness detection runs after explicit `--owner-session` and configured owner env keys. This preserves the existing override path while making Codex/Claude automatic for fresh configs.
- Design decision: removed the opt-in `includeCodexEnv` config shape in favor of `owner.harnesses`. The fresh config now enables `["codex", "claude-code"]` by default, matching the plan's runtime-integration model.
- Design decision: the Claude Code hook returns `updatedInput` without `permissionDecision`, `permissionDecisionReason`, or `additionalContext`. The intent is to mutate only the Lockpick Bash command's environment while avoiding auto-approval and avoiding model-context text.
- Tradeoff: the Claude hook uses `node` plus an `.mjs` script path in `.claude/settings.json` instead of relying on the hook script being executable. Claude Code is Node-based, and this avoids chmod portability problems.
