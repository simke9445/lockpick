#!/usr/bin/env bun
export { main } from "./cli/index";
export {
  defineLockpickConfig,
  findHostRoot,
  type LockpickConfig,
  loadLockpickConfig,
  type ResolvedLockpickConfig,
  renderLockpickCommand,
  resolveLockpickConfig,
} from "./config";
export {
  CLAUDE_LOCKPICK_AGENT_HOOK_PATH,
  type InitHarness,
  type InitInstructionsTarget,
  type InitResult,
  lockpickAgentsSnippet,
  renderClaudeLockpickAgentHookScript,
  renderInitResult,
  resolveInitHarness,
  runInit,
} from "./init";
export { executeLockCommand, renderLockResult } from "./locks/commands";
export { resourcesConflict } from "./locks/matching";
export { FileLockRegistry } from "./locks/registry";
export { normalizeLockResources } from "./locks/resources";
export {
  CLAUDE_CODE_SESSION_ENV_KEY,
  CODEX_OWNER_ENV_KEY,
  createUnknownSessionProbe,
  DEFAULT_AGENT_ENV_KEYS,
  DEFAULT_OWNER_HARNESSES,
  detectAgentId,
  detectHarnessAgentId,
  identifyLockOwner,
  LOCKPICK_HARNESS_AGENT_ENV_KEY,
  lockOwnerAgentId,
  lockOwnerSource,
  probeCodexSessionLiveness,
  type SessionLivenessProbe,
} from "./locks/session";
export type * from "./locks/types";

import { main } from "./cli/index";

if (import.meta.main) {
  await main();
}
