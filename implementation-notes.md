# Implementation Notes

This file tracks design decisions, deviations, tradeoffs, and open questions while implementing `subagent_session_id_plan.md`.

## 2026-05-27

- Design decision: use an explicit Lockpick owner (`codex:<CODEX_THREAD_ID>`) for implementation-time file locks until the repository's own harness detection is implemented. The current fallback owner is process-scoped, so release/refresh can fail across separate shell commands.
- Design decision: implement the public setup rename as a contract replacement, not as a compatibility alias. `lockpick install` should stop parsing once the `init` rename lands.
- Tradeoff: use broad but scoped implementation locks for `src/**`, `tests/**`, `README.md`, `package.json`, `subagent_session_id_plan.md`, and this notes file because the feature cuts across CLI parsing, docs, tests, owner detection, and init rendering.
- Design decision: `lockpick init --harness auto` currently resolves to `claude-code` only when `CLAUDE_CODE_SESSION_ID` is present and `CODEX_THREAD_ID` is absent; otherwise it resolves to `codex`. This matches the plan's deterministic default for ambiguous/no-harness cases and avoids an interactive prompt in noninteractive agent runs.
- Design decision: harness detection runs before explicit `--agent-id` and configured owner env keys. `--agent-id` and `LOCKPICK_AGENT_ID` are fallback/recovery inputs for unsupported harnesses, while Codex and Claude Code should use harness identity automatically.
- Design decision: removed the opt-in `includeCodexEnv` config shape in favor of `owner.harnesses`. The fresh config now enables `["codex", "claude-code"]` by default, matching the plan's runtime-integration model.
- Design decision: the Claude Code hook returns `updatedInput` without `permissionDecision`, `permissionDecisionReason`, or `additionalContext`. The intent is to mutate only the Lockpick Bash command's environment while avoiding auto-approval and avoiding model-context text.
- Tradeoff: the Claude hook uses `node` plus an `.mjs` script path in `.claude/settings.json` instead of relying on the hook script being executable. Claude Code is Node-based, and this avoids chmod portability problems.
- Design decision: `doctor` switches its init drift check to `--harness claude-code` when `CLAUDE_CODE_SESSION_ID` is present. That makes missing Claude hook files visible in Claude sessions even if `init --harness auto` would otherwise pick Codex in an inherited mixed environment.
- Design decision: remove supervisor identity from the owner contract. `owner.agentId` is the single ownership key; parent/controller metadata can be added later only if a concrete orchestration feature needs it.
- Design decision: rename public identity surfaces to agent-id language: `owner.agentId`, `--agent-id`, `LOCKPICK_AGENT_ID`, and reserved `LOCKPICK_HARNESS_AGENT_ID`.
