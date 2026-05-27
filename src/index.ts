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
  type InitHarness,
  type InitInstructionsTarget,
  type InitResult,
  lockpickAgentsSnippet,
  renderInitResult,
  resolveInitHarness,
  runInit,
} from "./init";
export { executeLockCommand, renderLockResult } from "./locks/commands";
export { resourcesConflict } from "./locks/matching";
export { FileLockRegistry } from "./locks/registry";
export { normalizeLockResources } from "./locks/resources";
export {
  CODEX_OWNER_ENV_KEYS,
  CODEX_SUPERVISOR_ENV_KEYS,
  createUnknownSessionProbe,
  DEFAULT_OWNER_ENV_KEYS,
  DEFAULT_SUPERVISOR_ENV_KEYS,
  detectSessionId,
  identifyLockOwner,
  lockOwnerSessionId,
  lockOwnerSource,
  probeCodexSessionLiveness,
  type SessionLivenessProbe,
} from "./locks/session";
export type * from "./locks/types";

import { main } from "./cli/index";

if (import.meta.main) {
  await main();
}
